# Keka Gap Closure, Wave A: Design

**Date:** 2026-09-21
**Branch:** `feat/keka-gap-wave-a`
**Source analysis:** chat gap analysis of 2026-09-21 comparing this HRMS to Keka.

## Goal

Close the six gaps that a Keka-evaluating buyer hits first, without touching
the areas already at parity. Six independent workstreams, one shared schema
scaffold, one PR.

| # | Workstream | Why first |
|---|---|---|
| 1 | Forgot / reset password | No endpoint exists at all. Blocks any real deployment. |
| 2 | Bulk employee CSV import | Keka imports a book of employees on day one. `mustChangePassword` already anticipates it. |
| 3 | Leave year-end carry-forward job | Columns exist, nothing ever writes them. Silent data bug. |
| 4 | Attendance rules: late marks, auto-absent, absent LOP | Keka's "penalisation" and "absence pattern" features. Grace minutes are stored but never applied. |
| 5 | Loans and salary advances | Headline Keka payroll feature. Extends our strongest module. |
| 6 | HR helpdesk | Headline Keka HR module. Wave 2 of the existing parity plan. |

Deferred to later waves: ATS, engagement, timesheets, workflow engine,
SSO/2FA, custom reports, JV export, PWA.

## Shared constraints (apply to every workstream)

- Multi-tenant: every query filters by `tenantId` from the JWT user. Never trust a tenantId in the body.
- Roles: `@Roles()` + `@UseGuards(JwtAuthGuard, RolesGuard)`. Roles are `SUPER_ADMIN | HR_ADMIN | MANAGER | EMPLOYEE`.
- Manager scope means `employee.managerId === user.employeeId`. `user.employeeId` is optional; guard it before using it in a `where`.
- 403 `ForbiddenException` for authorization failures, 400 `BadRequestException` for validation, 404 `NotFoundException` for missing rows.
- Backend specs use `createMockPrismaService()` from `backend/src/test/helpers` (the `src/` one). New models are already listed there by the scaffold.
- Frontend calls go through `frontend/src/lib/api.ts`'s `api` axios instance. Each workstream adds its own `frontend/src/lib/api-<feature>.ts` exporting a `<feature>Api` object, to avoid concurrent edits of `api.ts`.
- Frontend pages live under `frontend/src/app/(protected)/`, use `react-hot-toast`, and follow the layout of `feedback/page.tsx`. Each page gets a `page.test.tsx`.
- Do not run `prisma migrate dev`. The migration SQL is hand-written by the scaffold. Do not edit `schema.prisma`; if a field is missing, report it.
- Do not edit `app.module.ts`, `Sidebar.tsx`, `prisma-mock.ts`, or `schema.prisma`. The scaffold owns them.
- Notifications: `NotificationsService.notifyEmployee(...)` / `notifyByRole(...)`. New enum values are in the scaffold.
- Emails: `EmailService.sendEmail({ to, subject, template, context })` with a Handlebars template in `backend/src/common/email/templates/`.
- Dates that are calendar days (not instants) use UTC noon in tests.
- Commit per logical unit with conventional-commit messages.

## Schema (scaffold-owned)

### Workstream 1: `PasswordResetToken`
```
id, tenantId, userId, tokenHash (sha256 hex of the raw token), expiresAt, usedAt?, createdAt
@@index([userId]) @@index([tokenHash]) @@map("password_reset_tokens")
```
Raw token is 32 random bytes, hex-encoded, sent by email only. Only the hash is stored. Tokens expire after 60 minutes and are single-use. Requesting a reset invalidates previous unused tokens for that user.

### Workstream 3: `LeaveCarryForwardRun`
```
id, tenantId, fromYear Int, toYear Int, triggerType AccrualTriggerType, status AccrualRunStatus-like string
  (PENDING|COMPLETED|FAILED), processedCount Int, failedCount Int, triggeredById String?, errorLog Json?,
  startedAt, completedAt?
@@unique([tenantId, fromYear]) @@map("leave_carry_forward_runs")
```
The existing `LeaveBalance.carriedOver` is the target column.

### Workstream 4: `AttendancePolicy` + `AttendanceRecord` columns
```
AttendancePolicy: id, tenantId @unique, defaultShiftStart String "09:00", defaultGraceMinutes Int 15,
  lateMarksPerHalfDay Int? (null disables), autoMarkAbsent Boolean false, absentIsLop Boolean true,
  minHalfDayMinutes Int 240, minFullDayMinutes Int 480, createdAt, updatedAt
  @@map("attendance_policies")
AttendanceRecord adds: isLate Boolean false, lateByMinutes Int?, autoMarked Boolean false
```

### Workstream 5: `EmployeeLoan`, `LoanRepayment`
```
enum LoanType { LOAN SALARY_ADVANCE }
enum LoanStatus { REQUESTED APPROVED REJECTED ACTIVE CLOSED CANCELLED }
enum RepaymentSource { PAYROLL MANUAL SETTLEMENT }
EmployeeLoan: id, tenantId, employeeId, type, principal Decimal(12,2), interestRate Decimal(5,2) 0 (annual, simple),
  tenureMonths Int, emiAmount Decimal(12,2), totalPayable Decimal(12,2), outstandingAmount Decimal(12,2),
  startMonth Int, startYear Int, purpose String?, status LoanStatus REQUESTED, approvedById String?, approvedAt?,
  rejectionReason String?, disbursedAt?, closedAt?, createdAt, updatedAt
  @@index([tenantId]) @@index([employeeId]) @@index([status]) @@map("employee_loans")
LoanRepayment: id, tenantId, loanId, month Int, year Int, amount Decimal(12,2), source RepaymentSource,
  payslipId String?, note String?, createdAt
  @@unique([loanId, month, year, source]) @@map("loan_repayments")
```
Simple interest: `totalPayable = principal + principal * rate/100 * tenureMonths/12`, `emi = ceil2(totalPayable / tenureMonths)`, last EMI absorbs rounding so repayments sum exactly to `totalPayable`. Salary advances are zero-interest, tenure 1..12.

### Workstream 6: `HrTicketCategory`, `HrTicket`, `HrTicketComment`
```
enum TicketPriority { LOW MEDIUM HIGH URGENT }
enum TicketStatus { OPEN IN_PROGRESS WAITING_ON_EMPLOYEE RESOLVED CLOSED }
HrTicketCategory: id, tenantId, name, code, description?, slaHours Int 48, isActive Boolean true, createdAt, updatedAt
  @@unique([tenantId, code]) @@map("hr_ticket_categories")
HrTicket: id, tenantId, ticketNumber Int, employeeId, categoryId, subject, description, priority MEDIUM,
  status OPEN, assignedToId String? (User.id), slaDeadline DateTime, resolvedAt?, closedAt?, createdAt, updatedAt
  @@unique([tenantId, ticketNumber]) @@index([tenantId, status]) @@index([assignedToId]) @@map("hr_tickets")
HrTicketComment: id, tenantId, ticketId, authorId (User.id), content, isInternal Boolean false, createdAt
  @@index([ticketId]) @@map("hr_ticket_comments")
```

### New `NotificationType` values
`TICKET_CREATED, TICKET_ASSIGNED, TICKET_RESOLVED, LOAN_APPROVED, LOAN_REJECTED, LEAVE_CARRIED_FORWARD`

## Workstream behaviour

### 1. Forgot / reset password (auth module)
- `POST /auth/forgot-password { email, tenantCode? }` → always 200 `{ message }` regardless of whether the email exists (no enumeration). Rate-limited 3/min per IP. If a matching active user exists, create a token and send email template `password-reset.hbs` with link `${FRONTEND_URL}/reset-password?token=<raw>`.
- `POST /auth/reset-password { token, newPassword }` → validate hash exists, unused, unexpired; set `passwordHash`, bump `tokenVersion`, clear `mustChangePassword`, mark token `usedAt`. Password policy identical to `change-password`.
- Frontend: `/forgot-password` (public) and `/reset-password` (public) pages, plus a "Forgot password?" link on `/login`.
- `FRONTEND_URL` env var added to `env.validation.ts` as optional string with default `http://localhost:3000`.

### 2. Bulk employee CSV import (employees module)
- `POST /employees/import?dryRun=true|false` multipart `file` (CSV, max 2 MB, max 2000 rows). HR_ADMIN and SUPER_ADMIN.
- Columns (header row, case-insensitive): `employeeCode*, firstName*, lastName*, email*, joinDate* (YYYY-MM-DD), departmentCode, designationCode, branchCode, managerEmployeeCode, employmentType, phone, dateOfBirth, gender, role (EMPLOYEE|MANAGER|HR_ADMIN, default EMPLOYEE)`.
- Validation per row: required fields, unique `employeeCode` and `email` within tenant and within the file, lookups resolve by code within tenant, manager code resolves to an employee in the tenant or in an earlier row of the same file.
- Response `{ totalRows, validRows, invalidRows, errors: [{ row, field, message }], created: n }`. Dry run creates nothing. Non-dry-run is all-or-nothing in one transaction: any invalid row rejects the whole file with the error list.
- Each created employee gets a `User` with `mustChangePassword: true` and an initial password from body field `initialPassword` (min 8 chars, required when not dry run). Welcome email is NOT sent (bulk), only an audit log entry.
- `GET /employees/import/template` returns the CSV header line as a downloadable file.
- Frontend `/employees/import`: upload, dry-run preview table with per-row errors, then "Import" button.

### 3. Leave carry-forward (leave module)
- `LeaveCarryForwardService.runCarryForward(tenantId, fromYear, triggerType, triggeredById?)`: for each active employee and each active `LeaveType` with `carryForward=true`, compute `remaining = totalDays + carriedOver - usedDays` for `fromYear` (pendingDays are NOT deducted), `carry = min(max(remaining,0), maxCarryForward ?? remaining)`, then upsert the `toYear = fromYear+1` balance with `carriedOver = carry` (totalDays defaults to `leaveType.defaultDays` when the row is new; when the row exists only `carriedOver` is updated). Idempotent via `LeaveCarryForwardRun` unique on `(tenantId, fromYear)`: a second call returns the existing run and changes nothing. An existing `toYear` balance has its `carriedOver` overwritten with the freshly computed value (re-running after a FAILED run therefore converges; a COMPLETED run is never re-run).
- Cron `0 3 1 1 *` Asia/Kolkata runs it for every active tenant with `fromYear = now.year - 1`.
- `POST /leave/carry-forward/run { fromYear }` (HR_ADMIN, SUPER_ADMIN) and `GET /leave/carry-forward/runs`.
- Notification `LEAVE_CARRIED_FORWARD` to each employee with `carry > 0`.
- Frontend: a "Carry-forward" card on `/admin/accrual-history` showing runs and a "Run year-end carry-forward" button with year input.

### 4. Attendance rules (attendance module + payroll)
- `GET/PUT /attendance-policy` (HR_ADMIN, SUPER_ADMIN; own controller prefix so it cannot collide with `GET /attendance/:employeeId`) reads/updates the tenant's `AttendancePolicy`, creating defaults on first read.
- Late mark: on clock-in, resolve the employee's shift for the day (`ShiftAssignment` covering the date, else policy `defaultShiftStart` + `defaultGraceMinutes`). If `clockIn > shiftStart + grace`, set `isLate=true, lateByMinutes`. Existing clock-in response gains those two fields.
- Late-mark penalty: when `lateMarksPerHalfDay` is set, the Nth late mark in a calendar month (N = `lateMarksPerHalfDay`, then every further N) converts that day's status to `HALF_DAY`. Implemented in the clock-out path (status is finalised at clock-out).
- Auto-absent: daily cron `30 23 * * *` Asia/Kolkata. For each tenant with `autoMarkAbsent=true`, for each active employee who joined on or before that day, if the day is not a weekend (Sat/Sun), not a `Holiday` for the tenant, not covered by an APPROVED leave request or comp-off, and has no `AttendanceRecord`, create one with `status=ABSENT, autoMarked=true, source=API`. Also exposed as `POST /attendance/mark-absent { date }` for HR to run for a past day.
- Payroll: `PayrollCalculationService.getAttendanceData` counts `ABSENT` records as `lopDays` when the tenant policy has `absentIsLop=true`. Half-days count 0.5 present and 0.5 LOP? No: keep existing half-day behaviour (0.5 present) and do not add LOP for half days; only ABSENT rows add a full LOP day. The existing leave-derived LOP is unchanged and added to this.
- Frontend: `/admin/attendance-policy` settings form; `/attendance` shows a "Late" badge and late-by minutes on the day rows.

### 5. Loans and salary advances (new `loans` module)
- Employee: `POST /loans { type, principal, interestRate?, tenureMonths, startMonth, startYear, purpose }` creates REQUESTED. `GET /loans/my`. `POST /loans/:id/cancel` while REQUESTED.
- HR_ADMIN/SUPER_ADMIN: `GET /loans?status=&employeeId=`, `POST /loans/:id/approve` (→ APPROVED, sets approvedById/At), `POST /loans/:id/reject { reason }`, `POST /loans/:id/disburse` (→ ACTIVE, sets disbursedAt), `POST /loans/:id/repayments { month, year, amount, note }` manual repayment (source MANUAL), `GET /loans/:id` with repayments and schedule.
- Managers may view `GET /loans` filtered to their direct reports only. They may not approve.
- Schedule: `LoansService.buildSchedule(loan)` returns `[{ month, year, emi, principalComponent, interestComponent, balanceAfter }]` for `tenureMonths` starting at `startMonth/startYear`.
- Payroll hook: `LoansService.getPayrollDeductions(tenantId, employeeId, month, year)` returns `{ total: number, lines: [{ loanId, type, amount }] }` for ACTIVE loans whose schedule includes that month and which have no PAYROLL repayment for that month yet. `LoansService.recordPayrollRepayments(tenantId, employeeId, month, year, payslipId, lines)` writes `LoanRepayment` rows (source PAYROLL) and decrements `outstandingAmount`; when it reaches 0, status → CLOSED and notification `LOAN_APPROVED`-style `GENERAL` message "Loan closed". These two methods are the contract. **The loans implementer does not edit payroll files**; the controller wires the hook after both workstreams land.
- Notifications: `LOAN_APPROVED`, `LOAN_REJECTED` to the employee.
- Frontend: `/loans` (my loans + request form + schedule drawer), `/approvals/loans` (HR queue: approve/reject/disburse), `/payroll/loans` (all loans, repayments, manual repayment form).

### 6. HR helpdesk (new `helpdesk` module)
- Categories: `GET/POST/PUT /helpdesk/categories` (HR_ADMIN, SUPER_ADMIN). Seed nothing.
- Tickets: `POST /helpdesk/tickets { categoryId, subject, description, priority? }` (any role with an employeeId). `ticketNumber` = max+1 per tenant inside a transaction. `slaDeadline = now + category.slaHours`. Notification `TICKET_CREATED` to HR_ADMIN role.
- `GET /helpdesk/tickets/my`, `GET /helpdesk/tickets?status=&assignedToId=&categoryId=&overdue=true` (HR_ADMIN, SUPER_ADMIN), `GET /helpdesk/tickets/:id` (owner, assignee, or HR).
- `POST /helpdesk/tickets/:id/assign { assignedToId }` (HR) → status IN_PROGRESS if OPEN, notification `TICKET_ASSIGNED` to the assignee's employee.
- `POST /helpdesk/tickets/:id/status { status }` (HR or assignee). Allowed transitions: OPEN→IN_PROGRESS, IN_PROGRESS↔WAITING_ON_EMPLOYEE, IN_PROGRESS→RESOLVED, WAITING_ON_EMPLOYEE→RESOLVED, RESOLVED→CLOSED, RESOLVED→IN_PROGRESS (reopen). RESOLVED sets `resolvedAt` and notifies `TICKET_RESOLVED` to the owner. CLOSED sets `closedAt`. The owner may move RESOLVED→CLOSED or RESOLVED→IN_PROGRESS only.
- `POST /helpdesk/tickets/:id/comments { content, isInternal? }`. Only HR/assignee may post internal comments; owners never see internal comments in `GET`.
- `GET /helpdesk/stats` (HR): counts by status, overdue count, average resolution hours for the last 30 days.
- Frontend: `/helpdesk` (my tickets list, new ticket form, ticket detail with comment thread), `/admin/helpdesk` (queue with filters, assign, status change, internal notes, stats strip), `/admin/helpdesk/categories`.

## Testing

Every workstream ships backend `*.spec.ts` for its service and controller using the mock Prisma helper, and a `page.test.tsx` per new frontend page. The full suites (`npm test` in `backend/` and `frontend/`) must stay green. The controller runs `npx prisma validate` and `npx prisma generate` in the scaffold and `npx tsc --noEmit` in both packages at the end.

## Out of scope for this wave

Settlement recovery of outstanding loans, multi-level approvals, selfie punch, email dispatch of payslips, SSO. Each is noted in `MEMORY.md` follow-ups.
