# Keka Waves C and D — Payroll depth and Hiring (ATS)

**Date:** 2026-09-27
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave C, Wave D)
**Baseline:** `main` at `a1ad108` (Wave B merged). Branch `feat/keka-wave-c-d`.
**Format and engine reference:** `docs/superpowers/specs/2026-09-24-keka-wave-b-workflow-engine-design.md`

## Goal

One branch that (a) closes three Wave B review follow-ups, (b) deepens payroll
(arrears, one-time payments, hold/void, reimbursements through payroll,
off-cycle runs, accounting export, variance report) and (c) adds an applicant
tracking module (requisitions to onboarding, public careers page and
pre-onboarding portal). Flexible benefit plans are out of scope.

With no tenant configuration, existing behaviour is unchanged: reimbursement
through payroll is off by default, the careers page is off by default, every
existing payroll run is a `REGULAR` run with `sequence = 0`.

## Conventions (all workstreams)

- Every new model has `tenantId`; every query is scoped by it. Every `@@unique`
  that is not an id includes `tenantId` (or a parent id that is itself
  tenant-scoped).
- Errors: 400 `BadRequestException` validation / wrong state, 403
  `ForbiddenException` authorization, 404 missing (also for other tenants' ids),
  409 `ConflictException` races and duplicates.
- Protected controllers: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
  There is **no global auth guard** in this codebase: public controllers simply
  do not apply `JwtAuthGuard` (same as `LogoController` and the
  forgot/reset-password routes). No `@Public` decorator is needed.
- Rate limiting: `ThrottlerModule` is registered globally for storage only;
  apply `@UseGuards(ThrottlerGuard)` + `@Throttle(...)` per public route (the
  `AuthController.login` pattern).
- `AuthenticatedUser.employeeId` is optional: guard it before using it in a
  Prisma `where` (undefined matches every row).
- Money is `Decimal` end to end (`money()` = 2 dp, half up), JSON lines hold
  numbers rounded to paise.
- Audit: `AuditService.log(input, tx?)` (global module) for configuration
  changes and exports named below.

---

## Part B — Wave B follow-ups (WS-B)

### B1. Audit every workflow definition change

HR can switch off maker-checker (`allowSelfApproval`) or admin override, so
every change must be traceable.

- `WorkflowDefinitionsService.upsert(tenantId, entityType, dto, actorUserId)`
  and `reset(tenantId, entityType, actorUserId)` gain the actor.
  `WorkflowsController` passes `user.userId`.
- `upsert` writes, **inside its existing transaction**, one `AuditLog`:
  `action = CREATE` when no row existed, else `UPDATE`;
  `entityType = 'WorkflowDefinition'`; `entityId = <definition id>`;
  `oldValues = { entityType, view: <WorkflowDefinitionView before> }`
  (the default view when none existed), `newValues = { entityType, view: <after> }`.
- `reset` writes `action = DELETE` with `oldValues` = the custom view and
  `newValues = { entityType, view: <default view> }`, inside a transaction with
  the delete. Resetting a type with no custom row writes nothing.
- `userId` = actor. No IP/user agent (service layer has none).

### B2. Leave create notifies the resolved step-1 approvers

Today `LeaveService.createRequest` emails the employee's reporting manager
directly, which is wrong when the tenant's LEAVE chain starts with someone else.

- New engine method (contract type `PendingApprover` in `workflow.types.ts`):
  `ApprovalEngineService.getPendingApprovers(tenantId, entityType, entityId): Promise<PendingApprover[]>`
  — the users (`userId`, `email`, `name`) who may act on the current step,
  resolved exactly as `notifyPending` resolves recipients (approvers and
  on-behalf actors, requester excluded, active users only). Never throws;
  returns `[]` on any error or when there is no PENDING instance.
- `createRequest` removes the direct manager lookup/email. After commit it keeps
  `void notifyPending(...)` and additionally emails every `getPendingApprovers`
  result with the existing `leave-request` template (`approverName` = that
  user's name). Fire-and-forget; failures are logged, never thrown.

### B3. Regularization policy read inside the transaction

`RegularizationService.applyRegularization` reads the attendance policy through
`this.prisma` while holding `tx`, so the classification can use a policy read
outside the transaction (and on a different connection).

- `AttendancePolicyService.getOrCreate(tenantId, tx?)`: uses `tx ?? this.prisma`
  for the read, the create and the unique-violation re-read.
- `applyRegularization` calls `getOrCreate(tenantId, tx)`.

---

## Part C — Payroll depth

### C.0 Data model (scaffold)

```prisma
enum PayrollRunType { REGULAR OFF_CYCLE }
enum OneTimePaymentKind { BONUS INCENTIVE COMMISSION OTHER_EARNING RECOVERY OTHER_DEDUCTION }
enum SalaryArrearStatus { PENDING INCLUDED PAID CANCELLED }
enum SalaryHoldStatus { HELD RELEASED VOIDED }
enum AccountingCostCenterMode { NONE DEPARTMENT BRANCH }

PayrollRun += runType (default REGULAR), sequence Int (default 0; REGULAR is
  always 0, OFF_CYCLE 1..n per month), offCycleReason?, includeSalary Bool
  (default false; off-cycle only), scopeEmployeeIds String[] (default []),
  needsRecompute Bool (default false), paidAt DateTime?
  UNIQUE (tenantId, month, year) → UNIQUE (tenantId, month, year, runType, sequence)
Payslip += nonRecurringTaxable, nonTaxableEarnings, arrearsAmount,
  reimbursementAmount  (Decimal(12,2) default 0)
ExpenseClaim += payrollRunId? → PayrollRun
Settlement  += payrollRunId? → PayrollRun
PayrollOneTimePayment (tenantId, payrollRunId, employeeId, kind, name(100),
  amount, taxable (default true), note?, createdById)
SalaryArrear (tenantId, employeeId, employeeSalaryId → EmployeeSalary,
  forMonth, forYear, financialYear, originalPayslipId → Payslip,
  originalAmount, revisedAmount, amount (signed), pfWagesDelta, lines Json,
  status, payrollRunId? → PayrollRun)  UNIQUE (employeeSalaryId, forMonth, forYear)
SalaryHold (tenantId, employeeId, payrollRunId → PayrollRun "held in",
  reason(500), status, heldAmount?, releaseRunId? → PayrollRun, releasedAt?,
  releasedById?, voidedAt?, voidedById?, voidReason?, createdById)
  UNIQUE (payrollRunId, employeeId)
PayrollSettings (tenantId unique, reimburseExpensesViaPayroll default false,
  autoArrears default true)
PayrollGlMapping (tenantId, componentKey(100), glCode(50), glName(150))
  UNIQUE (tenantId, componentKey)
PayrollAccountingConfig (tenantId unique, suspenseGlCode?, suspenseGlName?,
  costCenterMode default NONE, tallyCompanyName?, tallyVoucherType default
  'Journal', narrationTemplate default 'Salary for {{month}} {{year}}')
NotificationType += SALARY_HELD, SALARY_RELEASED
```

The payslip line contract shared by C1 (writer) and C2 (reader) lives in
`backend/src/modules/payroll/payroll-lines.types.ts` (scaffold, frozen):

```ts
type PayslipLineKind = 'COMPONENT' | 'ARREAR' | 'ONE_TIME' | 'REIMBURSEMENT'
  | 'HOLD_RELEASE' | 'SETTLEMENT' | 'STATUTORY' | 'LOAN';
interface PayslipLine { name: string; amount: number; kind?: PayslipLineKind;
  taxable?: boolean; refId?: string | null }
```

Lines written before this wave have no `kind`: earnings read as `COMPONENT`;
deductions are classified by name (`STATUTORY_DEDUCTION_LINE_NAMES`,
`LOAN_DEDUCTION_LINE_NAMES`), anything else `COMPONENT`.

**Payslip money identities (after this wave):**

- `grossPay` = prorated `basePay` + taxable earning lines + `otPay`
  (includes `arrearsAmount` and taxable one-time earnings).
- `nonRecurringTaxable` = the part of `grossPay` that does not recur
  (positive net arrears + taxable one-time earnings).
- `nonTaxableEarnings` = reimbursements + non-taxable one-time earnings +
  released held salary + settlement exempt parts. **Not** in `grossPay`.
- `netPay = grossPay + nonTaxableEarnings − totalDeductions`.
- `PayrollRun.totalGross/totalDeductions/totalNet` stay sums of the payslips.

### C1. Arrears from backdated salary revisions

A revision is an `EmployeeSalary` row whose `effectiveFrom` is earlier than the
latest month already paid to that employee in an APPROVED or PAID **REGULAR**
run.

- **Detection** (`SalaryArrearsService.detectForEmployee(tenantId, employeeId)`):
  for each active revision, for every month from `effectiveFrom` up to the
  latest APPROVED/PAID regular run with a payslip for the employee, compare
  `originalAmount` = the original payslip's regular earnings (`basePay` +
  `COMPONENT` earning lines; OT excluded) against `revisedAmount` =
  `PayrollCalculationService.calculateRegularEarnings(tenantId, employeeId,
  month, year, employeeSalaryId)` (prorated with that month's attendance/LOP,
  same rules as `calculateForEmployee`, no statutory). Writes one
  `SalaryArrear` per month with a non-zero difference (idempotent via the
  unique key; an existing non-CANCELLED row is left alone). `lines` =
  per-component `{ name, original, revised, delta }`; `pfWagesDelta` = delta of
  basic + `pfApplicable` components.
- **When:** automatically for every employee of a REGULAR run on
  process/recompute when `PayrollSettings.autoArrears` (default on), and on
  demand (`POST /payroll/arrears/detect`).
- **Inclusion:** a run (regular or off-cycle, for its employees) includes every
  PENDING arrear with `(forYear, forMonth)` earlier than the run's month:
  attached in the run's write transaction (`payrollRunId`, `status INCLUDED`),
  detached (back to PENDING, `payrollRunId` null) on recompute/reset/delete and
  re-attached by the recompute. PAID when the run is marked paid.
- **Payslip:** per employee the arrears are netted. Positive → one earning line
  `name 'Arrears', kind ARREAR, taxable true` (in `grossPay`,
  `arrearsAmount`, `nonRecurringTaxable`). Negative → one deduction line
  `'Arrears recovery', kind ARREAR` (post-tax; does not reduce taxable gross —
  documented simplification).
- **Statutory:** PF wages += `pfWagesDelta` (same ceiling as the month); ESI and
  professional tax on the regular gross only (`grossPay − nonRecurringTaxable`);
  TDS per C.T below.
- **Section 89:** arrears whose `financialYear` is earlier than the run's FY
  are prior-year arrears. When the employee's declaration for the receipt year
  has `form10EFurnished`, relief is computed with the existing
  `calculateSection89Relief` (exit/settlement/section-89-relief.ts) the way
  `settlement-tax.ts` builds its input (receipt year + one basis per spread
  year via `resolveIncomeTaxConfig`, `gratuity` absent) and reduces this
  month's TDS (floor 0). The working goes into `taxComputation.section89`.
  Without Form 10E: no relief, reason recorded.
- Cancel: `POST /payroll/arrears/:id/cancel` only from PENDING.

### C2. One-time payments

`PayrollOneTimePayment` rows attach to a run in DRAFT or COMPUTED status.

- Kinds BONUS, INCENTIVE, COMMISSION, OTHER_EARNING are earnings; RECOVERY,
  OTHER_DEDUCTION are deductions (post-tax; `taxable` ignored, stored false).
- Earning line: `{ name, amount, kind ONE_TIME, taxable, refId: payment.id }`.
  Taxable → in `grossPay` and `nonRecurringTaxable`; non-taxable → in
  `nonTaxableEarnings`. Deduction line: `{ name, amount, kind ONE_TIME }`.
- The employee must be ACTIVE (or, for an off-cycle run, in its scope). For a
  REGULAR run, an employee without a salary assignment gets no payslip and the
  payment is refused at creation (400).
- Adding or deleting on a COMPUTED run sets `needsRecompute = true`.
- `amount > 0`, `name` 1–100 chars, at most 50 payments per employee per run.

### C3. Hold / release / void

- `POST /payroll/runs/:id/holds` on a run in DRAFT, COMPUTED or APPROVED
  (not PAID): creates HELD. The payslip is still computed (tax and PF accrue
  in the month earned) but its net is withheld: excluded from the bank
  transfer file (`ReturnsService` bank export), shown as "Held" in the UI,
  credited to `HELD_SALARY` instead of `NET_PAY` in the journal.
  Holding on a COMPUTED run does not need a recompute.
- `DELETE /payroll/holds/:id` (unhold): only HELD and the run not PAID.
- **Release** `POST /payroll/holds/:id/release { targetRunId }`: the held run
  must be APPROVED or PAID; the target must be a different run of the tenant,
  DRAFT or COMPUTED, for the same employee's set (regular run: employee
  ACTIVE; off-cycle: in scope), and not earlier than the held run's month.
  Sets `heldAmount` = the held payslip's `netPay`, `releaseRunId`,
  `releasedAt/By`, status RELEASED, and target `needsRecompute` if COMPUTED.
  The target payslip gets `{ name: 'Held salary release (Mon YYYY)',
  kind HOLD_RELEASE, taxable false, refId: hold.id }` (already taxed; in
  `nonTaxableEarnings`). Detaching: resetting/deleting the target run returns
  the hold to HELD (`releaseRunId` null).
- **Void** `POST /payroll/holds/:id/void { reason }`: only HELD; status VOIDED.
  The original payslip stays as filed; the net is never paid. Write-off
  accounting is out of scope (the amount stays on `HELD_SALARY`).
- Notifications `SALARY_HELD` / `SALARY_RELEASED` to the employee
  (fire-and-forget; the message never states amounts).

### C4. Reimbursements through payroll

Opt-in per tenant: `PayrollSettings.reimburseExpensesViaPayroll`.

- On process/recompute of any run, for its employees, every ExpenseClaim with
  `status APPROVED` and `payrollRunId null` is attached in the write
  transaction by a guarded `updateMany({ where: { id, status: APPROVED,
  payrollRunId: null } })`. The payslip gets one line per employee
  `{ name: 'Reimbursements', kind REIMBURSEMENT, taxable false }` (amount =
  sum), `reimbursementAmount`, `nonTaxableEarnings`.
- Recompute/reset/delete detaches (`payrollRunId = null` where it is this run
  and status APPROVED).
- **Decision:** claims become `REIMBURSED` (`reimbursedAt = run.paidAt`) when
  the run is **marked PAID**, not at approval — that is when money moves.
  `EXPENSE_REIMBURSED` notifications are sent after that commit.
- `ExpensesService.markReimbursed` refuses (409 `"This claim is being
  reimbursed through payroll run …"`) a claim with a `payrollRunId`, and uses a
  guarded update itself.
- With the setting off nothing changes.

### C5. Off-cycle runs

- `POST /payroll/runs/off-cycle { month, year, reason, includeSalary,
  employeeIds[] }` (1–500 ids, ACTIVE or INACTIVE employees of the tenant) →
  DRAFT run, `runType OFF_CYCLE`, `sequence = max(sequence)+1` for the month
  (retry once on unique violation → 409).
- Processing computes payslips only for `scopeEmployeeIds`:
  - `includeSalary = true` (e.g. a missed joiner): the full month's salary as
    in a regular run. Refused (400) for an employee who already has a payslip
    in that month's REGULAR run.
  - `includeSalary = false`: `basePay = 0`, no components, no attendance, only
    arrears, one-time payments, hold releases, reimbursements, settlements.
  - Off-cycle runs **never** deduct loan EMIs and **never** call
    `LoansService.clearPayrollRepayments` (it is keyed by month and would
    reverse the regular run's instalments). Professional tax and LWF are not
    charged (monthly, charged by the regular run). PF on arrears only. TDS on
    `nonRecurringTaxable` per C.T.
  - An employee in scope with nothing to pay gets no payslip.
- Approval: same PAYROLL_RUN engine chain and maker-checker.
- **Settlements:** `POST /payroll/runs/:id/settlements { settlementId }`
  (off-cycle, DRAFT/COMPUTED; settlement APPROVED, not PAID, not carried) sets
  `Settlement.payrollRunId`. The payslip copies the settlement verbatim — no
  recalculation: earnings `kind SETTLEMENT` (pro-rata salary, leave encashment
  taxable/exempt, gratuity taxable/exempt, other earnings) with the exempt
  parts in `nonTaxableEarnings`, deductions notice recovery + other recoveries
  + `tds` column = `settlement.tds`; C1 asserts `netPay ===
  settlement.netPayable` and refuses otherwise. Marking the run PAID marks the
  settlement PAID (`paidAt`). `SettlementService` refuses to mark a carried
  settlement paid by itself. `DELETE /payroll/runs/:id/settlements/:settlementId`
  detaches.
- Statutory returns remain per run (an off-cycle run is filed on its own);
  combining is out of scope.

### C.T TDS with non-recurring income (statutory.service)

`StatutoryInput` gains `nonRecurringTaxable?: Decimal` (default 0) and
`priorYearArrears?: { amount: Decimal; financialYears: number[] }`:

- Projection: `annualGross = ytd.gross + (grossPay − nonRecurring) ×
  remainingMonths + nonRecurring` — a bonus is projected once.
- The tax attributable to the non-recurring amount (annual tax with it minus
  annual tax without it) is deducted in full this month; the recurring part is
  spread as today.
- ESI and professional tax are computed on `grossPay − nonRecurringTaxable`.
- Absent/zero → byte-for-byte today's behaviour (existing specs must pass
  unchanged).

### C6. Run lifecycle changes (payroll.service)

- `createRun` (REGULAR): uniqueness check by `(tenantId, month, year,
  REGULAR, 0)` (`findFirst`).
- `approveRun`: 400 `"Inputs changed since this run was computed; recompute it
  before approval"` when `needsRecompute`.
- process/recompute clear `needsRecompute`.
- `markAsPaid`: sets `paidAt`, then in one transaction: arrears → PAID,
  expense claims → REIMBURSED, settlements → PAID; notifications after commit.
- `resetRun`/`deleteRun`: detach arrears, claims, hold releases, settlements.
  One-time payments are deleted with the run on delete (cascade) and kept on
  reset.

### C7. Accounting export (WS-C2)

**GL mapping.** One account per `componentKey`. A key is either a payslip line
name (e.g. `HRA`, `Performance bonus`) or a system key (`GL_SYSTEM_KEYS` in
`accounting.types.ts`): `BASIC, OT_PAY, ARREARS, ARREARS_RECOVERY,
REIMBURSEMENT, HOLD_RELEASE, ONE_TIME_EARNING, ONE_TIME_DEDUCTION,
SETTLEMENT_EARNING, SETTLEMENT_RECOVERY, PF_EMPLOYEE, ESI_EMPLOYEE,
PROFESSIONAL_TAX, LWF_EMPLOYEE, TDS, LOAN_RECOVERY, <X>_EMPLOYER and
<X>_EMPLOYER_PAYABLE for PF, EPS, EDLI, PF_ADMIN, ESI, LWF, NET_PAY,
HELD_SALARY`.

**Resolution** per payslip line: exact line-name mapping → the kind's
system-key fallback (ONE_TIME earnings → `ONE_TIME_EARNING`, etc.) → suspense
account when configured **and** `allowUnmapped=true` → otherwise the export is
refused with 400 listing every unmapped key.

**Journal** per run (one voucher, dated the last day of the run month):

| Side | Source |
|---|---|
| Debit | `basePay` → BASIC; `otPay` → OT_PAY; each earning line (COMPONENT by name, ARREAR → ARREARS, ONE_TIME by name/fallback, REIMBURSEMENT, HOLD_RELEASE, SETTLEMENT by name/fallback); each employer contribution column → `<X>_EMPLOYER` |
| Credit | statutory employee columns (pfEmployee, esiEmployee, professionalTax, lwfEmployee, tds) → their keys; loan lines → LOAN_RECOVERY; other deduction lines by name/fallback; each employer contribution → `<X>_EMPLOYER_PAYABLE`; `netPay` → NET_PAY, or HELD_SALARY when the employee is held (SalaryHold HELD/VOIDED) in this run |

Statutory/loan **lines inside `deductions` JSON are skipped** (the columns are
the source) to avoid double counting. Lines aggregate by
`(glCode, costCenter, side)`; cost centre = department or branch name per
`costCenterMode` (`'Unassigned'` when missing). Debits must equal credits to
the paisa, else 500-free 400 `"Journal does not balance"` with the difference
(it signals a data defect).

**Formats.** `csv`: header `Voucher Date,Voucher No,GL Code,GL Name,Cost
Centre,Debit,Credit,Narration`, RFC 4180 quoting, formula-injection guard
(prefix `'` to cells starting with `= + - @`). `tally`: Tally ERP 9 / Prime
import XML — `ENVELOPE/HEADER/TALLYREQUEST=Import Data`,
`BODY/IMPORTDATA/REQUESTDESC/REPORTNAME=Vouchers` (+ `SVCURRENTCOMPANY` when
`tallyCompanyName`), one `VOUCHER VCHTYPE=<voucherType> ACTION="Create"` with
`DATE` (YYYYMMDD), `NARRATION`, `VOUCHERTYPENAME`, and one
`ALLLEDGERENTRIES.LIST` per line (`LEDGERNAME` = glName, debit:
`ISDEEMEDPOSITIVE=Yes` and negative `AMOUNT`; credit: `No` and positive), with
`CATEGORYALLOCATIONS.LIST/COSTCENTREALLOCATIONS.LIST` when a cost centre is
set. All text XML-escaped. Only APPROVED or PAID runs export (400 otherwise);
the JSON preview works for COMPUTED too. Every file export writes an AuditLog
(`action CREATE`, `entityType 'PayrollAccountingExport'`, `entityId` run id,
`newValues { format, allowUnmapped, totalDebit }`).

### C8. Variance report (WS-C2)

`GET /payroll/reports/variance?runId=&compareRunId=&thresholdPct=10`.
Default comparison: the previous month's REGULAR run (any status except DRAFT
and PROCESSING); `compareRun` null when none. Per employee (union of both
runs, all payslips of the run): status `NEW | LEFT | CHANGED | UNCHANGED`,
gross/deductions/net current, previous, delta, deltaPct (null when previous
is 0), `flagged` when `|deltaPct| ≥ thresholdPct` or NEW/LEFT; per component
deltas keyed like the GL keys (BASIC, OT_PAY, line names, statutory columns).
Run-level component rows with `employeesAffected`. `GET
/payroll/reports/variance/export` → CSV (same guard). Read-only; any status
except DRAFT/PROCESSING.

### C API summary

All `@Roles(SUPER_ADMIN, HR_ADMIN)`.

| Method | Path | WS |
|---|---|---|
| POST | `/payroll/runs/off-cycle` | C1 |
| GET/POST | `/payroll/runs/:id/one-time-payments` | C1 |
| DELETE | `/payroll/one-time-payments/:id` | C1 |
| GET | `/payroll/arrears?status=&employeeId=` | C1 |
| POST | `/payroll/arrears/detect` `{ employeeId }` | C1 |
| POST | `/payroll/arrears/:id/cancel` | C1 |
| GET/POST | `/payroll/runs/:id/holds` | C1 |
| GET | `/payroll/holds?status=` | C1 |
| DELETE | `/payroll/holds/:id` | C1 |
| POST | `/payroll/holds/:id/release` `{ targetRunId }` | C1 |
| POST | `/payroll/holds/:id/void` `{ reason }` | C1 |
| GET | `/payroll/runs/:id/reimbursements` | C1 |
| POST | `/payroll/runs/:id/settlements` `{ settlementId }` | C1 |
| DELETE | `/payroll/runs/:id/settlements/:settlementId` | C1 |
| GET/PUT | `/payroll/settings` | C1 |
| GET/PUT | `/payroll/accounting/config` | C2 |
| GET/PUT | `/payroll/accounting/gl-mappings` | C2 |
| GET | `/payroll/accounting/runs/:runId/journal?allowUnmapped=` | C2 |
| GET | `/payroll/accounting/runs/:runId/export?format=csv\|tally&allowUnmapped=` | C2 |
| GET | `/payroll/reports/variance` | C2 |
| GET | `/payroll/reports/variance/export` | C2 |

Response shapes: `payroll-depth.types.ts` (C1) and `accounting/accounting.types.ts`
(C2), mirrored in `frontend/src/lib/api-payroll-depth.ts` and
`frontend/src/lib/api-payroll-accounting.ts`.

### C edge cases

- Two concurrent processes of runs of the same month (regular + off-cycle)
  must not attach the same claim/arrear twice: every attach is a guarded
  `updateMany` on `payrollRunId: null`; a 0-row result for an item the
  calculation included → 409 and the whole write transaction rolls back.
- A second backdated revision covering months that already carry arrears from
  an earlier revision: the new revision has a different `employeeSalaryId`,
  so detection runs again. `originalAmount` for a month = the original
  payslip's regular earnings **plus** every non-CANCELLED arrear already
  recorded for that employee and month; only the remaining difference becomes
  a new arrear. Covered by a spec.
- A held employee who leaves: release into an off-cycle run.
- A run with `needsRecompute` cannot be approved; the UI shows a banner.
- Deleting a one-time payment whose run is APPROVED/PAID: 400.

---

## Part D — Hiring (ATS)

### D.0 Data model (scaffold)

```prisma
enum JobRequisitionStatus { DRAFT PENDING_APPROVAL APPROVED REJECTED CANCELLED FILLED }
enum JobOpeningStatus { DRAFT OPEN ON_HOLD CLOSED }
enum PipelineStageCategory { APPLIED SCREENING INTERVIEW OFFER HIRED REJECTED }
enum CandidateSource { CAREERS_PAGE REFERRAL AGENCY JOB_BOARD DIRECT OTHER }
enum JobApplicationStatus { ACTIVE REJECTED WITHDRAWN HIRED }
enum InterviewMode { IN_PERSON VIDEO PHONE }
enum InterviewStatus { SCHEDULED COMPLETED CANCELLED NO_SHOW }
enum InterviewRecommendation { STRONG_HIRE HIRE NO_HIRE STRONG_NO_HIRE }
enum JobOfferStatus { DRAFT PENDING_APPROVAL APPROVED REJECTED SENT ACCEPTED DECLINED EXPIRED WITHDRAWN }
enum PreOnboardingStatus { INVITED IN_PROGRESS SUBMITTED COMPLETED REVOKED EXPIRED }
WorkflowEntityType += JOB_REQUISITION, OFFER
NotificationType += REQUISITION_APPROVED, REQUISITION_REJECTED,
  APPLICATION_RECEIVED, INTERVIEW_SCHEDULED, INTERVIEW_FEEDBACK_SUBMITTED,
  OFFER_APPROVED, OFFER_REJECTED, OFFER_ACCEPTED, OFFER_DECLINED,
  PRE_ONBOARDING_SUBMITTED
```

| Model | Key fields | Uniques / indexes |
|---|---|---|
| `RecruitmentSettings` | tenantId, careersPageEnabled (false), careersIntro?, offerExpiryDays (7), preOnboardingExpiryDays (14), preOnboardingDocuments Json (default list) | tenantId unique |
| `JobRequisition` | title, departmentId?, designationId?, hiringManagerId? (Employee), headcount, employmentType, budgetMin/Max?, justification?, status, requestedById (user), requesterEmployeeId?, submittedAt?, decidedAt?, decisionNote?, filledCount | (tenantId, status) |
| `JobOpening` | requisitionId?, title, slug, description (Text), requirements?, location?, departmentId?, designationId?, branchId?, employmentType, experienceMin/Max?, salaryMin/Max?, showSalary (false), isPublic (true), positions, hiringManagerId?, status, publishedAt?, closedAt?, createdById | (tenantId, slug) unique; (tenantId, status) |
| `PipelineStage` | name(60), sortOrder, category, isActive | (tenantId, name) unique |
| `Candidate` | firstName, lastName, email (lower-cased), phone?, currentCompany?, currentTitle?, totalExperienceYears?, currentCtc?, expectedCtc?, noticePeriodDays?, location?, linkedinUrl?, source, referredByEmployeeId?, resumeUploadId?, notes?, createdById? | (tenantId, email) unique |
| `JobApplication` | candidateId, jobOpeningId, stageId, status, source, resumeUploadId?, coverLetter?, rejectionReason?, appliedAt, stageChangedAt, hiredAt?, createdById? (null = self-applied) | (jobOpeningId, candidateId) unique; (tenantId, stageId) |
| `JobApplicationStageEvent` | applicationId, fromStageId?, toStageId, movedById?, note?, createdAt | (applicationId) ; (tenantId, createdAt) |
| `Interview` | applicationId, roundName, scheduledStart, scheduledEnd, mode, location?, meetingLink?, status, notes?, createdById | (tenantId, scheduledStart) |
| `InterviewPanelist` | interviewId, employeeId | (interviewId, employeeId) unique |
| `InterviewFeedback` | interviewId, interviewerEmployeeId, overallRating 1–5, recommendation, scores Json, strengths?, concerns?, submittedAt | (interviewId, interviewerEmployeeId) unique |
| `JobOffer` | applicationId, candidateId, templateId (LetterTemplate), content (Text), designationId?, departmentId?, branchId?, reportingManagerId? (Employee), employmentType, annualCtc, monthlyBasePay?, salaryStructureId?, joiningDate (Date), expiresAt, status, tokenHash? (unique), sentAt?, respondedAt?, acceptedName?, declineReason?, respondedIp?, respondedUserAgent?, decisionNote?, createdById, employeeId? (converted), convertedAt? | tokenHash unique; (tenantId, status) |
| `PreOnboardingInvite` | employeeId, offerId? (unique), tokenHash (unique), expiresAt, status, requiredDocuments Json, personalDetails Json?, submittedAt?, lastAccessedAt?, createdById | tokenHash unique; (tenantId, status) |
| `PreOnboardingDocument` | inviteId, documentKey(50), employeeDocumentId (EmployeeDocument), uploadedAt | (inviteId, documentKey) unique |

`LetterType.OFFER_LETTER` already exists; offers use templates of that type.
Careers URL slug = `Tenant.code` (already `@unique`), matched
case-insensitively.

### D1. Requisitions, openings, stages, candidates, applications (WS-D1)

**Requisition lifecycle.** DRAFT → (submit) PENDING_APPROVAL → APPROVED |
REJECTED; DRAFT/REJECTED editable by the creator or HR; submit from DRAFT or
REJECTED restarts approval. Cancel from any non-terminal state (CANCELLED;
`engine.cancel`). FILLED is set automatically when `filledCount` reaches
`headcount` (incremented by D2 conversion through
`RequisitionsService.recordHire(tenantId, requisitionId, tx)`).

**Engine integration** (`requisition-workflow.handler.ts`, entity type
`JOB_REQUISITION`): `start` on submit with `requesterEmployeeId =
requesterEmployeeId`, `requesterUserId = requestedById`, `amount =
budgetMax × headcount` (null without a budget). Approve/reject delegate to
`RequisitionsService.approve/reject(actor, id, note)` which call `engine.act`
with the final transition in `onFinal`. describe: title `Requisition · <title>
× <headcount>`, link `/recruitment/requisitions`. Built-in default chain
(workflow.defaults.ts): one `HR_ADMIN` step, adminOverride true,
allowSelfApproval true (tenants tighten it in the builder).

**Openings.** Created by HR (optionally from an APPROVED requisition; sum of
`positions` across a requisition's non-CLOSED openings ≤ `headcount`). `slug`
generated from the title (`kebab-case`, max 80, `-2`, `-3` suffix on clash,
immutable after first publish). Publish: DRAFT/ON_HOLD → OPEN
(`publishedAt`); hold; close (CLOSED, `closedAt`; open applications stay).

**Pipeline stages.** `PipelineStagesService.ensureDefaults(tenantId)` creates
Applied/APPLIED, Screening/SCREENING, Interview/INTERVIEW, Offer/OFFER,
Hired/HIRED, Rejected/REJECTED on first read (`createMany skipDuplicates`).
`PUT /recruitment/pipeline-stages` replaces the ordered active list: names
unique, ≥1 stage in each of APPLIED, HIRED, REJECTED; the first active stage
must be APPLIED; a stage with applications cannot be removed (it is
deactivated instead and kept for history).

**Candidates.** Email trimmed + lower-cased. In-app create with an existing
email → 409 `{ message, existingCandidateId }`. `findOrCreateForCareers`
(consumed by D3) reuses an existing candidate and only fills **empty** fields
(never overwrites data from an unauthenticated source). CTC fields are
returned only to HR_ADMIN/SUPER_ADMIN.

**Applications.** One per (opening, candidate) — duplicate → 409 in-app;
`createFromCareers` returns `{ created: false }` silently for D3. Starts at
the first active APPLIED stage with a stage event. `moveToStage(input)` (the
shared contract, consumed by D2): target stage active and of the tenant;
REJECTED-category stage sets status REJECTED (+reason), HIRED-category sets
HIRED/`hiredAt`; moving an application that is not ACTIVE → 400; writes a
`JobApplicationStageEvent`; accepts `tx`. Withdraw → WITHDRAWN.

**Who.** HR_ADMIN/SUPER_ADMIN: everything. MANAGER: create/submit own
requisitions and see them; see openings where they are hiring manager and
their applications (read + move stages). Any employee: nothing here except
interviews (D2).

### D2. Interviews, feedback, offers, conversion (WS-D2)

**Interviews.** HR or the opening's hiring manager schedules on an ACTIVE
application: `scheduledEnd > scheduledStart`, 1–10 panelists (active employees
of the tenant). Panelists get `INTERVIEW_SCHEDULED` notifications and an email
(`interview-scheduled.hbs`). Reschedule/cancel/complete/no-show by the same
roles. `GET /recruitment/interviews/mine` → interviews where the actor's
employee is a panelist (actor without employeeId → empty list).

**Feedback.** Only a panelist, once per interview (update allowed by the same
panelist until the application leaves ACTIVE). `overallRating` 1–5, `scores`
≤ 20 items `{ criterion(100), rating 1–5, comment?(1000) }`. Visibility:
HR/SUPER and the hiring manager see all; a panelist sees others' feedback only
after submitting their own. Notifies HR and the hiring manager
(`INTERVIEW_FEEDBACK_SUBMITTED`).

**Offers.** HR creates from an ACTIVE application with an active
`OFFER_LETTER` template; content is rendered with the letters module's
isolated Handlebars environment (D2 extracts `renderLetterContent(content,
variables)` into `letters/letter-render.ts` and makes `LettersService` use it).
Variables: candidateName, firstName, lastName, email, designation,
department, branch, reportingManager, annualCtc (en-IN formatted),
monthlyBasePay, joiningDate, expiryDate, companyName, companyAddress,
currentDate. Edits allowed in DRAFT/REJECTED (re-render). At most one offer
per application in a non-terminal status (DRAFT..SENT) → 409.

Lifecycle: DRAFT → submit → PENDING_APPROVAL (engine `OFFER`, handler
`offer-workflow.handler.ts`, `requesterUserId = createdById`,
`requesterEmployeeId = null`, `amount = annualCtc`) → APPROVED / REJECTED →
send (APPROVED only; generates the public token, emails the candidate
`offer-sent.hbs` with `${FRONTEND_URL}/offer/<token>`, status SENT,
`expiresAt` = now + `offerExpiryDays` unless set later) → ACCEPTED / DECLINED
(public) / EXPIRED (lazily when read or acted on after `expiresAt`) /
WITHDRAWN (HR, from any non-terminal). Default chain: one `HR_ADMIN` step,
adminOverride true, allowSelfApproval true. Sending moves the application to
the first OFFER stage via `ApplicationsService.moveToStage` when it is in an
earlier stage.

**Public accept/decline** (`public-offers.controller.ts`, no auth, throttled
20/min GET, 5/min POST per IP): token → `JobOffer` by `tokenHash`; unknown →
404 `"This offer link is invalid or has expired"` (same message for expired).
GET returns `PublicOfferView` (company name/logo URL, candidate first name,
rendered content, CTC, joining date, expiry, status). Accept requires
`acceptedName` matching the candidate's full name (case/space-insensitive) —
records `respondedAt`, `acceptedName`, `respondedIp`, `respondedUserAgent`;
decline takes an optional reason (≤1000). Only a SENT, unexpired offer can be
answered (else 400). Guarded update `where { id, status: SENT }` → 409 on race.
HR and the creator are notified (`OFFER_ACCEPTED` / `OFFER_DECLINED`).

**Conversion** `POST /recruitment/offers/:id/convert { employeeCode,
createUser?, userEmail?, userPassword?, onboardingTemplateId? }` (HR; offer
ACCEPTED, not converted): one flow —
1. `EmployeesService.create` (reuses validation, user creation and the
   `employee.created` webhook) with names/email/phone from the candidate,
   department/designation/branch/manager/employmentType from the offer,
   `joinDate = joiningDate`.
2. When `salaryStructureId` and `monthlyBasePay` are set: an `EmployeeSalary`
   effective from `joiningDate`.
3. When `onboardingTemplateId`: `OnboardingService.createProcess` (scaffold
   exports it) with `startDate = joiningDate`.
4. Offer `employeeId/convertedAt`; application → HIRED stage;
   `RequisitionsService.recordHire` when the opening has a requisition.
Step 1 commits on its own (it is `EmployeesService.create`); steps 2 and 4 run
in one transaction afterwards, step 3 after that. Retry safety: conversion
first looks for an employee of the tenant with the candidate's email created
at or after the offer's `respondedAt`; when found it skips step 1 and resumes
from step 2, so a failure after step 1 can be retried without a 409.
Converting an offer that already has `employeeId` → 409. Covered by a spec.

### D3. Careers page, pre-onboarding, funnel (WS-D3)

**Settings.** `GET/PUT /recruitment/settings` (HR/SUPER): careersPageEnabled,
careersIntro (≤ 5000), offerExpiryDays (1–60), preOnboardingExpiryDays
(1–30), preOnboardingDocuments (1–20 items `{ key: /^[a-z0-9_]{1,50}$/,
label(100), category: DocumentCategory, required }`). Returns the careers URL.

**Public careers** (`public-careers.controller.ts`):
- `GET /public/careers/:tenantCode` → `{ company: { name, logoUrl, website,
  description, careersIntro }, jobs: PublicJobSummary[] }` — only OPEN +
  `isPublic` openings. Unknown code, inactive tenant or careers disabled →
  404 `"Careers page not found"` (identical in all three cases).
- `GET /public/careers/:tenantCode/jobs/:slug` → `PublicJobView`. Salary only
  when `showSalary`. Never: hiring manager, requisition, budget, ids other
  than slug.
- `POST /public/careers/:tenantCode/jobs/:slug/apply` multipart: `resume`
  file + fields (firstName, lastName, email, phone?, currentCompany?,
  currentTitle?, totalExperienceYears?, linkedinUrl?, coverLetter? ≤ 5000,
  `website` honeypot must be empty). Throttle 5/min/IP. Resume:
  PDF/DOC/DOCX, ≤ 5 MB, MIME **and** magic bytes (`%PDF-`, `PK\x03\x04`,
  `D0 CF 11 E0`). Stored through `UploadsService.upload(file, tenantId,
  'public:careers', 'CANDIDATE_RESUME', candidateId)`. Then
  `CandidatesService.findOrCreateForCareers` + `ApplicationsService.createFromCareers`
  (source CAREERS_PAGE). Always 201 `{ message: 'Application received' }`
  (also for a duplicate application — do not leak existence). HR users get
  `APPLICATION_RECEIVED` (fire-and-forget).

**Pre-onboarding.** HR (`pre-onboarding.controller.ts`):
- `POST /recruitment/pre-onboarding { employeeId, offerId?,
  requiredDocuments?, expiresInDays? }` → `{ invite, link }` (link returned
  only in this response and emailed with `pre-onboarding-invite.hbs` to the
  employee's personal or primary email). One live invite per employee
  (INVITED/IN_PROGRESS/SUBMITTED) → 409.
- `GET /recruitment/pre-onboarding?status=`, `GET /:id` (with uploaded
  documents), `POST /:id/revoke`, `POST /:id/resend` (new token, new expiry,
  old token dead), `POST /:id/complete` (HR reviewed; COMPLETED).
Public (`public-pre-onboarding.controller.ts`, throttled 30/min GET, 10/min
writes): `GET /public/pre-onboarding/:token` → company, employee first name,
joining date, required documents with upload state, submitted details,
status; `PUT /public/pre-onboarding/:token/details` (personal details only:
dateOfBirth, gender, maritalStatus, bloodGroup, fatherName, current/permanent
address fields, emergency contact fields, personalEmail, mobileNumber —
**no** bank, PAN, Aadhaar, UAN in this wave) written straight to the
`Employee` row and mirrored in `personalDetails`; `POST
/public/pre-onboarding/:token/documents/:documentKey` multipart (PDF/JPEG/PNG,
≤ 5 MB, magic bytes; key must be in `requiredDocuments`) → Upload
(`uploadedBy 'public:pre-onboarding'`, entityType `PRE_ONBOARDING`) +
unverified `EmployeeDocument` (category from the definition) +
`PreOnboardingDocument`; re-upload replaces (old EmployeeDocument, Upload and
file deleted); `POST /public/pre-onboarding/:token/submit` → SUBMITTED (all
required documents present, else 400), HR notified
(`PRE_ONBOARDING_SUBMITTED`). After SUBMITTED writes are refused (400) until
HR resends. Status IN_PROGRESS on first write; `lastAccessedAt` on every GET.
Expired/revoked/unknown → 404 same message.

**Funnel report** `GET /recruitment/reports/funnel?jobOpeningId=&from=&to=`
(HR/SUPER; MANAGER only for openings they manage, and `jobOpeningId`
required for them): applications created in the window; per active stage in
order: `reached` (applications with a stage event into that stage or a later
one), `current`, `conversionFromPrevious` (%), `avgDaysInStage`; totals:
applied, hired, rejected, withdrawn, offers sent/accepted/declined,
`offerAcceptanceRate`, `avgTimeToHireDays` (appliedAt → hiredAt); `bySource`
counts. Read-only.

### D API summary

Roles: H = HR_ADMIN + SUPER_ADMIN; M = + MANAGER (scoped as above);
A = any authenticated; P = public.

| Method | Path | Roles | WS |
|---|---|---|---|
| GET/POST | `/recruitment/requisitions` | M | D1 |
| GET/PATCH | `/recruitment/requisitions/:id` | M | D1 |
| POST | `/recruitment/requisitions/:id/submit` \| `/cancel` | M | D1 |
| GET/POST | `/recruitment/openings` | M (POST H) | D1 |
| GET/PATCH | `/recruitment/openings/:id` | M (PATCH H) | D1 |
| POST | `/recruitment/openings/:id/publish` \| `/hold` \| `/close` | H | D1 |
| GET | `/recruitment/openings/:id/applications` | M | D1 |
| GET | `/recruitment/pipeline-stages` | M | D1 |
| PUT | `/recruitment/pipeline-stages` | H | D1 |
| GET/POST | `/recruitment/candidates` | H | D1 |
| GET/PATCH | `/recruitment/candidates/:id` | H | D1 |
| POST | `/recruitment/applications` | H | D1 |
| GET | `/recruitment/applications/:id` | M | D1 |
| POST | `/recruitment/applications/:id/move` \| `/reject` \| `/withdraw` | M (withdraw H) | D1 |
| GET/POST | `/recruitment/applications/:id/interviews` | M | D2 |
| PATCH | `/recruitment/interviews/:id` | M | D2 |
| POST | `/recruitment/interviews/:id/cancel` \| `/complete` \| `/no-show` | M | D2 |
| GET | `/recruitment/interviews/mine` | A | D2 |
| GET/POST | `/recruitment/interviews/:id/feedback` | A (panelist) / M | D2 |
| GET | `/recruitment/offers?status=` | H | D2 |
| POST | `/recruitment/applications/:id/offers` | H | D2 |
| GET/PATCH | `/recruitment/offers/:id` | H | D2 |
| POST | `/recruitment/offers/:id/submit` \| `/send` \| `/withdraw` \| `/convert` | H | D2 |
| GET | `/recruitment/offers/:id/pdf` | H | D2 |
| GET | `/public/offers/:token` | P | D2 |
| POST | `/public/offers/:token/accept` \| `/decline` | P | D2 |
| GET/PUT | `/recruitment/settings` | H | D3 |
| GET | `/public/careers/:tenantCode` | P | D3 |
| GET | `/public/careers/:tenantCode/jobs/:slug` | P | D3 |
| POST | `/public/careers/:tenantCode/jobs/:slug/apply` | P | D3 |
| GET/POST | `/recruitment/pre-onboarding` | H | D3 |
| GET | `/recruitment/pre-onboarding/:id` | H | D3 |
| POST | `/recruitment/pre-onboarding/:id/revoke` \| `/resend` \| `/complete` | H | D3 |
| GET | `/public/pre-onboarding/:token` | P | D3 |
| PUT | `/public/pre-onboarding/:token/details` | P | D3 |
| POST | `/public/pre-onboarding/:token/documents/:documentKey` | P | D3 |
| POST | `/public/pre-onboarding/:token/submit` | P | D3 |
| GET | `/recruitment/reports/funnel` | M | D3 |

Approve/reject of requisitions and offers go through the unified
`POST /approvals/:entityType/:entityId/approve|reject` (Wave B).

Response shapes: `backend/src/modules/recruitment/recruitment.types.ts`,
mirrored in `frontend/src/lib/api-recruitment.ts` (authenticated) and
`frontend/src/lib/api-careers.ts` (public; its own axios instance without the
auth interceptor).

### D security notes (public endpoints)

- **Tokens** (offer, pre-onboarding): `generatePublicToken()` in
  `recruitment/public-token.util.ts` (scaffold): 32 random bytes → 64 hex
  chars; only `sha256(raw)` hex is stored (`tokenHash`, unique). The raw token
  exists only in the email and the create response. Lookups hash the input
  first; inputs not matching `/^[a-f0-9]{64}$/` are 404 without a query.
  Every token has an expiry; resend/regenerate invalidates the old hash.
- **Tenant isolation:** the tenant is derived from the careers code or from
  the token row; every subsequent query includes that `tenantId`. Public
  views never contain internal ids except the opening slug and document keys.
- **Enumeration:** unknown vs disabled vs expired all answer the same 404; the
  apply endpoint answers the same 201 for new and duplicate applications.
- **Throttling:** `ThrottlerGuard` per route as listed; the in-memory store is
  per instance (documented limitation).
- **Uploads:** type whitelist by MIME and magic bytes, 5 MB cap
  (`MaxFileSizeValidator`), stored under `CANDIDATE_RESUME/` or
  `PRE_ONBOARDING/` keys by `StorageService` (path-boundary checked). There is
  no public download route; HR downloads through the authenticated uploads /
  documents endpoints.
- **Spam:** honeypot field; per-IP throttle; `coverLetter` and free text
  length-capped; all text stored as plain text and rendered escaped.
- **PII:** candidate CTC visible to HR only; pre-onboarding collects no
  bank/tax identifiers; accept records IP and user agent as evidence.
- Offer content is rendered server-side from HR-authored templates in the
  isolated Handlebars env; the public page renders it as text/pre-wrap or
  sanitized HTML consistent with how `/my-letters` renders letters today.

### D edge cases

- Requisition approved, then opening positions exceed headcount → 400.
- Candidate applies to two openings: one candidate, two applications.
- Offer accepted after the application was rejected/withdrawn meanwhile:
  withdrawing the application withdraws a SENT offer; accepting checks the
  application is ACTIVE (else 400 "This offer is no longer available").
- Conversion with an `employeeCode` in use → 409 from `EmployeesService`.
- Interviewer who has no user account: sees nothing (no login) — allowed as
  panelist, reminded by HR out of band.
- Pre-onboarding for an employee whose join date has passed → allowed
  (catch-up), HR decides.

---

## Workstream table (file ownership, disjoint)

Scaffold (this commit, frozen afterwards — implementers must not edit):
`backend/prisma/schema.prisma`, `backend/prisma/migrations/20260927100000_keka_wave_c_d/migration.sql`,
`backend/src/test/helpers/prisma-mock.ts`, `backend/src/app.module.ts`,
`backend/src/modules/workflow/{workflow.types.ts, workflow.defaults.ts}`,
`backend/src/modules/payroll/{payroll.module.ts, payroll-lines.types.ts, payroll-depth.types.ts}`,
`backend/src/modules/payroll/accounting/accounting.types.ts`,
`backend/src/modules/recruitment/{recruitment.module.ts, recruitment.types.ts, public-token.util.ts (+spec)}`,
`backend/src/modules/onboarding/onboarding.module.ts` (export),
`frontend/src/components/layout/Sidebar.tsx`,
`frontend/src/lib/{api-payroll-depth.ts, api-payroll-accounting.ts, api-recruitment.ts, api-careers.ts, api-workflow.ts}`,
`frontend/src/app/(public)/layout.tsx`,
`frontend/src/app/(protected)/admin/workflows/page.tsx` (amount types only).
Also frozen: `payroll/payroll-lines.types.spec.ts`,
`recruitment/recruitment.module.spec.ts`, `recruitment/public-token.util.spec.ts`.
The scaffold also made minimal compile/expectation fixes in
`approval-engine.service.ts` (type labels), `workflow-definitions.service.spec.ts`
(eight types), `payroll.service.ts` + `payroll.service.spec.ts` (`createRun`
uniqueness lookup) and `admin/workflows/page.test.tsx` (eight tabs); those
files belong to their workstreams below. The stub services and controller
shells under `payroll/adjustments/`, `payroll/accounting/` and `recruitment/`
exist so the modules compile; each belongs to the workstream listed below,
which replaces the stub bodies (keeping cross-workstream signatures).

| WS | Backend files | Frontend files |
|---|---|---|
| **WS-B** | `workflow/approval-engine.service.ts` (+spec), `workflow/workflow-definitions.service.ts` (+spec), `workflow/workflows.controller.ts` (+spec), `leave/leave.service.ts` (+spec), `attendance/regularization.service.ts` (+spec), `attendance/policy/attendance-policy.service.ts` (+spec) | — |
| **WS-C1** | `payroll/payroll.service.ts`, `payroll/payroll-calculation.service.ts`, `payroll/payroll.controller.ts`, `payroll/dto/payroll.dto.ts`, `payroll/statutory/statutory.service.ts`, `payroll/returns/returns.service.ts`, `payroll/adjustments/**` (one-time-payments, salary-arrears, salary-holds, payroll-reimbursements, payroll-settings services, payroll-adjustments.controller, dto), `expenses/expenses.service.ts`, `exit/settlement/settlement.service.ts`, and all their specs (`payroll.service.spec.ts`, `payroll-approve.spec.ts`, `payroll-calculation.service.spec.ts`, `payroll.controller.spec.ts`, `statutory.service.spec.ts`, `returns.service.spec.ts`, `expenses.service.spec.ts`, `settlement.service.spec.ts`) | `app/(protected)/payroll/page.tsx` (+test), `app/(protected)/payroll/runs/[id]/page.tsx` (+test), `app/(protected)/payroll/arrears/page.tsx` (+test), `app/(protected)/payroll/holds/page.tsx` (+test), `app/(protected)/admin/payroll-settings/page.tsx` (+test), `components/payroll/adjustments/**`, `lib/api-payroll-depth.test.ts` |
| **WS-C2** | `payroll/accounting/**` except `accounting.types.ts` (gl-mapping.service, accounting-config.service, journal-builder.ts, csv-journal.ts, tally-xml.ts, accounting-export.service, variance-report.service, payroll-accounting.controller, payroll-reports.controller, dto, specs) | `app/(protected)/payroll/accounting/page.tsx` (+test), `app/(protected)/payroll/variance/page.tsx` (+test), `components/payroll/accounting/**`, `lib/api-payroll-accounting.test.ts` |
| **WS-D1** | `recruitment/{requisitions.service, requisitions.controller, requisition-workflow.handler, job-openings.service, job-openings.controller, pipeline-stages.service, pipeline-stages.controller, candidates.service, candidates.controller, applications.service, applications.controller}.ts`, `recruitment/dto/{requisition,job-opening,pipeline-stage,candidate,application}.dto.ts`, specs | `app/(protected)/recruitment/page.tsx`, `recruitment/requisitions/page.tsx`, `recruitment/openings/[id]/page.tsx`, `recruitment/candidates/page.tsx`, `recruitment/candidates/[id]/page.tsx`, `app/(protected)/admin/pipeline-stages/page.tsx` (+tests), `components/recruitment/pipeline/**`, `lib/api-recruitment.test.ts` (D1 functions) |
| **WS-D2** | `recruitment/{interviews.service, interviews.controller, offers.service, offers.controller, offer-workflow.handler, offer-conversion.service, public-offers.controller}.ts`, `recruitment/dto/{interview,offer}.dto.ts`, `letters/letter-render.ts` (+spec), `letters/letters.service.ts` (+spec), `common/email/templates/{offer-sent,interview-scheduled}.hbs`, specs | `app/(protected)/recruitment/applications/[id]/page.tsx`, `recruitment/interviews/page.tsx`, `recruitment/offers/page.tsx` (+tests), `app/(public)/offer/[token]/page.tsx` (+test), `components/recruitment/offers/**`, `components/recruitment/interviews/**`, `lib/api-recruitment.offers.test.ts` |
| **WS-D3** | `recruitment/{recruitment-settings.service, recruitment-settings.controller, public-careers.service, public-careers.controller, pre-onboarding.service, pre-onboarding.controller, public-pre-onboarding.controller, recruitment-reports.service, recruitment-reports.controller, upload-guards.ts}.ts`, `recruitment/dto/{settings,careers,pre-onboarding,reports}.dto.ts`, `common/email/templates/pre-onboarding-invite.hbs`, specs | `app/(public)/careers/[tenantCode]/page.tsx`, `app/(public)/careers/[tenantCode]/jobs/[slug]/page.tsx`, `app/(public)/pre-onboarding/[token]/page.tsx`, `app/(protected)/recruitment/pre-onboarding/page.tsx`, `app/(protected)/recruitment/reports/page.tsx`, `app/(protected)/admin/recruitment-settings/page.tsx` (+tests), `components/recruitment/careers/**`, `lib/api-careers.test.ts` |

Cross-workstream service contracts (stubs in the scaffold throw
`NotImplementedException` until the owner implements them; consumers mock
them in tests):

| Consumer | Provider | Method |
|---|---|---|
| D2 | D1 | `ApplicationsService.moveToStage(input: MoveApplicationInput)` |
| D2 | D1 | `RequisitionsService.recordHire(tenantId, requisitionId, tx?)` |
| D3 | D1 | `CandidatesService.findOrCreateForCareers(input: CareersCandidateInput)` |
| D3 | D1 | `ApplicationsService.createFromCareers(input: CareersApplicationInput)` |
| D2 | existing | `EmployeesService.create`, `OnboardingService.createProcess`, `UploadsService` |
| C2 | C1 (data only) | payslip lines per `payroll-lines.types.ts`, `SalaryHold` rows |

## Out of scope

Flexible benefit plans; combined statutory returns across regular and
off-cycle runs; write-off journal for voided salary; ESI on arrears; negative
arrears reducing taxable income; job board integrations; candidate email
inbox; e-signature beyond typed-name acceptance; bank/PAN/Aadhaar capture in
pre-onboarding; careers page theming.
