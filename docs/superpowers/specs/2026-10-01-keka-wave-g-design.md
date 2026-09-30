# Keka Wave G — Time and attendance depth

**Date:** 2026-10-01
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave G)
**Baseline:** `main` at `a1728a5` (Waves B, C/D, E, H1 merged). Branch `feat/keka-wave-g`.
**Format and engine reference:** `docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md`,
`docs/superpowers/specs/2026-09-24-keka-wave-b-workflow-engine-design.md`
**Parallel waves:** F (performance) and I (assets, exit, travel, policies, LMS) are
built at the same time. Wave I also adds workflow entity types and notification
types, so every shared file gets this wave's lines as **one contiguous block**
headed `// Keka wave G (time and attendance)`.

## Goal

Deepen time and attendance:

1. **WFH and on-duty requests** approved through the Wave B engine.
2. **Capture policy**: an IP allowlist for punches and a selfie requirement,
   both tenant settings.
3. **Shift roster**: rotation patterns, a roster grid, and a roster-aware
   shift lookup that respects `Shift.isOvernight`.
4. **Projects, members and tasks.**
5. **Weekly timesheets** against projects and tasks, submitted and approved
   through the engine.
6. **Utilisation report** against capacity.

With no tenant configuration, existing behaviour is unchanged. IP restriction
and selfie are off by default. An employee with no roster entries resolves
shifts exactly as today (`ShiftAssignment`, then the policy default). No
project means no timesheet.

## Product decisions (user, 2026-10-01)

| Topic | Decision |
|---|---|
| WFH / on-duty effect | **Both still need a punch.** An approved request waives the IP rule and the geofence for its dates. The day is marked WFH or ON_DUTY instead of PRESENT. Nothing is written without a punch. |
| Capture policy | **Strict.** Outside the allowed IPs a punch is refused, except on a day covered by an approved request. The selfie is a separate toggle, Off or Always. No face matching. |
| Timesheet approver | **Reporting manager** by default: one timesheet per employee per week. HR can reconfigure the chain in admin workflows. |
| Utilisation | **Against capacity.** Capacity = working days (Mon–Fri minus holidays, the payroll rule) minus approved leave, times the shift's standard hours. |
| Roster editing | **HR/Super** (and custom roles holding `attendance.roster.manage`) edit. Managers see their direct reports read-only. Employees see their own shifts. |
| Roster OFF day | **Attendance only.** Auto-absent skips it, and a punch on it is recorded normally. Payroll keeps its Mon–Fri rule. |
| Timesheet logging | **Project members only**, active on the entry's date, on the project's open tasks. |
| Project management | **HR creates, the project manager runs it.** HR/Super (and `projects.manage`) create and edit projects and set the manager. The manager (an employee) manages members and tasks and sees the project's hours. |

## Conventions (all workstreams)

- **Tenant scoping.** Every new model has `tenantId`, and every query is scoped
  by it. Every `@@unique` that is not an id includes `tenantId`, or a parent id
  that is itself tenant-scoped.
- **Errors.**
  - 400 `BadRequestException`: validation or wrong state.
  - 403 `ForbiddenException`: authorization, and IP-refused punches.
  - 404: missing, including other tenants' ids and rows the caller may not see.
  - 409 `ConflictException`: races and duplicates.
- **Guards.** Protected controllers use `@UseGuards(JwtAuthGuard, RolesGuard)`.
  A route without `@Roles` is open to any authenticated user. Custom-role
  permissions are additive (`@RequirePermissions`, see the Wave H1 memory).
  Decorate a route only where the service treats a permission holder exactly
  like HR.
- **`employeeId` guard.** `AuthenticatedUser.employeeId` is optional. Guard it
  before using it in a Prisma `where`, because undefined matches every row. An
  employee-only route called by a user with no employee record gets a 400.
- **New controllers get their own prefix.** `GET /attendance/:employeeId`
  swallows any new `GET /attendance/<word>` route.
- **Dates and time zone.**
  - Dates are `@db.Date` (UTC midnight).
  - "Today" is the IST calendar day (`zonedDateOnlyUtc(now,
    DEFAULT_ATTENDANCE_TIME_ZONE)`).
  - Weeks start on Monday.
  - Tests use UTC-noon dates.
- **Workflow integration** copies the regularization pattern exactly:
  - A handler registers itself in `onModuleInit`.
  - Create calls `engine.start({..., tx})` inside the create transaction, then
    `void engine.notifyPending(...)` after commit.
  - Approve/reject call `engine.act` with `onFinal` doing the domain transition
    through a conditional `update ... where status = <pending>` (P2025 → 409).
  - `ADVANCED` means still pending.
  - Non-admin list views filter by `listActionableEntityIds`.
- **Hours** are `Decimal(5,2)`. The API accepts numbers with at most two decimal
  places and returns numbers rounded to 2 dp.

---

## G.0 Data model (scaffold)

```prisma
// Keka wave G (time and attendance)
enum AttendanceStatus += ON_DUTY
enum WorkflowEntityType += WFH_REQUEST, ON_DUTY_REQUEST, TIMESHEET
enum NotificationType += ATTENDANCE_REQUEST_APPROVED, ATTENDANCE_REQUEST_REJECTED,
                         TIMESHEET_APPROVED, TIMESHEET_REJECTED

enum AttendanceRequestType   { WFH ON_DUTY }
enum AttendanceRequestStatus { PENDING APPROVED REJECTED CANCELLED }
enum RosterEntrySource       { MANUAL PATTERN }
enum ProjectStatus           { ACTIVE ON_HOLD COMPLETED ARCHIVED }
enum ProjectTaskStatus       { OPEN CLOSED }
enum TimesheetStatus         { DRAFT SUBMITTED APPROVED REJECTED }

AttendancePolicy += ipRestrictionEnabled Boolean @default(false),
                    allowedIpRanges String[] @default([]),
                    selfieRequired Boolean @default(false)

AttendanceSession += inIp String? @db.VarChar(45), outIp String? @db.VarChar(45),
                     inSelfieUploadId String?  → Upload (SetNull),
                     outSelfieUploadId String? → Upload (SetNull)

AttendanceRequest (id, tenantId, employeeId → Employee, type, fromDate @db.Date,
  toDate @db.Date, days Int, reason VarChar(500), location VarChar(200)?,
  status @default(PENDING), approverId String?, approverNote VarChar(500)?,
  decidedAt?, cancelledAt?, createdAt, updatedAt)
  @@index([tenantId, employeeId, fromDate]) @@index([tenantId, status])

ShiftRotationPattern (id, tenantId, name VarChar(100), description VarChar(500)?,
  cycleLength Int, isActive @default(true), createdById String, createdAt, updatedAt)
  @@index([tenantId])
ShiftRotationPatternDay (id, patternId → ShiftRotationPattern (Cascade),
  dayIndex Int, shiftId String? → Shift)   // shiftId null = OFF
  @@unique([patternId, dayIndex])

RosterEntry (id, tenantId, employeeId → Employee, date @db.Date,
  shiftId String? → Shift, isOff Boolean @default(false),
  source RosterEntrySource, patternId String? → ShiftRotationPattern (SetNull),
  createdById String, createdAt, updatedAt)
  @@unique([tenantId, employeeId, date]) @@index([tenantId, date])
  // invariant: exactly one of (shiftId set, isOff true)

Project (id, tenantId, code VarChar(20), name VarChar(150), clientName VarChar(150)?,
  description VarChar(2000)?, billable Boolean @default(true),
  status ProjectStatus @default(ACTIVE), startDate @db.Date?, endDate @db.Date?,
  managerEmployeeId String? → Employee, createdById String, createdAt, updatedAt)
  @@unique([tenantId, code]) @@index([tenantId, status])

ProjectMember (id, tenantId, projectId → Project (Cascade), employeeId → Employee,
  role VarChar(50)?, startDate @db.Date, endDate @db.Date?, createdAt, updatedAt)
  @@unique([projectId, employeeId]) @@index([tenantId, employeeId])

ProjectTask (id, tenantId, projectId → Project (Cascade), name VarChar(150),
  description VarChar(2000)?, billable Boolean?,  // null = inherit project
  status ProjectTaskStatus @default(OPEN), estimateHours Decimal(7,2)?,
  createdAt, updatedAt)
  @@index([projectId])

Timesheet (id, tenantId, employeeId → Employee, weekStart @db.Date, // a Monday
  status TimesheetStatus @default(DRAFT), totalHours Decimal(6,2) @default(0),
  submittedAt?, decidedAt?, approverId String?, approverNote VarChar(500)?,
  createdAt, updatedAt)
  @@unique([tenantId, employeeId, weekStart]) @@index([tenantId, status])

TimesheetEntry (id, tenantId, timesheetId → Timesheet (Cascade), date @db.Date,
  projectId → Project, taskId String? → ProjectTask, hours Decimal(5,2),
  billable Boolean, note VarChar(500)?, createdAt, updatedAt)
  @@index([timesheetId]) @@index([tenantId, projectId, date])
```

Back-relations go on `Employee`, `Shift`, `Upload` and `Tenant` as Prisma
requires. They are added at the end of each model's relation list, never
reordering existing lines.

**Scaffold-owned shared edits (one block each):**

- **`workflow.defaults.ts`**: `WFH_REQUEST: { name: 'Work from home approval',
  ...REPORTING_MANAGER_ONLY }`, `ON_DUTY_REQUEST: { name: 'On-duty approval',
  ...REPORTING_MANAGER_ONLY }`, `TIMESHEET: { name: 'Timesheet approval',
  ...REPORTING_MANAGER_ONLY }`.
- **`approval-engine.service.ts` `TYPE_LABELS`**: 'Work from home', 'On duty',
  'Timesheet'.
- **`frontend/src/lib/api-workflow.ts`**: the type union,
  `WORKFLOW_ENTITY_TYPES` and `WORKFLOW_ENTITY_LABELS`.
- **`admin/workflows/page.tsx`**: add WFH_REQUEST and ON_DUTY_REQUEST to
  `DAYS_TYPES`.
- **`workflow-definitions.service.spec.ts`**: add the types to its list.
- **`payroll-calculation.service.ts` `getAttendanceData`**: add `'ON_DUTY'` to
  the status list and count it as a present day. This is the one change outside
  the wave's area; it goes in the PR body.
- **`employees.service.ts` attendance summary**: `onDutyDays`. Listed in the PR
  body.
- **`permissions.ts`**: `attendance.roster.manage` (group Attendance),
  `projects.manage` and `projects.reports.view` (new group Projects). Update
  `permissions.spec.ts` if it asserts the list.
- **`prisma-mock.ts` model list**: `attendanceRequest`, `shiftRotationPattern`,
  `shiftRotationPatternDay`, `rosterEntry`, `project`, `projectMember`,
  `projectTask`, `timesheet`, `timesheetEntry`.
- **`app.module.ts`**: `RosterModule`, `ProjectsModule` and `TimesheetsModule`.
  Attendance requests and capture live inside `AttendanceModule`.
- **Sidebar and `permission-paths.ts`**: see G.7.
- **Migration**: generated with `prisma migrate diff` (no database) into
  `prisma/migrations/<ts>_keka_wave_g/migration.sql`. Enum additions are
  `ALTER TYPE ... ADD VALUE`.

**Contract types (scaffold, frozen):**

- `backend/src/modules/roster/roster.types.ts`:
  ```ts
  export type ShiftDaySource = 'ROSTER' | 'ASSIGNMENT' | 'NONE';
  export interface ResolvedShiftDay {
    employeeId: string; date: Date;           // @db.Date
    shift: Shift | null;                      // null when OFF or no shift
    isOff: boolean;                           // true only for a rostered OFF day
    source: ShiftDaySource;
  }
  ```
- `backend/src/modules/roster/shift-resolver.service.ts`: `ShiftResolverService`,
  exported by `RosterModule`, imported by `AttendanceModule`.
  ```ts
  shiftOn(tenantId, employeeId, date): Promise<Shift | null>
  dayOn(tenantId, employeeId, date): Promise<ResolvedShiftDay>
  daysFor(tenantId, employeeIds: string[], from: Date, to: Date): Promise<ResolvedShiftDay[]>
  ```
  The scaffold implements all three with **today's rule** (assignments only,
  via `rules/shift-lookup.ts`), so behaviour is unchanged until WS-R adds roster
  entries. The scaffold also changes `AttendanceService.findShiftOn` to
  delegate to `shiftResolver.shiftOn` (one-line body).
- `backend/src/modules/attendance/requests/attendance-requests.types.ts`:
  ```ts
  /** The approved request covering an employee's day, or null. */
  export interface CoveringRequest { id: string; type: AttendanceRequestType }
  ```

---

## G1. WFH and on-duty requests (WS-A)

`backend/src/modules/attendance/requests/`: service, controller, DTOs, and two
workflow handlers (one per entity type, both delegating to the service).

### Rules

- **Create** `{ type, fromDate, toDate, reason, location? }`:
  - `fromDate <= toDate`, with a range of at most 31 days.
  - `fromDate` may be up to 30 days in the past. Backdated WFH is common, and
    the punch still has to exist.
  - `location` is accepted only for ON_DUTY.
  - `days` = calendar days in the range.
  - An overlap with another PENDING or APPROVED request of the same employee
    (either type) → 409.
  - The employee must be ACTIVE.
  - The transaction creates the row with status PENDING and calls
    `engine.start` with entity type `WFH_REQUEST` or `ON_DUTY_REQUEST` and
    context `{ requesterEmployeeId, requesterUserId, days }`. `notifyPending`
    runs after commit.
- **Approve (onFinal)**:
  - Transition PENDING → APPROVED, setting `approverId`, `approverNote` and
    `decidedAt`.
  - In the same transaction, **re-mark past days**: each existing
    `AttendanceRecord` of the employee with `date` in `[fromDate, min(toDate,
    today)]` and status `PRESENT` becomes `WFH` or `ON_DUTY`.
  - Other statuses (HALF_DAY, ABSENT, LEAVE, HOLIDAY) are left alone. A day
    with no record stays without one.
  - Notify the employee (`ATTENDANCE_REQUEST_APPROVED`, fire-and-forget).
- **Reject (onFinal)**: PENDING → REJECTED, then notify
  (`ATTENDANCE_REQUEST_REJECTED`).
- **Cancel** (requester only):
  - PENDING → CANCELLED with `engine.cancel(..., tx)`.
  - APPROVED with `toDate >= today`: the row stays APPROVED and its `toDate`
    becomes yesterday. If `fromDate >= today`, the whole request is cancelled
    instead (status CANCELLED).
  - Past days are never un-marked.
  - Any other state → 400.
- **Covering lookup** (used by capture and clock-out):
  `findApprovedCovering(tenantId, employeeId, date, tx?): Promise<CoveringRequest | null>`
  finds an APPROVED request with `fromDate <= date <= toDate`.

### API (`@Controller('attendance-requests')`)

| Method + path | Who | Notes |
|---|---|---|
| POST `/` | any employee | create |
| GET `/me?status&from&to` | any employee | own requests, newest first |
| GET `/pending-approvals` | MANAGER, HR_ADMIN, SUPER_ADMIN | PENDING rows. HR/Super see all; others see `listActionableEntityIds` for both types |
| GET `/all?type&status&from&to&employeeId` | HR_ADMIN, SUPER_ADMIN | paginated (`page`, `limit ≤ 100`) |
| POST `/:id/approve` `{ note? }` | MANAGER, HR_ADMIN, SUPER_ADMIN | engine decides eligibility |
| POST `/:id/reject` `{ note? }` | MANAGER, HR_ADMIN, SUPER_ADMIN | |
| POST `/:id/cancel` | requester | |

Handler `describe`: title "Work from home" or "On duty", subtitle
`fmtDate(from)–fmtDate(to) (N days)`, link `/approvals/attendance-requests`.

---

## G2. Capture policy and punches (WS-A)

### Policy

`AttendancePolicy` gains `ipRestrictionEnabled`, `allowedIpRanges` and
`selfieRequired`. `PUT /attendance-policy` (existing route, existing guard
`attendance.config.manage`) accepts them:

- `allowedIpRanges`: at most 100 entries, each a valid IPv4 or IPv6 address or
  CIDR (`10.0.0.0/8`, `2001:db8::/32`). Entries are trimmed and de-duplicated.
  An invalid entry → 400 naming it.
- `ipRestrictionEnabled: true` with an empty list (after the update) → 400.

`rules/ip-allowlist.ts` (pure, WS-A):

- `parseIpRanges(ranges): BlockList` (Node `net.BlockList`, `addAddress` or
  `addSubnet`).
- `isIpAllowed(ip, ranges): boolean` normalises IPv4-mapped IPv6
  (`::ffff:1.2.3.4` → `1.2.3.4`). An empty or unparsable `ip` → false.
- `validateIpRange(entry): string | null` returns an error message or null.

The client IP is `req.ip`. It honours `TRUST_PROXY` (`config/trust-proxy.ts`),
and the deployment docs note that `TRUST_PROXY` must be set behind a proxy or
the proxy's address is what gets checked.

### Punch rules

`AttendanceController.clockIn/clockOut` pass a `PunchContext { ip: string |
undefined; userId: string }` to the service. `ClockInDto` and `ClockOutDto`
gain `selfieUploadId?: string (uuid)`.

**Clock-in, in this order:**

1. The employee is ACTIVE (existing check).
2. Resolve the shift day (existing `resolveShiftDay`).
3. `covering = findApprovedCovering(tenantId, employeeId, shiftDay.date)`.
4. **IP rule.** If `ipRestrictionEnabled` and not `covering` and not
   `isIpAllowed(ctx.ip, allowedIpRanges)` → **403** "Clock-in is only allowed
   from the office network".
5. **Geofence** (existing). Skipped when `covering`. lat/lng stay required for
   every punch: they are still recorded.
6. **Selfie.** If `selfieRequired` and no `selfieUploadId` → 400 "A selfie is
   required to clock in". If given, it is validated as below whether or not the
   policy requires it.
7. Late mark (existing).
8. Transaction (existing SERIALIZABLE). The new session gets `inIp = ctx.ip`
   and `inSelfieUploadId`. The selfie upload is claimed with
   `upload.updateMany({ where: { id, tenantId, uploadedBy: userId,
   entityType: 'attendance-selfie', entityId: null, createdAt: { gte: now − 10
   min } }, data: { entityId: <sessionId> } })`. A count of 0 → 400 "Selfie
   upload is invalid, expired or already used".
9. The first punch's status is `covering ? covering.type : 'PRESENT'`. It was
   always `'PRESENT'` before.

**Clock-out.** The same IP, geofence and selfie rules, against the record's
date (`covering` looked up for that date). The session gets `outIp` and
`outSelfieUploadId`, claimed the same way. For the worked-day status,
`classifyWorkedDay` gets `currentStatus = covering ? covering.type :
record.status`.

**`rules/day-classification.ts`:** `ON_DUTY` joins `OWNED_STATUSES`, and a full
day keeps `WFH` or `ON_DUTY` (`fullDay = status === 'WFH' || status ===
'ON_DUTY' ? status : 'PRESENT'`).

**Regularization.** An approved regularization on a day covered by an approved
request uses that type as its base instead of PRESENT (extends the existing
WFH-preserving branch at `regularization.service.ts:458`).

### Selfie capture and access (`@Controller('attendance-capture')`)

| Method + path | Who | Behaviour |
|---|---|---|
| GET `/policy` | any employee | `{ ipRestrictionEnabled, ipAllowed, selfieRequired, coveringRequest: CoveringRequest \| null, clientIp }` for the caller's current shift day |
| POST `/selfie` | any employee | multipart `file`. `image/jpeg`, `image/png` or `image/webp`, at most 2 MB (400 otherwise). Saved via `UploadsService.upload(file, tenantId, userId, 'attendance-selfie')`. Returns `{ uploadId }` |
| GET `/selfies/:sessionId/:which` (`which` = `in` or `out`) | the employee, their direct manager, HR_ADMIN, SUPER_ADMIN | streams the image inline. 404 when there is no selfie or the caller may not see it |

- **Folder lockout.** The generic `GET /uploads/:folder/:filename` returns 404
  for folder `attendance-selfie`. This is a small change in
  `uploads.controller.ts`, owned by WS-A and listed in the PR body.
- **Records view.** The attendance records returned by `GET /attendance/me`
  and `GET /attendance/:employeeId` include `sessions: { id, inTime, outTime,
  inIp, outIp, hasInSelfie, hasOutSelfie }[]`.

### Frontend (WS-A)

- **`components/attendance/SelfieCapture.tsx`**: a modal using `getUserMedia`
  that takes one frame, previews it, retakes or confirms, and uploads it to get
  an `uploadId`.
  - With no camera or permission denied, it shows an error and the punch is
    not sent.
  - `attendance/page.tsx` and `dashboard/page.tsx` read `GET
    /attendance-capture/policy` and open it before clock-in/out when
    `selfieRequired`.
  - When `ipRestrictionEnabled && !ipAllowed && !coveringRequest`, the clock
    buttons show "Office network only" and stay enabled; the server decides.
- **`attendance/requests/page.tsx`**: the employee's requests, a create form
  (type, dates, reason, location for on-duty) and cancel.
- **`approvals/attendance-requests/page.tsx`**: the approver list with
  approve/reject.
- **`admin/attendance-policy/page.tsx`**: a "Punch capture" section with the
  IP toggle, a textarea (one range per line) and the selfie toggle.
- **Attendance records table**: an IP column and a camera icon linking to the
  selfie route (fetched as a blob), shown for HR, managers and the employee.
- **Status colours**: an `ON_DUTY` badge wherever WFH has one (attendance
  calendar, dashboard).

---

## G3. Roster (WS-R)

`backend/src/modules/roster/`: `RosterModule`, `rotation-patterns.service.ts`,
`roster.service.ts`, `shift-resolver.service.ts` (the scaffold stub),
`roster.controller.ts`, `dto/`.

### Shift resolution (the one rule)

For `(employee, date)`:

1. A `RosterEntry` exists: `isOff` → `{ shift: null, isOff: true, source:
   'ROSTER' }`; otherwise its shift if that shift is active, else `{ shift:
   null, isOff: false, source: 'ROSTER' }`. An inactive rostered shift does
   **not** fall back to an assignment, mirroring `effectiveShift`.
2. Otherwise the covering `ShiftAssignment` (existing rule, `source:
   'ASSIGNMENT'`).
3. Otherwise `{ shift: null, isOff: false, source: 'NONE' }`.

**Consumers:**

- `daysFor` answers with at most two queries for any range (roster entries in
  range, plus covering assignments), not N×days queries.
- `AttendanceService.findShiftOn` (scaffold delegation) means `resolveShiftDay`
  and night-shift attribution use the rostered shift for both yesterday and
  today, including `isOvernight`.
- **Auto-absent** (`rules/auto-absent.service.ts`, WS-R):
  - Skips employees whose resolved day is `isOff`.
  - `filterByScope` uses `daysFor` instead of the direct assignment query, so
    day/night scoping sees rostered shifts.
  - Its existing specs keep passing. New specs cover the OFF skip and a
    rostered night shift.

### Patterns and apply

- A pattern has `name`, `description?` and `days: (shiftId | null)[]`. The
  length is 1..31. Every shiftId must be an active shift in the tenant (400
  otherwise). `cycleLength = days.length`.
- Update replaces the days in one transaction. Delete is a soft delete
  (`isActive = false`). Existing roster entries keep their `patternId`, which
  becomes informational.
- **Apply** `{ patternId, employeeIds (1..500), startDate, endDate, cycleOffset
  = 0, overwriteManual = false }`:
  - The range is at most 366 days, and every employee must be ACTIVE in the
    tenant.
  - For each date, `dayIndex = (daysBetween(startDate, date) + cycleOffset) mod
    cycleLength`.
  - Upsert `RosterEntry { shiftId or isOff, source: PATTERN, patternId }`.
  - An existing MANUAL entry is kept unless `overwriteManual`.
  - Chunked `createMany` plus `updateMany` per chunk inside one transaction
    with a 60 s timeout.
  - Returns `{ created, updated, skippedManual }`.

### Grid and cells

- `GET /roster?from&to&departmentId?&employeeIds?`:
  - The range is at most 42 days.
  - Returns `{ days: string[], rows: [{ employee: { id, name, code,
    department }, cells: [{ date, shiftId, shiftCode, shiftName, isOvernight,
    isOff, source }] }] }` from `daysFor`.
  - **Scope:** HR/Super or a holder of `attendance.roster.manage` → all
    employees. MANAGER → direct reports only (`managerId =
    actor.employeeId`).
- `PUT /roster/cells { cells: [{ employeeId, date, shiftId?: string | null,
  isOff?: boolean, clear?: boolean }] }`:
  - Up to 1000 cells.
  - `clear` deletes the entry, so the day falls back to the assignment.
  - Otherwise exactly one of `shiftId` or `isOff: true` is required. The cell
    is upserted as MANUAL (`patternId` null).
  - One transaction. Returns the updated cells.
- `GET /roster/me?from&to`: any employee, own cells, at most 42 days.

| Method + path | Who |
|---|---|
| GET/POST `/roster/patterns`, PUT/DELETE `/roster/patterns/:id` | HR_ADMIN, SUPER_ADMIN + `attendance.roster.manage` |
| POST `/roster/apply` | HR_ADMIN, SUPER_ADMIN + `attendance.roster.manage` |
| PUT `/roster/cells` | HR_ADMIN, SUPER_ADMIN + `attendance.roster.manage` |
| GET `/roster` | SUPER_ADMIN, HR_ADMIN, MANAGER + `attendance.roster.manage` (a holder is treated like HR) |
| GET `/roster/me` | any employee |

Add `[RosterController, 'attendance.roster.manage']` to the permission
coverage table.

### Frontend (WS-R)

- **`components/roster/RosterGrid.tsx`**:
  - Employees × days, each cell showing the shift code (night shifts marked 🌙)
    or OFF. Cells from assignments are muted, cells from the roster are solid.
  - When editable, clicking a cell opens a picker (shift list, OFF, clear).
    Changes batch into one "Save" (`PUT /roster/cells`).
  - Week navigation (7 or 14 days) and a department filter.
- **`admin/roster/page.tsx`**: tabs "Roster" (editable grid) and "Rotation
  patterns" (CRUD plus an "Apply to employees" modal: employee multi-select,
  range, offset, overwrite toggle, result summary).
- **`attendance/roster/page.tsx`**: "My shifts" (the next 14 days, from `GET
  /roster/me`). For managers, also the read-only team grid.

---

## G4. Projects, members and tasks (WS-P)

`backend/src/modules/projects/`: `ProjectsModule`, `projects.service.ts`,
`project-members.service.ts`, `project-tasks.service.ts`,
`project-access.ts`, `projects.controller.ts`, `dto/`.

### Access (`project-access.ts`)

- **Admin** = HR_ADMIN, SUPER_ADMIN, or a holder of `projects.manage`.
- **Project manager** = `project.managerEmployeeId === actor.employeeId`.
- **Member** = a `ProjectMember` row for `actor.employeeId`, any window.
- **Visible** = admin, project manager or member. Anything else → 404.
- Export `canManageProject(actor, project)` (admin or project manager) and
  `isProjectAdmin(actor)` for the timesheets and utilisation code.

### Rules

- **Create/update project** (admin only):
  - `code` is uppercased, 2..20 characters of `[A-Z0-9-]`, and unique per
    tenant (409).
  - `endDate >= startDate`.
  - `managerEmployeeId` must be an ACTIVE employee of the tenant.
  - Status changes are free between the four values.
  - Only ACTIVE projects accept new timesheet hours.
- **Members** (admin or project manager):
  - Add `{ employeeId, role?, startDate = today, endDate? }`. The employee must
    be ACTIVE in the tenant. A duplicate → 409.
  - Update `{ role?, startDate?, endDate? }`.
  - Remove: if any `TimesheetEntry` exists for this employee on the project,
    the member is **ended** (`endDate = today`) instead of deleted, and the
    response says so (`{ ended: true }`).
  - The project manager is not auto-added as a member; they must be added to
    log hours.
- **Tasks** (admin or project manager):
  - Create or update `{ name, description?, billable?: boolean | null,
    estimateHours?, status }`.
  - Deleting a task with entries → 409, "close it instead".
- **Loggable projects** for the timesheet page:
  `GET /projects/loggable?weekStart=YYYY-MM-DD` (a Monday, else 400) returns
  ACTIVE projects where the caller has a membership window overlapping that
  week: `[{ id, code, name, billable, member: { startDate, endDate }, tasks:
  [{ id, name, billable, effectiveBillable }] }]` (OPEN tasks only).

### API (`@Controller('projects')`, no class-level `@Roles`)

| Method + path | Who |
|---|---|
| GET `/?status&search&page&limit` | any. Admins see all; others see projects they manage or are members of |
| GET `/loggable?weekStart` | any employee |
| POST `/` | HR_ADMIN, SUPER_ADMIN + `projects.manage` |
| GET `/:id` | visible |
| PUT `/:id` | HR_ADMIN, SUPER_ADMIN + `projects.manage` |
| GET `/:id/members`, GET `/:id/tasks` | visible |
| POST `/:id/members`, PUT/DELETE `/:id/members/:memberId` | admin or project manager (service-checked, 403) |
| POST `/:id/tasks`, PUT/DELETE `/:id/tasks/:taskId` | admin or project manager (service-checked, 403) |

`GET /:id` returns the project, its manager `{ id, name }`, member count, task
count, and `canManage` (for the UI).

### Frontend (WS-P)

- **`projects/page.tsx`**: list with search and status filter. "New project"
  is shown to admins.
- **`projects/[id]/page.tsx`**: tabs "Overview" (edit for admins), "Members"
  (add/end/remove for managers), "Tasks" (add/edit/close for managers) and
  "Hours" (utilisation by employee for this project from G6, shown when
  `canManage`).

---

## G5. Timesheets (WS-T)

`backend/src/modules/timesheets/`: `TimesheetsModule` (imports
`WorkflowModule`, `NotificationsModule` and `RosterModule` for G6),
`timesheets.service.ts`, `timesheet-workflow.handler.ts`,
`timesheets.controller.ts`, `dto/`.

### Rules

- **Week:** `weekStart` must be a Monday (400). The week runs Monday–Sunday.
  Future weeks up to one week ahead may hold draft entries; nothing later.
- **Save entries** `PUT /timesheets/me/:weekStart/entries { entries: [{ date,
  projectId, taskId?, hours, note? }] }`. This **replaces** the week's entries.
  - Upserts the `Timesheet` as DRAFT.
  - Allowed only when the timesheet is absent, DRAFT or REJECTED (else 400). A
    REJECTED timesheet stays REJECTED until submitted.
  - Validation, all in one transaction:
    - `date` is within the week.
    - `0 < hours <= 24` with at most 2 dp.
    - The project is in the tenant and ACTIVE.
    - The caller has a `ProjectMember` window covering `date`.
    - `taskId`, if given, belongs to the project and is OPEN.
    - If the project has any OPEN task, `taskId` is **required**.
    - Each day's total is at most 24.
    - At most 200 entries.
  - `billable = task?.billable ?? project.billable`, captured at save time.
  - `totalHours` is recomputed.
- **Submit** `POST /timesheets/:id/submit` (owner):
  - Status must be DRAFT or REJECTED.
  - `weekStart <= today`.
  - At least one entry.
  - **Every entry re-validated** (membership may have ended since saving) → 400
    listing the offending dates.
  - Transaction: status SUBMITTED, `submittedAt`, then `engine.start(TIMESHEET,
    context { requesterEmployeeId, requesterUserId })` (the restart makes the
    next round after a rejection). `notifyPending` runs after commit.
- **Recall** `POST /timesheets/:id/recall` (owner): SUBMITTED → DRAFT with
  `engine.cancel(tx)`.
- **Approve/reject** through the engine. onFinal is the conditional transition
  SUBMITTED → APPROVED or REJECTED (`decidedAt`, `approverId`,
  `approverNote`), then notify `TIMESHEET_APPROVED` / `TIMESHEET_REJECTED`.
- APPROVED timesheets are immutable.
- **Attended hours:** `GET /timesheets/me?weekStart` returns `{ timesheet:
  Timesheet | null, entries, attendedMinutesByDate: Record<date, number> }`
  (from `AttendanceRecord.workedMinutes`). This is for reference only; there is
  no validation against attendance.

### API (`@Controller('timesheets')`)

| Method + path | Who |
|---|---|
| GET `/me?weekStart` | any employee |
| GET `/me/list?from&to` | any employee (summaries, newest first) |
| PUT `/me/:weekStart/entries` | any employee |
| POST `/:id/submit`, POST `/:id/recall` | owner |
| GET `/pending-approvals` | MANAGER, HR_ADMIN, SUPER_ADMIN (HR/Super all SUBMITTED; others `listActionableEntityIds`) |
| GET `/all?status&from&to&employeeId&departmentId&page&limit` | HR_ADMIN, SUPER_ADMIN |
| GET `/:id` | owner, HR/Super, the employee's direct manager, or an actionable approver; else 404. Includes entries with project/task names and the approval trail link |
| POST `/:id/approve` `{ note? }`, POST `/:id/reject` `{ note? }` | MANAGER, HR_ADMIN, SUPER_ADMIN |

Handler `describe`: title "Timesheet", subtitle `Week of <fmtDate(weekStart)>
· <totalHours> h`, link `/approvals/timesheets`.

### Frontend (WS-T)

- **`timesheets/page.tsx`**:
  - Week picker (Monday–Sunday).
  - Grid: rows are project/task (added from `GET /projects/loggable`), columns
    are days with numeric inputs, plus row and column totals.
  - An "Attended" row showing attendance hours.
  - Note per row applied to all its entries (`note` on each entry).
  - Save draft, Submit, Recall. A status badge, and the rejection note when
    REJECTED.
  - Read-only when SUBMITTED or APPROVED.
- **`approvals/timesheets/page.tsx`**: pending list, a detail drawer with the
  day × project breakdown, approve/reject with a note.

---

## G6. Utilisation report (WS-T)

`backend/src/modules/timesheets/utilisation.service.ts` +
`utilisation.controller.ts` (`@Controller('utilisation')`).

### Computation

Query: `from`, `to` (at most 92 days), `groupBy = employee | project`,
`departmentId?`, `projectId?`, `employeeId?`, `includeSubmitted = false`.

**Hours counted:**

- `TimesheetEntry` rows dated in range whose timesheet is APPROVED, or
  APPROVED or SUBMITTED when `includeSubmitted`.
- Filtered by `projectId` or `employeeId` when given.

**Capacity** (employee grouping only):

1. **Working days** in range: Mon–Fri, excluding active non-optional `Holiday`
   dates of the tenant, and excluding days before the employee's `joinDate` or
   after their `exitDate` if set (`joinDate`/`exitDate` compared as IST calendar days).
2. Minus **approved leave**: each APPROVED `LeaveRequest` day falling on a
   working day counts 1, or 0.5 when `isHalfDay`.
3. Times the **standard hours** of that day, from
   `shiftResolver.daysFor(...)`: `shift.standardWorkMinutes / 60` when there is
   a shift, else 8.

**Rows:**

- `employee`: `{ employeeId, name, code, department, capacityHours,
  loggedHours, billableHours, utilisationPct, billablePct }`, where the
  percentages are `logged / capacity` and `billable / capacity`, 1 dp, or null
  when capacity is 0.
- `project`: `{ projectId, code, name, loggedHours, billableHours,
  billableSharePct (billable / logged), contributors }`.
- `totals` in the same shape. The response also carries the query and
  `generatedAt`.

**Scope:**

| Caller | Employee grouping | Project grouping |
|---|---|---|
| HR/Super or `projects.reports.view` | everyone | everyone |
| MANAGER | direct reports (hours on any project) | projects they manage, each restricted to entries of employees on those projects |
| Project manager (any role) | not available (403) unless MANAGER | their projects only |

A `projectId` or `employeeId` outside the caller's scope → 404.

### API

| Method + path | Who |
|---|---|
| GET `/utilisation?...` | any authenticated user, scoped as above (403 when the caller has no scope at all) |
| GET `/utilisation/export?...` | same scope; CSV (`text/csv`, `utilisation-<from>-<to>-<groupBy>.csv`) |

No `@RequirePermissions` on the controller: the service branches on role, and
the `projects.reports.view` check is done in the service.

### Frontend (WS-T)

**`reports/utilisation/page.tsx`**: range picker (presets: this month, last
month, last 4 weeks), a group-by toggle, department/project filters, an
include-submitted toggle, a table with totals, and CSV download.

---

## G7. Navigation (scaffold)

**Sidebar**, one block per section, appended to the existing children:

- MY WORKSPACE › Attendance: "WFH / On-duty" `/attendance/requests`, "My
  Shifts" `/attendance/roster`.
- MY WORKSPACE: "Timesheets" `/timesheets` and "Projects" `/projects` (no role
  gate).
- Approvals: "WFH / On-duty" `/approvals/attendance-requests` and "Timesheets"
  `/approvals/timesheets` (SUPER_ADMIN, HR_ADMIN, MANAGER).
- Admin: "Roster" `/admin/roster`.
- REPORTS: "Utilisation" `/reports/utilisation` (SUPER_ADMIN, HR_ADMIN,
  MANAGER).

**`permission-paths.ts`**:

- `/admin/roster` → `attendance.roster.manage`.
- `/reports/utilisation` → `projects.reports.view`.

**Frontend API clients** (scaffold, frozen types and function signatures;
implementers may not change them): `api-attendance-requests.ts`,
`api-attendance-capture.ts`, `api-roster.ts`, `api-projects.ts`,
`api-timesheets.ts`, `api-utilisation.ts`.

---

## Workstream table (file ownership, disjoint)

| WS | Owns (backend) | Owns (frontend) |
|---|---|---|
| **WS-A** attendance requests + capture | `attendance/requests/**` (except the frozen types file), `attendance/capture/**`, `attendance/rules/ip-allowlist.ts`, `attendance/rules/day-classification.ts`, `attendance/attendance.service.ts`, `attendance/attendance.controller.ts`, `attendance/dto/attendance.dto.ts`, `attendance/dto/update-attendance-policy.dto.ts`, `attendance/policy/**`, `attendance/regularization.service.ts`, `uploads/uploads.controller.ts`, and their specs | `components/attendance/**`, `app/(protected)/attendance/page.tsx`, `attendance/requests/**`, `approvals/attendance-requests/**`, `admin/attendance-policy/**`, `dashboard/page.tsx`, and tests |
| **WS-R** roster | `roster/**` (except `roster.types.ts`), `attendance/rules/auto-absent.service.ts`, `attendance/rules/shift-lookup.ts`, and their specs | `components/roster/**`, `admin/roster/**`, `attendance/roster/**`, and tests |
| **WS-P** projects | `projects/**` | `projects/**` (app routes), and tests |
| **WS-T** timesheets + utilisation | `timesheets/**` | `timesheets/**`, `approvals/timesheets/**`, `reports/utilisation/**`, and tests |

**Scaffold-owned and frozen for implementers:**

- Backend: `schema.prisma`, the migration, `prisma-mock.ts`, `app.module.ts`,
  `attendance.module.ts`, `workflow.defaults.ts`, `workflow.types.ts`,
  `approval-engine.service.ts` (`TYPE_LABELS` only),
  `payroll-calculation.service.ts`, `employees.service.ts`, `permissions.ts`
  and its specs (WS-R adds only the roster row to
  `permission-coverage.spec.ts`), `roster/roster.types.ts`, `roster/roster.module.ts`,
  `attendance/requests/attendance-requests.types.ts`, and every module file of
  the new modules.
- Frontend: `Sidebar.tsx`, `permission-paths.ts`, every `api-*.ts` above,
  `api-workflow.ts`, and `admin/workflows/page.tsx`.

The scaffold creates stub services and controller shells for every new file
listed as owned, with the constructor dependencies wired, so each workstream
compiles and tests alone.

## Edge cases

- **Overnight shift plus WFH.** A clock-in at 00:30 filed under yesterday's
  night shift checks `covering` for **yesterday** (the shift day), not the
  calendar day.
- **A request approved while a session is open.** The next clock-out picks up
  `covering` and classifies the day as WFH or ON_DUTY.
- **A punch with IP restriction on and `req.ip` undefined** (misconfigured
  proxy) → 403. Fail closed.
- **A selfie uploaded but the punch refused** (IP 403): the upload stays
  unclaimed and becomes unusable after 10 minutes. Purging is a follow-up.
- **Roster applied over a date that already has an attendance record:** the
  record keeps its `shiftId`. The roster only affects punches after the
  change.
- **A timesheet entry whose project turns ON_HOLD after saving:** submit
  re-validation fails with a clear message, and the employee removes the rows.
- **A project manager who is also a member** approves nothing by virtue of
  being PM. Timesheet approval follows the workflow chain.
- **The same employee's week holds entries across two projects with different
  billable defaults:** each entry carries its own `billable`.
- **Utilisation over a range with no working days** (a weekend-only range):
  capacity 0 and percentages null.

## Out of scope (follow-ups)

- Timesheet reminder emails for unsubmitted weeks.
- Selfie retention and purge of unclaimed or old selfies.
- Roster-driven payroll working days (payroll keeps Mon–Fri).
- `ShiftsService.assignShift` deactivating the current assignment when a
  future-dated one is created.
- A PROJECT_MANAGER approver type in the engine (per-project timesheet
  approval).
- Face matching on selfies. Per-department capture policy overrides.
- Biometric punches are not subject to the IP or selfie rules.
