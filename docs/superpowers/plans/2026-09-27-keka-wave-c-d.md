# Keka Waves C and D — implementation plan

**Spec (binding):** `docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md`
**Branch:** `feat/keka-wave-c-d`. **Scaffold commit:** the commit that adds this
plan (schema, migration `20260927100000_keka_wave_c_d`, mock-Prisma models,
contract types, stub services / controller shells, module wiring, Sidebar,
frontend API clients).

## Global constraints (every workstream)

- **Frozen scaffold files — do not edit:** `backend/prisma/schema.prisma`,
  every migration, `backend/src/test/helpers/prisma-mock.ts`,
  `backend/src/app.module.ts`, `workflow/workflow.types.ts`,
  `workflow/workflow.defaults.ts`, `payroll/payroll.module.ts`,
  `payroll/payroll-lines.types.ts` (+spec), `payroll/payroll-depth.types.ts`,
  `payroll/accounting/accounting.types.ts`, `recruitment/recruitment.module.ts`
  (+spec), `recruitment/recruitment.types.ts`, `recruitment/public-token.util.ts`
  (+spec), `onboarding/onboarding.module.ts`, `frontend/src/components/layout/Sidebar.tsx`,
  `frontend/src/lib/{api-payroll-depth,api-payroll-accounting,api-recruitment,api-careers,api-workflow}.ts`,
  `frontend/src/app/(public)/layout.tsx`. If a contract is genuinely
  insufficient, stop and report NEEDS_CONTEXT with the exact change wanted.
- Touch only the files your workstream owns (spec "Workstream table"). New
  files you create inside your own directories/prefixes are yours.
- Six implementers run IN PARALLEL in the same working tree. Commit only your
  own paths: `git add <paths> && git commit -m "..." -- <paths>` (retry after a
  few seconds if `index.lock` exists). Never `git add -A`, `git stash`,
  `git checkout`/`reset` of other files. Do not push.
- TDD: write the failing spec first, then the code. Backend specs use
  `createMockPrismaService()` from `backend/src/test/helpers` (the `src/` copy;
  every new model is already in its list). UTC-noon dates in tests
  (`new Date('2026-03-15T12:00:00Z')`). Guard `AuthenticatedUser.employeeId`
  before using it in a `where`.
- Errors: 400 validation / state, 403 authorization, 404 missing or other
  tenant, 409 races and duplicates. Every query scoped by `tenantId`.
- DTOs use class-validator + Swagger decorators like the rest of the codebase
  (see `payroll/dto/payroll.dto.ts`, `workflow/dto/*`).
- Mock cross-workstream services (`ApplicationsService`, `CandidatesService`,
  `RequisitionsService`, `ApprovalEngineService`) with jest objects in your
  specs — never depend on another workstream's implementation.
- Jest path args are regexes: escape parentheses,
  `npx jest "src/app/\(protected\)/recruitment"`.
- `npm run lint` is broken repo-wide; ignore lint.
- Before reporting: your specs pass, `cd backend && npx tsc --noEmit -p tsconfig.json`
  and `cd frontend && npx tsc --noEmit` are clean **in your files** (others'
  in-progress files may be noisy — report, do not fix).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Frontend: follow existing pages (`app/(protected)/payroll/page.tsx`,
  `approvals/page.tsx`, `admin/workflows/page.tsx`): client components, the
  API clients from `@/lib/api-*.ts` (unwrap `.data`), `react-hot-toast`,
  components from `@/components/ui`, role gating via `useAuth().hasRole`,
  loading / empty / error states, `React.createElement` if you ever write JSX
  in a `.ts` file (don't).

---

## WS-B — Wave B follow-ups

**Owns:** `backend/src/modules/workflow/{approval-engine.service.ts,
workflow-definitions.service.ts, workflows.controller.ts}` + their specs;
`backend/src/modules/leave/leave.service.ts` + spec;
`backend/src/modules/attendance/{regularization.service.ts,
policy/attendance-policy.service.ts}` + specs.
**Consumes:** `PendingApprover` (workflow.types.ts), `AuditService` (global).

Tasks:
1. **B1 audit.** Spec first (`workflow-definitions.service.spec.ts`):
   upsert on a type with no row writes `auditLog.create` with action CREATE,
   entityType `WorkflowDefinition`, old = default view, new = saved view,
   `userId` = actor, **using the transaction client**; upsert of an existing
   row → UPDATE with the previous custom view as old; reset of a custom row →
   DELETE; reset with no row → no audit write. Then add `actorUserId` params,
   inject `AuditService`, call `audit.log(..., tx)`; wrap `reset` in a
   transaction. Controller passes `user.userId` (update controller spec).
2. **B2 engine + leave.** Spec: `getPendingApprovers` returns the step's
   approvers + on-behalf users with email/name, excludes the requester, `[]`
   for missing/terminal instance and when the resolver throws. Implement by
   sharing the recipient resolution with `notifyPending` (extract a private
   helper; `notifyPending` behaviour unchanged). Leave spec: creating a
   request no longer reads the manager employee for email; it emails each
   `getPendingApprovers` result with template `leave-request`; an engine
   returning `[]` sends nothing; email failure does not fail the create.
3. **B3 policy in tx.** Spec: `getOrCreate(tenantId, tx)` uses tx for
   findUnique/create/race re-read; regularization approve passes the `tx` it
   received in `onFinal` (assert `getOrCreate` called with the tx mock).

Acceptance: `npx jest src/modules/workflow src/modules/leave src/modules/attendance`
green; no behaviour change besides B1–B3.

---

## WS-C1 — Payroll run mechanics

**Owns:** `payroll/payroll.service.ts`, `payroll/payroll-calculation.service.ts`,
`payroll/payroll.controller.ts`, `payroll/dto/payroll.dto.ts`,
`payroll/statutory/statutory.service.ts`, `payroll/returns/returns.service.ts`,
`payroll/adjustments/**` (stubs exist: `one-time-payments.service.ts`,
`salary-arrears.service.ts`, `salary-holds.service.ts`,
`payroll-reimbursements.service.ts`, `payroll-settings.service.ts`,
`payroll-adjustments.controller.ts`; add `dto/adjustments.dto.ts`),
`expenses/expenses.service.ts`, `exit/settlement/settlement.service.ts`, and
their specs. Frontend: `app/(protected)/payroll/page.tsx`,
`payroll/runs/[id]/page.tsx`, `payroll/arrears/page.tsx`,
`payroll/holds/page.tsx`, `admin/payroll-settings/page.tsx` (+tests),
`components/payroll/adjustments/**`, `lib/api-payroll-depth.test.ts`.
**Consumes:** `payroll-lines.types.ts` (write lines exactly per contract),
`payroll-depth.types.ts` (views), `calculateSection89Relief`
(`exit/settlement/section-89-relief.ts`, read-only), `resolveIncomeTaxConfig`.

Tasks (in order; each spec-first):
1. **Settings.** `PayrollSettingsService.get/update` (defaults when no row,
   upsert). Routes `GET|PUT /payroll/settings`.
2. **Line contract in the calculation.** Refactor `calculateForEmployee` to
   accept an options object `{ includeSalary, deductLoans,
   chargeMonthlyStatutory, extras: { arrears, oneTimePayments,
   reimbursements, holdReleases, settlement? } }` (defaults = today). Write
   `kind` on every line (COMPONENT, STATUTORY, LOAN, ...). Compute
   `nonRecurringTaxable`, `nonTaxableEarnings`, `arrearsAmount`,
   `reimbursementAmount`, `netPay = gross + nonTaxable − deductions`.
   Existing calculation specs must pass unchanged with default options.
   Add `calculateRegularEarnings(tenantId, employeeId, month, year, employeeSalaryId)`.
3. **TDS (statutory.service).** `nonRecurringTaxable` projected once, its tax
   taken in full this month; ESI/PT on the regular part; prior-year arrears →
   section 89 relief when `form10EFurnished`. Existing statutory specs pass
   unchanged; new specs: a ₹1,00,000 bonus in October is not multiplied by the
   remaining months; tax on it is deducted in October; relief given only with
   Form 10E.
4. **One-time payments** service + routes (C2 rules, `needsRecompute`).
5. **Arrears**: detection (spec cases: backdated revision two months →
   two arrears; recompute is idempotent; second revision over the same months
   only adds the remaining difference; negative revision → recovery line;
   cancel only PENDING), inclusion/detach in process/recompute/reset/delete,
   PAID on markAsPaid. Routes.
6. **Holds**: hold/unhold/release/void per C3; bank transfer file in
   `returns.service.ts` excludes HELD/VOIDED employees of the run; release line
   in the target run; notifications. Routes.
7. **Reimbursements**: attach/detach in the run write tx with guarded
   `updateMany`; REIMBURSED on markAsPaid; `ExpensesService.markReimbursed`
   409 for attached claims and guarded update. Route `GET
   /payroll/runs/:id/reimbursements`.
8. **Off-cycle runs**: `POST /payroll/runs/off-cycle` (sequence allocation,
   scope validation), processing rules of C5 (no loans, no
   `clearPayrollRepayments`, no PT/LWF, includeSalary guard), `getRuns`
   returns `runType/sequence`; `approveRun` refuses `needsRecompute`;
   `markAsPaid` sets `paidAt` and settles carried items in one transaction.
9. **Settlements via off-cycle**: attach/detach routes, verbatim payslip,
   net equality assertion, settlement PAID with the run; `SettlementService`
   refuses to pay a carried settlement.
10. **Frontend**: payroll list shows run type badge and "New off-cycle run"
    dialog (employee multi-select, reason, include-salary toggle); run detail
    gets tabs *One-time payments* (add/delete when DRAFT/COMPUTED), *Holds*
    (hold/unhold/release/void), *Reimbursements* (read-only list), *Arrears*
    (included arrears), *Settlements* (off-cycle), a `needsRecompute` banner,
    "Held" badge on payslip rows; `/payroll/arrears` (filter, detect for an
    employee, cancel); `/payroll/holds` (list, release to a run, void);
    `/admin/payroll-settings` (two toggles). Client tests for every
    `payrollDepthApi` function (URL, method, payload).

Acceptance: `npx jest src/modules/payroll src/modules/expenses src/modules/exit`
green (old specs unchanged except signature updates); frontend
`npx jest "src/app/\(protected\)/payroll" "src/app/\(protected\)/admin/payroll-settings" src/lib/api-payroll-depth`
green; tsc clean.

---

## WS-C2 — Accounting export and variance report

**Owns:** `payroll/accounting/**` except `accounting.types.ts` (stubs exist:
`gl-mapping.service.ts`, `accounting-config.service.ts`,
`accounting-export.service.ts`, `variance-report.service.ts`,
`payroll-accounting.controller.ts`, `payroll-reports.controller.ts`; add
`journal-builder.ts`, `csv-journal.ts`, `tally-xml.ts`, `dto/accounting.dto.ts`)
+ specs. Frontend: `app/(protected)/payroll/accounting/page.tsx`,
`payroll/variance/page.tsx` (+tests), `components/payroll/accounting/**`,
`lib/api-payroll-accounting.test.ts`.
**Consumes:** `payroll-lines.types.ts` (`classifyPayslipLine`,
line-name constants), `SalaryHold` rows (read), `accounting.types.ts`.
Works on existing data from day one (legacy lines have no `kind`); does not
wait for WS-C1.

Tasks:
1. **Config + mappings** services and routes (`GET|PUT config`,
   `GET|PUT gl-mappings` with `{ mappings }` body; replace-all in a
   transaction; codes/names trimmed, non-empty; duplicate keys → 400;
   audit-logged). `knownKeys` = `GL_SYSTEM_KEYS` + earning/deduction component
   names from active salary structures + distinct one-time payment names of
   the last 12 months, each with `mapped`.
2. **`journal-builder.ts`** (pure function, most of the tests): payslips +
   holds + mappings + config → `JournalLine[]` per the spec table. Specs:
   balanced for a plain run; statutory lines in JSON are not double counted;
   employer contributions produce expense + payable; held employee's net goes
   to HELD_SALARY; unmapped keys reported; suspense used only with
   allowUnmapped; cost centre by department/branch/'Unassigned';
   aggregation per `(glCode, costCenter, side)`; paisa rounding with Decimal.
3. **`csv-journal.ts`** (quoting, formula-injection guard) and
   **`tally-xml.ts`** (envelope, escaping `& < > " '`, debit negative with
   `ISDEEMEDPOSITIVE=Yes`, YYYYMMDD date, cost-centre allocation). Snapshot-free
   assertions on exact strings for a two-line voucher.
4. **Export service + routes**: preview for COMPUTED/APPROVED/PAID (`exportable`
   flag), export only APPROVED/PAID (400 otherwise), 400 on unmapped without
   `allowUnmapped`, audit row; controller streams with
   `Content-Disposition: attachment; filename="journal-<yyyy>-<mm>[-oc<n>].<csv|xml>"`.
5. **Variance service + routes**: default comparison run resolution, statuses
   NEW/LEFT/CHANGED/UNCHANGED, `deltaPct` null on 0, threshold flagging,
   component rows with `employeesAffected`, CSV export with the same guard.
6. **Frontend** `/payroll/accounting`: config form, mapping table (known keys
   with category/side, inline code+name, unmapped highlighted, save all), run
   picker → journal preview (debit/credit totals, balanced badge, unmapped
   warning) → download CSV / Tally XML. `/payroll/variance`: run and compare
   pickers, threshold input, totals cards, employee table (flagged filter,
   expandable component deltas), component table, CSV download. Client tests
   for every `payrollAccountingApi` function.

Acceptance: `npx jest src/modules/payroll/accounting` green, frontend tests
green, tsc clean.

---

## WS-D1 — Requisitions, openings, stages, candidates, applications

**Owns:** `recruitment/{requisitions,job-openings,pipeline-stages,candidates,applications}.{service,controller}.ts`,
`recruitment/requisition-workflow.handler.ts`,
`recruitment/dto/{requisition,job-opening,pipeline-stage,candidate,application}.dto.ts`
+ specs. Frontend: `app/(protected)/recruitment/page.tsx`,
`recruitment/requisitions/page.tsx`, `recruitment/openings/[id]/page.tsx`,
`recruitment/candidates/page.tsx`, `recruitment/candidates/[id]/page.tsx`,
`app/(protected)/admin/pipeline-stages/page.tsx` (+tests),
`components/recruitment/pipeline/**`, `lib/api-recruitment.test.ts` (D1 functions).
**Provides (stub signatures already in place — keep them exactly):**
`ApplicationsService.moveToStage(MoveApplicationInput)`,
`ApplicationsService.createFromCareers(CareersApplicationInput)`,
`CandidatesService.findOrCreateForCareers(CareersCandidateInput)`,
`RequisitionsService.recordHire(tenantId, requisitionId, tx?)`.
**Consumes:** `ApprovalEngineService` (start / act / cancel /
listActionableEntityIds), `recruitment.types.ts`.

Tasks:
1. Pipeline stages: `ensureDefaults` (createMany skipDuplicates),
   `list`, `replace` (`PUT` body `{ stages: [{ id?, name, category }] }`) with
   the spec's validation; stages in use are deactivated not deleted.
2. Requisitions: CRUD + submit (engine.start with the spec's context) +
   cancel (engine.cancel) + approve/reject via engine.act with the final
   transition in `onFinal` (+ `REQUISITION_APPROVED/REJECTED` notification to
   the requester after commit) + `getWorkflowContext` + `recordHire`. MANAGER
   scoping. Handler `describe` implemented. Specs cover every transition,
   ADVANCED keeps PENDING_APPROVAL, manager cannot see others' requisitions.
3. Openings: create (from APPROVED requisition only; positions ≤ remaining
   headcount), slug generation + clash suffix, publish/hold/close,
   `listApplications` (kanban cards), MANAGER scope (hiring manager only).
4. Candidates: lower-cased email, 409 with `existingCandidateId`, CTC hidden
   for non-HR, search (name/email ilike), `findOrCreateForCareers` fills empty
   fields only.
5. Applications: create (first APPLIED stage + stage event), get with
   history, move/reject/withdraw, `moveToStage` shared contract (tx support,
   category resolution, status side effects), `createFromCareers`
   (`{ created: false }` on duplicate; source CAREERS_PAGE; `createdById`
   null; stage event with `movedById` null).
6. Frontend: openings list with status filter + create dialog (HR);
   requisitions list/create/edit/submit/cancel with status chips and
   `ApprovalTrail` (from `components/approvals`) for PENDING_APPROVAL;
   opening detail = kanban board by stage (move via menu/drag, reject with
   reason), candidate list/search/create (resume via `POST /uploads` with
   entityType `CANDIDATE_RESUME`, then `resumeUploadId`), candidate detail;
   `/admin/pipeline-stages` editor (reorder, rename, category, add,
   deactivate). Application cards link to `/recruitment/applications/<id>`
   (WS-D2's page).

Acceptance: `npx jest src/modules/recruitment -t "Requisition|Opening|Pipeline|Candidate|Application"` style runs of your spec files green; frontend tests green; tsc clean.

---

## WS-D2 — Interviews, feedback, offers, conversion

**Owns:** `recruitment/{interviews,offers}.{service,controller}.ts`,
`recruitment/offer-workflow.handler.ts`, `recruitment/offer-conversion.service.ts`,
`recruitment/public-offers.controller.ts`, `recruitment/dto/{interview,offer}.dto.ts`,
`letters/letter-render.ts` (+spec), `letters/letters.service.ts` (+spec),
`common/email/templates/{offer-sent,interview-scheduled}.hbs`, specs.
Frontend: `app/(protected)/recruitment/applications/[id]/page.tsx`,
`recruitment/interviews/page.tsx`, `recruitment/offers/page.tsx` (+tests),
`app/(public)/offer/[token]/page.tsx` (+test),
`components/recruitment/{offers,interviews}/**`, `lib/api-recruitment.offers.test.ts`.
**Consumes:** `ApplicationsService.moveToStage`, `RequisitionsService.recordHire`
(mock them), `EmployeesService.create`, `OnboardingService.createProcess`,
`public-token.util.ts`, `ApprovalEngineService`, `EmailService`.

Tasks:
1. Extract `renderLetterContent(content, variables)` into
   `letters/letter-render.ts` (isolated Handlebars env, proto flags);
   `LettersService.generateLetter` uses it; existing letters specs pass.
2. Interviews: schedule/update/cancel/complete/no-show, panel validation,
   notifications + `interview-scheduled` email, `mine`. Feedback submit/update
   (panelist only), visibility rule, notification.
3. Offers: create (template type OFFER_LETTER, one live offer per
   application → 409), update + re-render, submit (engine.start), approve/reject
   (engine.act; OFFER_APPROVED/REJECTED to creator), send (token via
   `generatePublicToken`, store hash, expiry from settings or DTO, email
   `offer-sent` with `${FRONTEND_URL}/offer/<raw>`, move application to OFFER
   stage when earlier), withdraw, lazy EXPIRED, PDF (reuse the letters PDF
   approach), handler `describe`.
4. Public accept/decline (`public-offers.controller.ts`): ThrottlerGuard +
   `@Throttle`, `isWellFormedPublicToken` check, identical 404s, name match,
   guarded update, IP/user-agent capture (`req.ip`, `user-agent` header,
   truncated), application must be ACTIVE, notifications.
5. Conversion service per spec (retry-safe lookup, EmployeeSalary when
   structure + base pay, onboarding process, offer/app/requisition updates in
   a transaction). Specs for each step and the retry path.
6. Frontend: application detail (candidate panel, stage + history from D1's
   `getApplication`, interviews list/schedule dialog with employee picker,
   feedback view respecting `visible`, offers section: create/edit/submit/
   send/withdraw/convert dialog, status timeline); `/recruitment/interviews`
   (my upcoming/past, feedback form with scorecard rows);
   `/recruitment/offers` (list by status); public `/offer/[token]` (letter
   content rendered safely as pre-wrapped text, accept with typed full name,
   decline with reason, terminal-state messages, expired message). Tests for
   the offers/interviews client functions and pages.

Acceptance: recruitment interview/offer specs + letters specs green; frontend
tests green; tsc clean.

---

## WS-D3 — Careers page, pre-onboarding, funnel

**Owns:** `recruitment/{recruitment-settings,public-careers,pre-onboarding,recruitment-reports}.service.ts`,
`recruitment/{recruitment-settings,public-careers,pre-onboarding,public-pre-onboarding,recruitment-reports}.controller.ts`,
`recruitment/upload-guards.ts`, `recruitment/dto/{settings,careers,pre-onboarding,reports}.dto.ts`,
`common/email/templates/pre-onboarding-invite.hbs`, specs. Frontend:
`app/(public)/careers/[tenantCode]/page.tsx`,
`app/(public)/careers/[tenantCode]/jobs/[slug]/page.tsx`,
`app/(public)/pre-onboarding/[token]/page.tsx`,
`app/(protected)/recruitment/pre-onboarding/page.tsx`,
`recruitment/reports/page.tsx`, `app/(protected)/admin/recruitment-settings/page.tsx`
(+tests), `components/recruitment/careers/**`, `lib/api-careers.test.ts`.
**Consumes:** `CandidatesService.findOrCreateForCareers`,
`ApplicationsService.createFromCareers` (mock them), `UploadsService`,
`StorageService`, `public-token.util.ts`, `DEFAULT_PRE_ONBOARDING_DOCUMENTS`.

Tasks:
1. `upload-guards.ts`: magic-byte + MIME + size checks
   (`assertResume(file)`: PDF/DOC/DOCX ≤ 5 MB; `assertDocument(file)`:
   PDF/JPEG/PNG ≤ 5 MB) → 400 with a plain message. Specs with real byte
   headers and spoofed MIME types.
2. Settings service/controller (defaults when no row; validation; careers URL).
3. Public careers: tenant resolution (code case-insensitive, active, enabled)
   → identical 404; list/detail field whitelist (spec test asserting no
   internal ids / budget / manager leak); apply (multer memory storage via
   `FileInterceptor('resume')`, throttle 5/min, honeypot, guards, upload,
   D1 contracts, always 201 same body, `APPLICATION_RECEIVED` to HR users).
4. Pre-onboarding HR: create (one live invite per employee → 409; link
   returned once; email), list/get/revoke/resend/complete.
5. Public pre-onboarding: get (updates `lastAccessedAt`, lazily EXPIRED),
   details (whitelisted fields only, written to Employee + mirrored JSON),
   document upload (key in checklist, replace semantics deleting the previous
   EmployeeDocument/Upload/file), submit (required docs present), throttles,
   identical 404s, SUBMITTED lock.
6. Funnel report service/controller (MANAGER scoping, window, stage
   `reached`/conversion/avg days from stage events, totals, by source).
7. Frontend: public careers list + job page with apply form (file input,
   client-side type/size check, hidden honeypot, success state); public
   pre-onboarding portal (checklist with upload per document, details form,
   submit, expired/revoked state); HR `/recruitment/pre-onboarding` (list,
   create for an employee with checklist editor, copy link once, revoke,
   resend, complete, view uploaded docs); `/recruitment/reports` (funnel bars,
   totals, by-source); `/admin/recruitment-settings` (toggle, intro, expiries,
   checklist editor, careers URL with copy). Tests for `careersApi`,
   `publicOfferApi`, `preOnboardingApi` URL/method/payload (use `publicApi`,
   no Authorization header) and each page.

Acceptance: D3 specs green; frontend tests green; tsc clean.

---

## After the workstreams

1. One review per workstream against this plan and the spec (security
   checklist for D2/D3 public endpoints).
2. Whole-branch review; one fix wave.
3. Full suites: `cd backend && npx jest`, `cd frontend && npx jest`, both tsc.
4. After merge: `npx prisma migrate deploy` (remote DB), then smoke: create an
   off-cycle run, export a journal, publish an opening, apply on the careers
   page, send and accept an offer, convert, send a pre-onboarding link.
