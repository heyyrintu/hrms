# Keka Gap Closure Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship forgot-password, bulk employee import, leave carry-forward, attendance rules (late marks / auto-absent / absent LOP), loans & advances, and an HR helpdesk, as one PR.

**Architecture:** One controller-owned scaffold commit adds every new Prisma model, enum, migration, mock-model entry, empty NestJS module shell, and sidebar entry. Six file-disjoint workstreams then run in parallel, each a full-stack slice (NestJS service + controller + specs, Next.js page + test). A final integration task wires the loans payroll hook into the payroll calculation and runs type-check and both suites.

**Tech Stack:** NestJS 11, Prisma + PostgreSQL, @nestjs/schedule, multer, Handlebars email, Next.js 16, React 19, axios, react-hot-toast, Jest.

**Spec:** `docs/superpowers/specs/2026-09-21-keka-gap-wave-a-design.md` (read the "Shared constraints" and your workstream's section; they are binding).

## Global Constraints

- Every Prisma query is scoped by `tenantId` taken from the authenticated user, never from the request body.
- Protected endpoints use `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)`. Role names: `SUPER_ADMIN`, `HR_ADMIN`, `MANAGER`, `EMPLOYEE`.
- `user.employeeId` may be undefined; throw `ForbiddenException` before using it in a `where`.
- Backend specs import `createMockPrismaService` from `'../../test/helpers'` (resolves to `backend/src/test/helpers/`). Do not touch `backend/test/helpers/`.
- Frontend API calls: new file `frontend/src/lib/api-<feature>.ts` that does `import { api } from '@/lib/api'` and exports `<feature>Api`. Do not edit `frontend/src/lib/api.ts`.
- Do NOT edit: `backend/prisma/schema.prisma`, anything under `backend/prisma/migrations/`, `backend/src/app.module.ts`, `backend/src/test/helpers/prisma-mock.ts`, `frontend/src/components/layout/Sidebar.tsx`. If you believe one needs a change, say so in your report under "Concerns" and continue.
- Do NOT run `prisma migrate dev` or `prisma db push`. `npx prisma generate` has already been run by the scaffold.
- Jest path args are regexes: escape `(protected)` as `"src/app/\(protected\)/<dir>"`.
- Calendar-date test fixtures use UTC noon, e.g. `new Date('2026-03-15T12:00:00Z')`.
- JSX is not allowed in `.ts` files.
- Commit after each green test cycle with a conventional-commit message. Do not push.
- Never dispatch subagents.

---

### Task 0: Scaffold (controller-owned, already done when Tasks 1-6 dispatch)

**Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260921120000_keka_wave_a/migration.sql`, `backend/src/test/helpers/prisma-mock.ts`, `backend/src/app.module.ts`, `backend/src/modules/loans/loans.module.ts`, `backend/src/modules/helpdesk/helpdesk.module.ts`, `frontend/src/components/layout/Sidebar.tsx`.

Produces the models, enums, and notification types listed in the spec's "Schema" section, empty `LoansModule` and `HelpdeskModule` registered in `AppModule`, and sidebar links for `/loans`, `/approvals/loans`, `/payroll/loans`, `/helpdesk`, `/admin/helpdesk`, `/admin/attendance-policy`, `/employees/import`.

---

### Task 1: Forgot / reset password

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.module.ts` (import `EmailModule` if not already), `backend/src/config/env.validation.ts` (add optional `FRONTEND_URL`, default `http://localhost:3000`)
- Create: `backend/src/modules/auth/dto/forgot-password.dto.ts`, `backend/src/modules/auth/dto/reset-password.dto.ts`, `backend/src/modules/auth/password-reset.service.ts`, `backend/src/modules/auth/password-reset.service.spec.ts`, `backend/src/common/email/templates/password-reset.hbs`
- Create: `frontend/src/app/forgot-password/page.tsx` + `page.test.tsx`, `frontend/src/app/reset-password/page.tsx` + `page.test.tsx`, `frontend/src/lib/api-password-reset.ts`
- Modify: `frontend/src/app/login/page.tsx` (add "Forgot password?" link to `/forgot-password`)
- Test: `backend/src/modules/auth/auth.controller.spec.ts` (extend)

**Interfaces:**
- Consumes: `PasswordResetToken` Prisma model (`prisma.passwordResetToken`), `EmailService.sendEmail`, `User.tokenVersion`, `User.mustChangePassword`, existing password hashing in `auth.service.ts`.
- Produces: `POST /auth/forgot-password`, `POST /auth/reset-password` exactly as the spec describes.

- [ ] Write failing specs for `PasswordResetService`: `requestReset` returns silently for unknown email, creates a hashed token + sends email for a known active user, invalidates prior unused tokens; `resetPassword` rejects unknown/used/expired tokens with `BadRequestException`, updates `passwordHash`, bumps `tokenVersion`, clears `mustChangePassword`, marks `usedAt`.
- [ ] Implement the service (`crypto.randomBytes(32).toString('hex')`, `sha256` hash, 60-minute expiry).
- [ ] Add the two controller endpoints with `@Throttle({ default: { limit: 3, ttl: 60000 } })` on forgot-password, both `@Public()` / no guard as the existing `login` is.
- [ ] Add the email template and the env var.
- [ ] Frontend pages: forgot form (email) → success message regardless; reset form (new password + confirm) reading `token` from the query string → toast + redirect to `/login`.
- [ ] Run `npx jest src/modules/auth` and `npx jest "src/app/forgot-password" "src/app/reset-password"`; commit.

---

### Task 2: Bulk employee CSV import

**Files:**
- Create: `backend/src/modules/employees/import/employee-import.service.ts`, `employee-import.service.spec.ts`, `employee-import.controller.ts`, `employee-import.controller.spec.ts`, `csv-parser.ts` (tiny RFC-4180 parser, no new dependency), `dto/import-employees.dto.ts`
- Modify: `backend/src/modules/employees/employees.module.ts` (register the controller + service)
- Create: `frontend/src/app/(protected)/employees/import/page.tsx` + `page.test.tsx`, `frontend/src/lib/api-employee-import.ts`
- Modify: `frontend/src/app/(protected)/employees/page.tsx` (add an "Import CSV" button linking to `/employees/import`)

**Interfaces:**
- Consumes: `prisma.employee`, `prisma.user`, `prisma.department`, `prisma.designation`, `prisma.branch`, `bcrypt`, `AuditService` if one exists (else `prisma.auditLog.create`).
- Produces: `POST /employees/import?dryRun=` (multipart `file`, body `initialPassword`), `GET /employees/import/template`, response shape `{ totalRows, validRows, invalidRows, errors: [{ row, field, message }], created }`.

- [ ] Write failing specs: parses header case-insensitively; flags missing required fields with row numbers (1-based data rows); flags duplicate `employeeCode`/`email` inside the file and against the tenant; resolves department/designation/branch codes; resolves `managerEmployeeCode` against the tenant OR an earlier row; dry run creates nothing; real run creates employees + users with `mustChangePassword: true` inside `prisma.$transaction`; any invalid row rejects the whole file with 400 carrying the error list; >2000 rows rejected; >2 MB rejected.
- [ ] Implement parser, service, controller (`FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } })`, roles HR_ADMIN + SUPER_ADMIN).
- [ ] Frontend page: file input → "Preview" calls dry run → table of rows with errors highlighted → "Import N employees" button enabled only when `invalidRows === 0`, prompts for initial password.
- [ ] Run the specs and page test; commit.

---

### Task 3: Leave year-end carry-forward

**Files:**
- Create: `backend/src/modules/leave/leave-carry-forward.service.ts`, `leave-carry-forward.service.spec.ts`, `leave-carry-forward-cron.service.ts`, `leave-carry-forward.controller.ts`, `leave-carry-forward.controller.spec.ts`, `dto/run-carry-forward.dto.ts`
- Modify: `backend/src/modules/leave/leave.module.ts` (register)
- Create: `frontend/src/lib/api-carry-forward.ts`
- Modify: `frontend/src/app/(protected)/admin/accrual-history/page.tsx` (+ its test) to add the carry-forward card

**Interfaces:**
- Consumes: `prisma.leaveCarryForwardRun`, `prisma.leaveBalance`, `prisma.leaveType`, `prisma.employee`, `NotificationsService.notifyEmployee`, `AccrualTriggerType` enum.
- Produces: `LeaveCarryForwardService.runCarryForward(tenantId: string, fromYear: number, triggerType: AccrualTriggerType, triggeredById?: string): Promise<{ runId: string; processedCount: number; failedCount: number; alreadyRan: boolean }>`, `POST /leave/carry-forward/run`, `GET /leave/carry-forward/runs`.

- [ ] Write failing specs covering: carry = min(remaining, maxCarryForward); negative remaining carries 0; pendingDays not deducted; leave types with `carryForward=false` skipped; new `toYear` balance created with `totalDays = defaultDays`; existing `toYear` balance only gets `carriedOver` updated; second call for the same `(tenantId, fromYear)` returns `alreadyRan: true` and writes nothing; per-employee failure is caught, logged in `errorLog`, and counted in `failedCount`; notification sent only when carry > 0.
- [ ] Implement the service, the cron (`0 3 1 1 *`, `Asia/Kolkata`, `fromYear = now.getFullYear() - 1`, loops active tenants like `leave-accrual-cron.service.ts`), the controller.
- [ ] Frontend card on the accrual-history page: run list (fromYear, toYear, status, counts, startedAt) and a form with `fromYear` (default last year) + button.
- [ ] Run `npx jest src/modules/leave` and the page test; commit.

---

### Task 4: Attendance rules

**Files:**
- Create: `backend/src/modules/attendance/policy/attendance-policy.service.ts`, `attendance-policy.service.spec.ts`, `attendance-policy.controller.ts`, `attendance-policy.controller.spec.ts`, `dto/update-attendance-policy.dto.ts`, `backend/src/modules/attendance/rules/late-mark.ts` (pure function), `late-mark.spec.ts`, `backend/src/modules/attendance/rules/auto-absent.service.ts`, `auto-absent.service.spec.ts`, `auto-absent-cron.service.ts`
- Modify: `backend/src/modules/attendance/attendance.service.ts` (clock-in sets `isLate`/`lateByMinutes`; clock-out applies the late-mark → HALF_DAY rule), `attendance.service.spec.ts`, `attendance.controller.ts` (add `POST /attendance/mark-absent`), `attendance.module.ts`
- Modify: `backend/src/modules/payroll/payroll-calculation.service.ts` (`getAttendanceData`: count ABSENT rows as `lopDays` when policy `absentIsLop`), `payroll-calculation.service.spec.ts`
- Create: `frontend/src/app/(protected)/admin/attendance-policy/page.tsx` + `page.test.tsx`, `frontend/src/lib/api-attendance-policy.ts`
- Modify: `frontend/src/app/(protected)/attendance/page.tsx` (+ test) to show a "Late (+N min)" badge

**Interfaces:**
- Consumes: `prisma.attendancePolicy`, `AttendanceRecord.isLate/lateByMinutes/autoMarked`, `prisma.shiftAssignment`, `prisma.shift`, `prisma.holiday`, `prisma.leaveRequest`, `prisma.compOffRequest`.
- Produces: `computeLateMark(clockIn: Date, shiftStart: 'HH:mm', graceMinutes: number, tz = 'Asia/Kolkata'): { isLate: boolean; lateByMinutes: number }`; `AttendancePolicyService.getOrCreate(tenantId)`; `AutoAbsentService.markAbsentForDate(tenantId, date: Date): Promise<{ marked: number; skipped: number }>`; `GET/PUT /attendance/policy`; `POST /attendance/mark-absent { date }`. Payroll: `getAttendanceData` now returns `{ presentDays, otMinutes, absentLopDays }` and the caller adds `absentLopDays` to `lopDays`.

- [ ] Write failing specs for `computeLateMark` (on time, within grace, past grace, midnight edge), for the policy service defaults, for `AutoAbsentService` (skips weekend, holiday, approved leave, approved comp-off, existing record, pre-join employees; creates ABSENT with `autoMarked: true`), for the clock-out HALF_DAY conversion on the Nth late of the month, and for payroll LOP counting.
- [ ] Implement, register the cron (`30 23 * * *`, `Asia/Kolkata`), wire the controller endpoints (roles HR_ADMIN + SUPER_ADMIN).
- [ ] Frontend policy form (all fields from the spec) and the Late badge.
- [ ] Run `npx jest src/modules/attendance src/modules/payroll` and the page tests; commit.

---

### Task 5: Loans and salary advances

**Files:**
- Create in `backend/src/modules/loans/`: `loans.service.ts`, `loans.service.spec.ts`, `loans.controller.ts`, `loans.controller.spec.ts`, `loan-schedule.ts` (pure), `loan-schedule.spec.ts`, `dto/create-loan.dto.ts`, `dto/reject-loan.dto.ts`, `dto/record-repayment.dto.ts`, `dto/list-loans.dto.ts`
- Modify: `backend/src/modules/loans/loans.module.ts` (the scaffold shell: add providers/controllers, import `NotificationsModule`, export `LoansService`)
- Create: `frontend/src/lib/api-loans.ts`, `frontend/src/app/(protected)/loans/page.tsx` + test, `frontend/src/app/(protected)/approvals/loans/page.tsx` + test, `frontend/src/app/(protected)/payroll/loans/page.tsx` + test

**Interfaces:**
- Consumes: `prisma.employeeLoan`, `prisma.loanRepayment`, enums `LoanType`, `LoanStatus`, `RepaymentSource`, `NotificationsService`.
- Produces (binding, the controller wires these into payroll in Task 7):
  - `buildSchedule(input: { principal: number; interestRate: number; tenureMonths: number; startMonth: number; startYear: number }): ScheduleRow[]` where `ScheduleRow = { month: number; year: number; emi: number; principalComponent: number; interestComponent: number; balanceAfter: number }`, amounts rounded to 2 dp, rows sum exactly to `totalPayable`.
  - `LoansService.getPayrollDeductions(tenantId: string, employeeId: string, month: number, year: number): Promise<{ total: number; lines: { loanId: string; type: LoanType; amount: number }[] }>`
  - `LoansService.recordPayrollRepayments(tenantId: string, employeeId: string, month: number, year: number, payslipId: string, lines: { loanId: string; amount: number }[]): Promise<void>`
  - REST endpoints exactly as the spec's workstream 5.

- [ ] Write failing specs: schedule maths (zero interest, 10% over 12 months, rounding absorbed by last row); create validates tenure 1..120 for LOAN and 1..12 zero-interest for SALARY_ADVANCE; status transitions (only REQUESTED→APPROVED/REJECTED/CANCELLED, APPROVED→ACTIVE, ACTIVE→CLOSED); manager list limited to direct reports; `getPayrollDeductions` skips months already repaid and non-ACTIVE loans; `recordPayrollRepayments` decrements outstanding and closes at zero; notifications on approve/reject.
- [ ] Implement service + controller (`@Roles` per spec).
- [ ] Frontend: three pages per spec; the request form computes and previews EMI client-side using the same formula.
- [ ] Run `npx jest src/modules/loans` and the page tests; commit.

---

### Task 6: HR helpdesk

**Files:**
- Create in `backend/src/modules/helpdesk/`: `helpdesk.service.ts`, `helpdesk.service.spec.ts`, `helpdesk.controller.ts`, `helpdesk.controller.spec.ts`, `ticket-transitions.ts` (pure allowed-transition table), `ticket-transitions.spec.ts`, `dto/create-category.dto.ts`, `dto/update-category.dto.ts`, `dto/create-ticket.dto.ts`, `dto/assign-ticket.dto.ts`, `dto/change-status.dto.ts`, `dto/add-comment.dto.ts`, `dto/list-tickets.dto.ts`
- Modify: `backend/src/modules/helpdesk/helpdesk.module.ts` (scaffold shell)
- Create: `frontend/src/lib/api-helpdesk.ts`, `frontend/src/app/(protected)/helpdesk/page.tsx` + test, `frontend/src/app/(protected)/helpdesk/[id]/page.tsx` + test, `frontend/src/app/(protected)/admin/helpdesk/page.tsx` + test, `frontend/src/app/(protected)/admin/helpdesk/categories/page.tsx` + test

**Interfaces:**
- Consumes: `prisma.hrTicketCategory`, `prisma.hrTicket`, `prisma.hrTicketComment`, enums `TicketPriority`, `TicketStatus`, `NotificationsService.notifyByRole` / `notifyEmployee`.
- Produces: `canTransition(from: TicketStatus, to: TicketStatus, actor: 'HR' | 'ASSIGNEE' | 'OWNER'): boolean`; REST endpoints exactly as the spec's workstream 6.

- [ ] Write failing specs: transition table per spec (including owner limited to RESOLVED→CLOSED / RESOLVED→IN_PROGRESS); ticket number increments per tenant; `slaDeadline = createdAt + slaHours`; owner cannot see internal comments; only HR/assignee can post internal comments; `overdue=true` filter = `slaDeadline < now AND status NOT IN (RESOLVED, CLOSED)`; stats shape `{ byStatus: Record<TicketStatus, number>, overdue: number, avgResolutionHours: number | null }`; notifications on create/assign/resolve.
- [ ] Implement service + controller.
- [ ] Frontend: four pages per spec. Detail page shows the comment thread, hides internal comments for non-HR, and offers the status buttons the actor is allowed.
- [ ] Run `npx jest src/modules/helpdesk` and the page tests; commit.

---

### Task 7: Integration (controller-owned, after Tasks 1-6)

**Files:**
- Modify: `backend/src/modules/payroll/payroll-calculation.service.ts` (call `LoansService.getPayrollDeductions` and add a `Loan EMI` / `Salary advance recovery` deduction line per loan), `backend/src/modules/payroll/payroll.service.ts` (after a payslip row is written, call `recordPayrollRepayments` with the payslip id), `backend/src/modules/payroll/payroll.module.ts` (import `LoansModule`), the two payroll specs.

- [ ] Wire the hook, add specs for "EMI appears as a deduction" and "repayment recorded once per payslip".
- [ ] Run `npx tsc --noEmit` in `backend/` and `frontend/`, then `npm test` in both.
- [ ] Update `README.md` feature list and `docs/api-overview.md` with the new endpoint groups.
- [ ] Commit.
