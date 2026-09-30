# Keka Wave G — Time and attendance depth: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WFH/on-duty requests, an IP and selfie punch policy, a shift roster with rotation patterns, projects with members and tasks, weekly timesheets approved through the workflow engine, and a utilisation report.

**Architecture:** One scaffold commit freezes the schema, the migration, the shared-file blocks, the contract types, stub services, module wiring, the Sidebar and the frontend API clients. Four workstreams then run in parallel on disjoint files:

| Workstream | Scope |
|---|---|
| WS-A | Attendance requests and capture policy |
| WS-R | Roster |
| WS-P | Projects |
| WS-T | Timesheets and utilisation |

The roster changes shift lookup through one new service (`ShiftResolverService`). The scaffold makes attendance delegate to it before any workstream starts.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL), Jest, Next.js 16, React 19, axios, react-hot-toast, Node `net.BlockList`.

**Spec (binding):** `docs/superpowers/specs/2026-10-01-keka-wave-g-design.md`. Read the section your workstream owns before starting. This plan gives the order, the tests and the tricky code; the spec gives every rule.

**Branch:** `feat/keka-wave-g`, worktree `.claude/worktrees/wave-g`. All paths below are relative to the worktree root.

## Global Constraints

**Frozen files.** After Task 0, these are frozen for every implementer:

- Backend:
  - `backend/prisma/schema.prisma` and every migration
  - `backend/src/test/helpers/prisma-mock.ts`
  - `backend/src/app.module.ts`
  - `attendance/attendance.module.ts`
  - `workflow/workflow.types.ts`, `workflow/workflow.defaults.ts`, `workflow/approval-engine.service.ts`
  - `payroll/payroll-calculation.service.ts`
  - `employees/employees.service.ts`
  - `common/permissions/**`
  - `roster/roster.types.ts`, `roster/roster.module.ts`
  - `attendance/requests/attendance-requests.types.ts`
  - `projects/projects.module.ts`, `timesheets/timesheets.module.ts`
- Frontend:
  - `frontend/src/components/layout/Sidebar.tsx`
  - `frontend/src/lib/permission-paths.ts`
  - `frontend/src/lib/api-{attendance-requests,attendance-capture,roster,projects,timesheets,utilisation,workflow}.ts`
  - `admin/workflows/page.tsx`

If a contract is genuinely insufficient, stop and report NEEDS_CONTEXT with the exact change you want.

**File ownership and commits.**

- Touch only the files your workstream owns (spec "Workstream table"). New files inside your own directories are yours.
- Four implementers run IN PARALLEL in the same working tree. Commit only your own paths: `git add <paths> && git commit -m "..." -- <paths>` (retry after a few seconds if `index.lock` exists).
- Never `git add -A`, `git stash`, `git checkout` or `git reset` of other files. Do not push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Database.** The DB is a shared remote server. Never run `prisma migrate dev`, `migrate reset`, `db push` or `migrate deploy`. Implementers never touch the database; unit tests use the mock.

**Testing.**

- TDD: write the failing spec first, then the code.
- Backend specs use `createMockPrismaService()` from `backend/src/test/helpers` (the `src/` copy; every new model is already in its list). Use UTC-noon dates in tests (`new Date('2026-03-16T12:00:00Z')`).
- Mock cross-workstream services (`ApprovalEngineService`, `ShiftResolverService`, `AttendanceRequestsService`, `UploadsService`, `NotificationsService`) with jest objects. Never depend on another workstream's implementation.
- Jest path arguments are regexes. Escape parentheses: `npx jest "src/app/\(protected\)/timesheets"`.
- Run only your own suites while working (the CPU is shared).

**Coding rules.**

- Guard `AuthenticatedUser.employeeId` before any Prisma `where`. A missing id on an employee-only route → 400 "No employee record linked to this user".
- Errors: 400 validation/state, 403 authorization (and IP-refused punches), 404 missing or other tenant or not visible, 409 races and duplicates. Every query is scoped by `tenantId`.
- DTOs use class-validator and Swagger decorators like the rest of the codebase (`attendance/dto/regularization.dto.ts`).
- Pagination response shape: `{ data, meta: { total, page, limit, totalPages } }` (as `regularization.service.ts:217`). `limit` is at most 100, default 20.
- Dates on the wire are `YYYY-MM-DD` strings. Parse them with `new Date(\`${s}T00:00:00.000Z\`)`. "Today" is `zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE)` from `attendance/rules/late-mark.ts`.
- Workflow integration copies `attendance/regularization.service.ts` + `regularization-workflow.handler.ts` exactly: start inside the create/submit tx, `void notifyPending` after commit, `act` with `onFinal` doing a conditional update (P2025 → 409), `ADVANCED` → return the row unchanged.
- New controllers use their own prefix. Never add `GET /attendance/<word>`, because `GET /attendance/:employeeId` swallows it.

**Frontend rules.**

- Client components in `app/(protected)/...`.
- API clients from `@/lib/api-*.ts`; unwrap `.data`.
- `react-hot-toast`, components from `@/components/ui`, role gating via `useAuth().hasRole`.
- Current employee via `currentEmployeeId(user)` from `@/lib/current-employee.ts`. The stored user has NO top-level `employeeId`.
- Test mock users take the shape `{ role, employee: { id } }`.
- Loading, empty and error states on every page. No JSX in `.ts` files.

**Before reporting.**

- Your specs pass.
- `cd backend && npx tsc --noEmit -p tsconfig.json` and `cd frontend && npx tsc --noEmit` are clean **in your files**. Others' in-progress files may be noisy: report them, don't fix them.
- `npm run lint` is broken repo-wide; ignore lint.

## Review Focus

These are the failure modes most likely to bite a real user that the obvious tests miss. Each one has a pinned test in its owning task.

1. **Night shift + WFH:** a clock-in at 00:30 IST filed under yesterday's overnight shift must look up the approved request for **yesterday**, not today. Pinned in A3.
2. **Selfie replay:** the same `selfieUploadId` used for two punches (or by another user, or after 10 minutes) must be refused. The claim is a conditional `updateMany` inside the punch transaction. Pinned in A3.
3. **IP behind a proxy / IPv4-mapped IPv6:** `::ffff:10.1.2.3` must match `10.0.0.0/8`, and an undefined IP must fail closed. Pinned in A1.
4. **Roster OFF vs auto-absent vs overnight:** a rostered OFF day must not be auto-marked absent. A rostered night shift must scope the employee as a night worker in the sweep. Pinned in R2.
5. **Timesheet resubmission after membership ends:** entries saved while a member, then submitted after the membership ended, must be refused on submit with the offending dates. Pinned in T1.
6. **Utilisation leave and holidays:** a half-day leave on a working day removes half the day's hours, and a holiday on a Saturday removes nothing. Pinned in T3.

---

## Task 0: Scaffold (controller-owned, one commit)

**Files:**

- Modify:
  - `backend/prisma/schema.prisma`
  - `backend/src/test/helpers/prisma-mock.ts`
  - `backend/src/app.module.ts`
  - `backend/src/modules/attendance/attendance.module.ts`
  - `backend/src/modules/attendance/attendance.service.ts` (`findShiftOn` body + constructor only)
  - `backend/src/modules/workflow/workflow.defaults.ts`
  - `backend/src/modules/workflow/approval-engine.service.ts` (`TYPE_LABELS`)
  - `backend/src/modules/workflow/workflow-definitions.service.spec.ts` (type list)
  - `backend/src/modules/payroll/payroll-calculation.service.ts` (status list)
  - `backend/src/modules/employees/employees.service.ts` (summary)
  - `backend/src/common/permissions/permissions.ts` (+ `permissions.spec.ts` if it pins the list)
  - `backend/src/modules/attendance/attendance.service.spec.ts` (resolver provider only)
  - `frontend/src/components/layout/Sidebar.tsx`
  - `frontend/src/lib/permission-paths.ts`
  - `frontend/src/lib/api-workflow.ts`
  - `frontend/src/app/(protected)/admin/workflows/page.tsx`
- Create:
  - the migration `backend/prisma/migrations/20261001100000_keka_wave_g/migration.sql`
  - `roster/{roster.module.ts, roster.types.ts, shift-resolver.service.ts (+spec), rotation-patterns.service.ts, roster.service.ts, roster.controller.ts}`
  - `projects/{projects.module.ts, projects.service.ts, project-members.service.ts, project-tasks.service.ts, project-access.ts, projects.controller.ts}`
  - `timesheets/{timesheets.module.ts, timesheets.service.ts, timesheet-workflow.handler.ts, timesheets.controller.ts, utilisation.service.ts, utilisation.controller.ts}`
  - `attendance/requests/{attendance-requests.types.ts, attendance-requests.service.ts, attendance-requests.controller.ts, wfh-request-workflow.handler.ts, on-duty-request-workflow.handler.ts}`
  - `attendance/capture/{attendance-capture.service.ts, attendance-capture.controller.ts}`
  - `frontend/src/lib/api-{attendance-requests,attendance-capture,roster,projects,timesheets,utilisation}.ts`

**Interfaces produced (frozen contracts every workstream codes against):**

```ts
// backend/src/modules/roster/roster.types.ts
import type { Shift } from '@prisma/client';
export type ShiftDaySource = 'ROSTER' | 'ASSIGNMENT' | 'NONE';
export interface ResolvedShiftDay {
  employeeId: string;
  date: Date;            // UTC midnight (@db.Date)
  shift: Shift | null;   // null when OFF or no shift
  isOff: boolean;        // true only for a rostered OFF day
  source: ShiftDaySource;
}

// backend/src/modules/roster/shift-resolver.service.ts (scaffold = today's rule, assignments only)
@Injectable()
export class ShiftResolverService {
  constructor(private readonly prisma: PrismaService) {}
  shiftOn(tenantId: string, employeeId: string, date: Date): Promise<Shift | null>;
  dayOn(tenantId: string, employeeId: string, date: Date): Promise<ResolvedShiftDay>;
  daysFor(tenantId: string, employeeIds: string[], from: Date, to: Date): Promise<ResolvedShiftDay[]>;
}

// backend/src/modules/attendance/requests/attendance-requests.types.ts
import type { AttendanceRequestType } from '@prisma/client';
export interface CoveringRequest { id: string; type: AttendanceRequestType }
export const ATTENDANCE_SELFIE_ENTITY = 'attendance-selfie';
export const SELFIE_MAX_AGE_MS = 10 * 60 * 1000;

// AttendanceRequestsService (stub; WS-A implements) — public signatures:
findApprovedCovering(tenantId: string, employeeId: string, date: Date,
  tx?: Prisma.TransactionClient): Promise<CoveringRequest | null>;

// backend/src/modules/projects/project-access.ts (scaffold implements; WS-P may extend, not change)
export function isProjectAdmin(actor: AuthenticatedUser): boolean; // HR/SUPER or 'projects.manage'
export function canManageProject(actor: AuthenticatedUser,
  project: { managerEmployeeId: string | null }): boolean;
```

### Steps

- [ ] **Step 1: Schema.**
  - Add exactly the spec's "G.0 Data model" block to `schema.prisma`.
  - Enum values go at the end of each enum under a `// Keka wave G (time and attendance)` comment. New models go after the last model, one block with the same comment.
  - Back-relations go at the end of each relation list in `Tenant`, `Employee`, `Shift` and `Upload`.
  - Name the two `Upload` relations on `AttendanceSession` `"SessionInSelfie"` and `"SessionOutSelfie"`.
  - Run `cd backend && npx prisma validate && npx prisma generate`.
- [ ] **Step 2: Migration (no database).**

```bash
cd backend
git show origin/main:backend/prisma/schema.prisma > "$SCRATCH/base.prisma"
mkdir -p prisma/migrations/20261001100000_keka_wave_g
npx prisma migrate diff --from-schema-datamodel "$SCRATCH/base.prisma" \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/20261001100000_keka_wave_g/migration.sql
```

  Check the SQL contains the enum additions (`ALTER TYPE ... ADD VALUE`), the nine `CREATE TABLE` statements, and the three `ALTER TABLE` statements for `AttendancePolicy`, `AttendanceSession` and the indexes. It must contain no `DROP`.

- [ ] **Step 3: Mock model list.**
  - Append to `prismaModels` in `backend/src/test/helpers/prisma-mock.ts`: `// Keka wave G (time and attendance)`, then `'attendanceRequest', 'shiftRotationPattern', 'shiftRotationPatternDay', 'rosterEntry', 'project', 'projectMember', 'projectTask', 'timesheet', 'timesheetEntry'`.
- [ ] **Step 4: Workflow blocks.**
  - `workflow.defaults.ts`: after `OFFER`, add a comment line and three entries (`WFH_REQUEST`, `ON_DUTY_REQUEST`, `TIMESHEET`), each `...REPORTING_MANAGER_ONLY`, with the names from spec G.0.
  - `TYPE_LABELS`: `WFH_REQUEST: 'Work from home'`, `ON_DUTY_REQUEST: 'On duty'`, `TIMESHEET: 'Timesheet'`.
  - Add the three types to the type list in `workflow-definitions.service.spec.ts`.
  - Frontend `api-workflow.ts`: add them to the union, `WORKFLOW_ENTITY_TYPES` and `WORKFLOW_ENTITY_LABELS`.
  - `admin/workflows/page.tsx`: add `WFH_REQUEST` and `ON_DUTY_REQUEST` to `DAYS_TYPES`.
- [ ] **Step 5: Payroll + employees (outside the area, one line each).**
  - `getAttendanceData`: `status: { in: ['PRESENT', 'WFH', 'ON_DUTY', 'HALF_DAY', 'ABSENT'] }`. ON_DUTY falls into the `presentDays += 1` branch unchanged.
  - Employees summary: `onDutyDays: attendanceRecords.filter((r) => r.status === 'ON_DUTY').length,` after `wfhDays`.
  - Add a payroll spec case: an ON_DUTY record counts as 1 present day.
- [ ] **Step 6: Permissions.**
  - Append to `PERMISSIONS`:

    ```ts
    // Keka wave G (time and attendance)
    { key: 'attendance.roster.manage', group: 'Attendance', label: 'Manage shift roster', description: 'Create rotation patterns, apply them and edit the roster grid.' },
    { key: 'projects.manage', group: 'Projects', label: 'Manage projects', description: 'Create and edit projects and set project managers.' },
    { key: 'projects.reports.view', group: 'Projects', label: 'View utilisation', description: 'View the utilisation report for all employees and projects.' },
    ```

  - Update `permissions.spec.ts` if it pins the count or list.
  - The scaffold does **not** touch `permission-coverage.spec.ts`: its `RosterController` shell has no routes yet, so WS-R adds the `[RosterController, 'attendance.roster.manage']` row in Task R3 together with the decorated routes.
- [ ] **Step 7: Resolver (scaffold = today's rule) + delegation.**
  - Create `ShiftResolverService` with today's assignment rule.
  - `dayOn` returns `{ employeeId, date, shift, isOff: false, source: shift ? 'ASSIGNMENT' : 'NONE' }`.
  - `daysFor` fetches covering assignments for all employees in range with **one** `shiftAssignment.findMany({ where: { tenantId, employeeId: { in }, isActive: true, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, orderBy: NEWEST_ASSIGNMENT_FIRST, include: { shift: true } })`. It then picks, per employee per day, the first row covering that day (`effectiveShift`).
  - Spec `shift-resolver.service.spec.ts` covers:
    - `shiftOn` returns the assignment's active shift.
    - An inactive shift → null.
    - `daysFor` returns one entry per employee per day, including days with no assignment (`source 'NONE'`).
  - `AttendanceService`: inject `ShiftResolverService`. The body of `findShiftOn` becomes `return this.shiftResolver.shiftOn(tenantId, employeeId, date);`. Update `attendance.service.spec.ts` providers to pass a resolver mock backed by the same `shiftAssignment.findFirst` behaviour, or a jest mock whose `shiftOn` returns what the old tests' assignment mock returned. The existing specs must stay green.
- [ ] **Step 8: Modules and stubs.**
  - `RosterModule` provides and exports `ShiftResolverService`, `RotationPatternsService` and `RosterService`, with controller `RosterController`.
  - `ProjectsModule` provides `ProjectsService`, `ProjectMembersService` and `ProjectTasksService`, with controller `ProjectsController`.
  - `TimesheetsModule` imports `WorkflowModule`, `NotificationsModule` and `RosterModule`. It provides `TimesheetsService`, `TimesheetWorkflowHandler` and `UtilisationService`, with controllers `TimesheetsController` and `UtilisationController`.
  - `AttendanceModule` adds to `imports`: `RosterModule`, `UploadsModule`.
  - `AttendanceModule` adds to `providers`: `AttendanceRequestsService`, `WfhRequestWorkflowHandler`, `OnDutyRequestWorkflowHandler`, `AttendanceCaptureService`.
  - `AttendanceModule` adds to `controllers`: `AttendanceRequestsController`, `AttendanceCaptureController`.
  - `AttendanceModule` adds to `exports`: `AttendanceRequestsService`.
  - `app.module.ts`: `// Keka wave G (time and attendance)` then `RosterModule, ProjectsModule, TimesheetsModule,` at the end of `imports`, with the import lines at the end of the import list.
  - Every stub service method throws `new NotImplementedException()`. Every controller shell is an empty class with `@ApiTags`, `@Controller('<prefix>')` and `@UseGuards(JwtAuthGuard, RolesGuard)`. Each workflow handler shell implements `WorkflowEntityHandler` with methods throwing `NotImplementedException`, and **does not register** in `onModuleInit` yet (the owning WS adds registration).
  - `project-access.ts` is fully implemented (small):

```ts
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';

export function isProjectAdmin(actor: AuthenticatedUser): boolean {
  return (
    actor.role === UserRole.SUPER_ADMIN ||
    actor.role === UserRole.HR_ADMIN ||
    (actor.permissions ?? []).includes('projects.manage')
  );
}

export function canManageProject(
  actor: AuthenticatedUser,
  project: { managerEmployeeId: string | null },
): boolean {
  if (isProjectAdmin(actor)) return true;
  return !!actor.employeeId && project.managerEmployeeId === actor.employeeId;
}
```

- [ ] **Step 9: Frontend API clients (frozen; write in full).** Use `import { api } from '@/lib/api';` in each file, and add a shared `Paginated<T>` = `{ data: T[]; meta: { total: number; page: number; limit: number; totalPages: number } }` in each file that needs it.

```ts
// api-attendance-requests.ts
export type AttendanceRequestType = 'WFH' | 'ON_DUTY';
export type AttendanceRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface AttendanceRequest {
  id: string; employeeId: string; type: AttendanceRequestType;
  fromDate: string; toDate: string; days: number; reason: string; location: string | null;
  status: AttendanceRequestStatus; approverNote: string | null;
  decidedAt: string | null; cancelledAt: string | null; createdAt: string;
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string };
}
export interface CreateAttendanceRequestInput {
  type: AttendanceRequestType; fromDate: string; toDate: string; reason: string; location?: string;
}
export const attendanceRequestsApi = {
  create: (input: CreateAttendanceRequestInput) => api.post<AttendanceRequest>('/attendance-requests', input),
  getMine: (params?: { status?: AttendanceRequestStatus; from?: string; to?: string }) =>
    api.get<AttendanceRequest[]>('/attendance-requests/me', { params }),
  getPendingApprovals: () => api.get<AttendanceRequest[]>('/attendance-requests/pending-approvals'),
  getAll: (params?: { type?: AttendanceRequestType; status?: AttendanceRequestStatus; from?: string; to?: string; employeeId?: string; page?: number; limit?: number }) =>
    api.get<Paginated<AttendanceRequest>>('/attendance-requests/all', { params }),
  approve: (id: string, note?: string) => api.post<AttendanceRequest>(`/attendance-requests/${id}/approve`, { note }),
  reject: (id: string, note?: string) => api.post<AttendanceRequest>(`/attendance-requests/${id}/reject`, { note }),
  cancel: (id: string) => api.post<AttendanceRequest>(`/attendance-requests/${id}/cancel`),
};

// api-attendance-capture.ts
export interface CapturePolicyStatus {
  ipRestrictionEnabled: boolean; ipAllowed: boolean; selfieRequired: boolean;
  coveringRequest: { id: string; type: 'WFH' | 'ON_DUTY' } | null; clientIp: string | null;
}
export const attendanceCaptureApi = {
  getPolicy: () => api.get<CapturePolicyStatus>('/attendance-capture/policy'),
  uploadSelfie: (file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'selfie.jpg');
    return api.post<{ uploadId: string }>('/attendance-capture/selfie', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getSelfie: (sessionId: string, which: 'in' | 'out') =>
    api.get<Blob>(`/attendance-capture/selfies/${sessionId}/${which}`, { responseType: 'blob' }),
};

// api-roster.ts
export interface RotationPattern {
  id: string; name: string; description: string | null; cycleLength: number; isActive: boolean;
  days: { dayIndex: number; shiftId: string | null }[];
}
export interface RotationPatternInput { name: string; description?: string; days: (string | null)[] }
export interface RosterCell {
  date: string; shiftId: string | null; shiftCode: string | null; shiftName: string | null;
  isOvernight: boolean; isOff: boolean; source: 'ROSTER' | 'ASSIGNMENT' | 'NONE';
}
export interface RosterRow {
  employee: { id: string; name: string; code: string; department: string | null };
  cells: RosterCell[];
}
export interface RosterGrid { days: string[]; rows: RosterRow[] }
export interface ApplyPatternInput {
  patternId: string; employeeIds: string[]; startDate: string; endDate: string;
  cycleOffset?: number; overwriteManual?: boolean;
}
export interface CellUpdate { employeeId: string; date: string; shiftId?: string | null; isOff?: boolean; clear?: boolean }
export const rosterApi = {
  listPatterns: () => api.get<RotationPattern[]>('/roster/patterns'),
  createPattern: (input: RotationPatternInput) => api.post<RotationPattern>('/roster/patterns', input),
  updatePattern: (id: string, input: RotationPatternInput) => api.put<RotationPattern>(`/roster/patterns/${id}`, input),
  deletePattern: (id: string) => api.delete<void>(`/roster/patterns/${id}`),
  apply: (input: ApplyPatternInput) =>
    api.post<{ created: number; updated: number; skippedManual: number }>('/roster/apply', input),
  getGrid: (params: { from: string; to: string; departmentId?: string; employeeIds?: string }) =>
    api.get<RosterGrid>('/roster', { params }),
  updateCells: (cells: CellUpdate[]) => api.put<RosterRow[]>('/roster/cells', { cells }),
  getMine: (params: { from: string; to: string }) => api.get<RosterCell[]>('/roster/me', { params }),
};

// api-projects.ts
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export interface Project {
  id: string; code: string; name: string; clientName: string | null; description: string | null;
  billable: boolean; status: ProjectStatus; startDate: string | null; endDate: string | null;
  managerEmployeeId: string | null; manager: { id: string; name: string } | null;
  memberCount: number; taskCount: number; canManage: boolean;
}
export interface ProjectInput {
  code: string; name: string; clientName?: string; description?: string; billable?: boolean;
  status?: ProjectStatus; startDate?: string | null; endDate?: string | null; managerEmployeeId?: string | null;
}
export interface ProjectMember {
  id: string; employeeId: string; role: string | null; startDate: string; endDate: string | null;
  employee: { id: string; name: string; code: string };
}
export interface ProjectTask {
  id: string; name: string; description: string | null; billable: boolean | null;
  effectiveBillable: boolean; status: 'OPEN' | 'CLOSED'; estimateHours: number | null;
}
export interface LoggableProject {
  id: string; code: string; name: string; billable: boolean;
  member: { startDate: string; endDate: string | null };
  tasks: { id: string; name: string; billable: boolean | null; effectiveBillable: boolean }[];
}
export const projectsApi = {
  list: (params?: { status?: ProjectStatus; search?: string; page?: number; limit?: number }) =>
    api.get<Paginated<Project>>('/projects', { params }),
  loggable: (weekStart: string) => api.get<LoggableProject[]>('/projects/loggable', { params: { weekStart } }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (input: ProjectInput) => api.post<Project>('/projects', input),
  update: (id: string, input: Partial<ProjectInput>) => api.put<Project>(`/projects/${id}`, input),
  listMembers: (id: string) => api.get<ProjectMember[]>(`/projects/${id}/members`),
  addMember: (id: string, input: { employeeId: string; role?: string; startDate?: string; endDate?: string | null }) =>
    api.post<ProjectMember>(`/projects/${id}/members`, input),
  updateMember: (id: string, memberId: string, input: { role?: string | null; startDate?: string; endDate?: string | null }) =>
    api.put<ProjectMember>(`/projects/${id}/members/${memberId}`, input),
  removeMember: (id: string, memberId: string) =>
    api.delete<{ ended: boolean }>(`/projects/${id}/members/${memberId}`),
  listTasks: (id: string) => api.get<ProjectTask[]>(`/projects/${id}/tasks`),
  createTask: (id: string, input: { name: string; description?: string; billable?: boolean | null; estimateHours?: number | null }) =>
    api.post<ProjectTask>(`/projects/${id}/tasks`, input),
  updateTask: (id: string, taskId: string, input: { name?: string; description?: string | null; billable?: boolean | null; estimateHours?: number | null; status?: 'OPEN' | 'CLOSED' }) =>
    api.put<ProjectTask>(`/projects/${id}/tasks/${taskId}`, input),
  deleteTask: (id: string, taskId: string) => api.delete<void>(`/projects/${id}/tasks/${taskId}`),
};

// api-timesheets.ts
export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export interface TimesheetEntry {
  id: string; date: string; projectId: string; taskId: string | null; hours: number;
  billable: boolean; note: string | null;
  project?: { id: string; code: string; name: string }; task?: { id: string; name: string } | null;
}
export interface Timesheet {
  id: string; employeeId: string; weekStart: string; status: TimesheetStatus; totalHours: number;
  submittedAt: string | null; decidedAt: string | null; approverNote: string | null;
  employee?: { id: string; name: string; code: string };
  entries?: TimesheetEntry[];
}
export interface MyWeek {
  timesheet: Timesheet | null; entries: TimesheetEntry[];
  attendedMinutesByDate: Record<string, number>;
}
export interface EntryInput { date: string; projectId: string; taskId?: string | null; hours: number; note?: string | null }
export const timesheetsApi = {
  getMyWeek: (weekStart: string) => api.get<MyWeek>('/timesheets/me', { params: { weekStart } }),
  listMine: (params?: { from?: string; to?: string }) => api.get<Timesheet[]>('/timesheets/me/list', { params }),
  saveEntries: (weekStart: string, entries: EntryInput[]) =>
    api.put<MyWeek>(`/timesheets/me/${weekStart}/entries`, { entries }),
  submit: (id: string) => api.post<Timesheet>(`/timesheets/${id}/submit`),
  recall: (id: string) => api.post<Timesheet>(`/timesheets/${id}/recall`),
  getPendingApprovals: () => api.get<Timesheet[]>('/timesheets/pending-approvals'),
  getAll: (params?: { status?: TimesheetStatus; from?: string; to?: string; employeeId?: string; departmentId?: string; page?: number; limit?: number }) =>
    api.get<Paginated<Timesheet>>('/timesheets/all', { params }),
  get: (id: string) => api.get<Timesheet>(`/timesheets/${id}`),
  approve: (id: string, note?: string) => api.post<Timesheet>(`/timesheets/${id}/approve`, { note }),
  reject: (id: string, note?: string) => api.post<Timesheet>(`/timesheets/${id}/reject`, { note }),
};

// api-utilisation.ts
export type UtilisationGroupBy = 'employee' | 'project';
export interface UtilisationQuery {
  from: string; to: string; groupBy: UtilisationGroupBy; departmentId?: string;
  projectId?: string; employeeId?: string; includeSubmitted?: boolean;
}
export interface EmployeeUtilisationRow {
  employeeId: string; name: string; code: string; department: string | null;
  capacityHours: number; loggedHours: number; billableHours: number;
  utilisationPct: number | null; billablePct: number | null;
}
export interface ProjectUtilisationRow {
  projectId: string; code: string; name: string; loggedHours: number; billableHours: number;
  billableSharePct: number | null; contributors: number;
}
export interface UtilisationReport {
  query: UtilisationQuery; generatedAt: string;
  rows: EmployeeUtilisationRow[] | ProjectUtilisationRow[];
  totals: Omit<EmployeeUtilisationRow, 'employeeId' | 'name' | 'code' | 'department'>
        | Omit<ProjectUtilisationRow, 'projectId' | 'code' | 'name'>;
}
export const utilisationApi = {
  get: (query: UtilisationQuery) => api.get<UtilisationReport>('/utilisation', { params: query }),
  exportCsv: (query: UtilisationQuery) =>
    api.get<Blob>('/utilisation/export', { params: query, responseType: 'blob' }),
};
```

- [ ] **Step 10: Sidebar + permission paths.**
  - Add the spec G7 entries as appended children, one block per section, with icons from `lucide-react` already imported or added to the import line (`Home`, `CalendarRange`, `Timer`, `FolderKanban`, `BarChart3`).
  - `permission-paths.ts`: `'/admin/roster': 'attendance.roster.manage'` and `'/reports/utilisation': 'projects.reports.view'`, one block.
- [ ] **Step 11: Verify and commit.**
  - Run `cd backend && npx prisma validate && npx tsc --noEmit -p tsconfig.json` and `npx jest src/modules/attendance src/modules/roster src/modules/workflow src/modules/payroll/payroll-calculation src/common/permissions`.
  - Run `cd frontend && npx tsc --noEmit` and `npx jest src/lib src/components/layout`.
  - All green, then commit with this plan file:
    `git commit -m "chore(wave-g): scaffold — schema, migration, contracts, stubs, wiring"`.

---

## WS-A — Attendance requests and capture policy

**Owns:** see the spec workstream table (WS-A row).
**Consumes:** `ApprovalEngineService`, `WorkflowRegistry`, `findUserIdForEmployee` (`workflow/workflow.utils.ts`), `NotificationsService.create({ tenantId, userId, type, title, message, link })`, `UploadsService.upload(file, tenantId, userId, entityType?, entityId?)`, `ShiftResolverService` (already delegated by the scaffold), and the contract types.

### Task A1: IP allowlist rule + capture policy fields

**Files:**
- Create: `backend/src/modules/attendance/rules/ip-allowlist.ts`, `rules/ip-allowlist.spec.ts`
- Modify: `attendance/dto/update-attendance-policy.dto.ts`, `attendance/policy/attendance-policy.service.ts` (+spec)

**Interfaces produced:** `isIpAllowed(ip: string | undefined | null, ranges: string[]): boolean`, `validateIpRange(entry: string): string | null`, `normaliseIp(ip): { address: string; family: 'ipv4' | 'ipv6' } | null`.

- [ ] **Step 1: Failing spec** (`ip-allowlist.spec.ts`):

```ts
import { isIpAllowed, validateIpRange } from './ip-allowlist';

describe('isIpAllowed', () => {
  const ranges = ['10.0.0.0/8', '203.0.113.7', '2001:db8::/32'];
  it.each([
    ['10.1.2.3', true],
    ['::ffff:10.1.2.3', true],          // IPv4-mapped IPv6 from Node sockets
    ['203.0.113.7', true],
    ['203.0.113.8', false],
    ['2001:db8:1::5', true],
    ['2001:db9::1', false],
    ['', false],
    ['not-an-ip', false],
  ])('%s -> %s', (ip, expected) => expect(isIpAllowed(ip, ranges)).toBe(expected));
  it('fails closed on undefined', () => expect(isIpAllowed(undefined, ranges)).toBe(false));
  it('empty list allows nothing', () => expect(isIpAllowed('10.1.2.3', [])).toBe(false));
});

describe('validateIpRange', () => {
  it.each(['10.0.0.0/8', '192.168.1.10', '2001:db8::/32', '::1'])('%s ok', (r) =>
    expect(validateIpRange(r)).toBeNull());
  it.each(['10.0.0.0/33', '300.1.1.1', 'abc', '2001:db8::/129', ''])('%s invalid', (r) =>
    expect(validateIpRange(r)).toMatch(/invalid/i));
});
```

- [ ] **Step 2: Run** `cd backend && npx jest src/modules/attendance/rules/ip-allowlist`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**

```ts
import { BlockList, isIP } from 'node:net';

type Family = 'ipv4' | 'ipv6';

export function normaliseIp(ip: string | undefined | null): { address: string; family: Family } | null {
  if (!ip) return null;
  let address = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) address = mapped[1];
  const v = isIP(address);
  if (v === 4) return { address, family: 'ipv4' };
  if (v === 6) return { address, family: 'ipv6' };
  return null;
}

function parseEntry(entry: string): { address: string; family: Family; prefix: number | null } | null {
  const [addr, prefixText, extra] = entry.trim().split('/');
  if (extra !== undefined) return null;
  const n = normaliseIp(addr);
  if (!n) return null;
  if (prefixText === undefined) return { ...n, prefix: null };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > (n.family === 'ipv4' ? 32 : 128)) return null;
  return { ...n, prefix };
}

export function validateIpRange(entry: string): string | null {
  return parseEntry(entry) ? null : `Invalid IP address or range: "${entry}"`;
}

export function isIpAllowed(ip: string | undefined | null, ranges: string[]): boolean {
  const target = normaliseIp(ip);
  if (!target || ranges.length === 0) return false;
  const list = new BlockList();
  for (const r of ranges) {
    const e = parseEntry(r);
    if (!e) continue;
    if (e.prefix === null) list.addAddress(e.address, e.family);
    else list.addSubnet(e.address, e.prefix, e.family);
  }
  return list.check(target.address, target.family);
}
```

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Policy DTO + service.**
  - DTO: `@IsOptional() @IsBoolean() ipRestrictionEnabled`, `@IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) allowedIpRanges`, `@IsOptional() @IsBoolean() selfieRequired`.
  - In `AttendancePolicyService.update`:
    - Trim and de-duplicate the ranges. The first `validateIpRange` error → `BadRequestException(message)`.
    - Compute the effective values after the update (`dto.x ?? current.x`). `ipRestrictionEnabled && allowedIpRanges.length === 0` → 400 "Add at least one allowed IP range before enabling IP restriction".
  - Specs:
    - Invalid range → 400 naming it.
    - Enabling with an empty list → 400.
    - Enabling with a list succeeds.
    - Disabling while clearing the list succeeds.
    - Duplicates are collapsed.
- [ ] **Step 6: Run** `npx jest src/modules/attendance/policy src/modules/attendance/rules/ip-allowlist`. Expected: PASS. **Commit** (`feat(wave-g): IP allowlist rule and capture policy settings`).

### Task A2: Attendance requests service, handlers, controller

**Files:**
- Modify: `attendance/requests/attendance-requests.service.ts`, `attendance-requests.controller.ts`, `wfh-request-workflow.handler.ts`, `on-duty-request-workflow.handler.ts`
- Create: `attendance/requests/dto/attendance-request.dto.ts` + specs for service, controller and handlers

**Interfaces produced:**
- `create(actor, dto)`, `listMine(actor, q)`, `listPendingApprovals(actor)`, `listAll(tenantId, q)`, `approve(actor, id, note?)`, `reject(actor, id, note?)`, `cancel(actor, id)`
- `findApprovedCovering(tenantId, employeeId, date, tx?)`
- `describe(tenantId, ids)`, `getContext(tenantId, id, type)`

- [ ] **Step 1: Failing service spec** (`attendance-requests.service.spec.ts`). Build the service with `createMockPrismaService()`, an engine mock `{ start: jest.fn(), notifyPending: jest.fn(), act: jest.fn(), cancel: jest.fn(), listActionableEntityIds: jest.fn() }` and a notifications mock. Cases:
  - **create:**
    - Creates PENDING with `days = 3` for 2026-03-16..18.
    - Calls `engine.start` with `entityType: 'WFH_REQUEST'` (or `'ON_DUTY_REQUEST'` for ON_DUTY) and `context.days = 3` **with the tx**.
    - Calls `notifyPending` after.
    - `fromDate > toDate` → 400.
    - A range over 31 days → 400.
    - `fromDate` more than 30 days before today → 400.
    - `location` with WFH → 400.
    - An overlapping PENDING/APPROVED request (`attendanceRequest.findFirst` returns a row) → 409.
    - An INACTIVE employee → 400.
    - No `employeeId` → 400.
  - **approve:**
    - `act` receives `decision: 'APPROVE'`.
    - Running the captured `onFinal(txMock)`:
      - calls `attendanceRequest.update` with `where { id, status: 'PENDING' }` and status APPROVED;
      - calls `attendanceRecord.updateMany` with `where { tenantId, employeeId, date: { gte: fromDate, lte: min(toDate, today) }, status: 'PRESENT' }`, data `{ status: 'WFH' }`;
      - skips the updateMany when `fromDate > today`;
      - maps P2025 on the update to 409.
    - `outcome: 'ADVANCED'` → returns the row without notifying.
    - `APPROVED` → `notifications.create` with type `ATTENDANCE_REQUEST_APPROVED`.
  - **reject:** mirror of approve without the attendance update.
  - **cancel:**
    - PENDING → CANCELLED plus `engine.cancel(tenantId, type, id, tx)`.
    - APPROVED with `fromDate > today` → CANCELLED.
    - APPROVED spanning today → `toDate` = yesterday, stays APPROVED.
    - APPROVED fully in the past → 400.
    - Not the requester → 404.
    - REJECTED → 400.
  - **findApprovedCovering:** queries `{ tenantId, employeeId, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } }` with `select { id, type }` and uses `tx` when given.
  - **listPendingApprovals:**
    - HR → `where { tenantId, status: 'PENDING' }` with no id filter.
    - MANAGER → `listActionableEntityIds` called for both types, with `id: { in: [...wfhIds, ...odIds] }`.
- [ ] **Step 2: Run** `npx jest src/modules/attendance/requests`. Expected: FAIL.
- [ ] **Step 3: Implement the service** following `regularization.service.ts` line by line:
  - `entityTypeFor(type) = type === 'WFH' ? WorkflowEntityType.WFH_REQUEST : WorkflowEntityType.ON_DUTY_REQUEST`.
  - `days = Math.round((to - from) / 86_400_000) + 1`.
  - `today = zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE)`; `yesterday = previousDateOnly(today)` (from `rules/overnight-shift.ts`).
  - Include `employee: { select: { id, firstName, lastName, employeeCode } }` in list responses.
- [ ] **Step 4: Handlers.** Two thin classes. `WfhRequestWorkflowHandler` has `entityType = WorkflowEntityType.WFH_REQUEST` and `OnDutyRequestWorkflowHandler` has `ON_DUTY_REQUEST`. Both register in `onModuleInit`.
  - `getContext` returns null unless the row is PENDING and of the matching type. Otherwise it returns `{ requesterEmployeeId, requesterUserId: await findUserIdForEmployee(...), days }`.
  - `describe` returns `{ entityId, title: 'Work from home' | 'On duty', subtitle: \`${fmt(from)} – ${fmt(to)} (${days} day${days === 1 ? '' : 's'})\`, requesterName, link: '/approvals/attendance-requests', submittedAt: createdAt }` and only returns rows of its own type.
  - `approve` and `reject` delegate to the service.
  - Spec cases:
    - `getContext` returns null for the other type.
    - `getContext` returns null for non-PENDING rows.
    - `describe` filters by type.
    - `onModuleInit` registers.
- [ ] **Step 5: Controller + DTOs.**
  - Routes exactly as spec G1 (`@Controller('attendance-requests')`).
  - `CreateAttendanceRequestDto`: `@IsEnum(AttendanceRequestType) type`, `@IsDateString() fromDate/toDate`, `@IsString() @MaxLength(500) @IsNotEmpty() reason`, `@IsOptional() @IsString() @MaxLength(200) location`.
  - `DecisionDto`: `@IsOptional() @IsString() @MaxLength(500) note`.
  - List query DTOs use `@Type(() => Number)` for page/limit.
  - The controller spec asserts role metadata on the approve route (`Reflect.getMetadata(ROLES_KEY, ...)`) and delegation.
- [ ] **Step 6: Run.** Expected: PASS. **Commit** (`feat(wave-g): WFH and on-duty requests through the workflow engine`).

### Task A3: Punch rules — IP, geofence waiver, selfie claim, status

**Files:**
- Modify: `attendance/attendance.service.ts` (`clockIn`, `clockOut`, the records queries), `attendance/attendance.controller.ts`, `attendance/dto/attendance.dto.ts`, `attendance/rules/day-classification.ts`, `attendance/regularization.service.ts` (+ their specs)

**Interfaces produced:** `PunchContext { ip: string | undefined; userId: string }`, `clockIn(tenantId, employeeId, dto, ctx)`, `clockOut(tenantId, employeeId, dto, ctx)`.

- [ ] **Step 1: Failing day-classification spec cases.**
  - `classifyWorkedDay(500, 'ON_DUTY', { minHalfDayMinutes: 240, minFullDayMinutes: 480 })` → `'ON_DUTY'`.
  - The same call with 300 minutes → `'HALF_DAY'`.
  - ON_DUTY with 100 minutes → `'ABSENT'`.
- [ ] **Step 2: Implement.** Add `'ON_DUTY'` to `OWNED_STATUSES` and set `const fullDay: AttendanceStatus = status === 'WFH' || status === 'ON_DUTY' ? status : 'PRESENT';`. Run `npx jest src/modules/attendance/rules/day-classification`. Expected: PASS.
- [ ] **Step 3: Failing attendance.service spec cases** (extend `attendance.service.spec.ts`). Add `AttendanceRequestsService` (mock `{ findApprovedCovering: jest.fn().mockResolvedValue(null) }`) and `AttendancePolicyService.getOrCreate` returning a policy with the new fields. Cases:
  1. IP restriction on, `ctx.ip = '198.51.100.9'`, list `['10.0.0.0/8']`, no covering → `ForbiddenException`, and no transaction runs.
  2. The same with covering `{ id, type: 'WFH' }` → succeeds. `attendanceRecord.create` data has `status: 'WFH'`, and the session create has `inIp: '198.51.100.9'`.
  3. Geofence configured and the punch outside the radius, with covering → succeeds. Without covering → 400 (existing behaviour).
  4. `ctx.ip` undefined with restriction on → 403.
  5. `selfieRequired` and no `selfieUploadId` → 400 "A selfie is required".
  6. `selfieUploadId` given: `upload.updateMany` is called inside the tx with `where: { id, tenantId, uploadedBy: ctx.userId, entityType: 'attendance-selfie', entityId: null, createdAt: { gte: expect.any(Date) } }` and `data: { entityId: <session id> }`, and the session is written with `inSelfieUploadId`. `updateMany` returning `{ count: 0 }` → 400 "Selfie upload is invalid, expired or already used".
  7. **Night shift + WFH (Review Focus 1):**
     - Setup: `now = 2026-03-17T19:00:00Z` (00:30 IST on the 18th), and the resolver's `shiftOn` returns an overnight shift 22:00–06:00 for the 17th.
     - Expect `findApprovedCovering` called with `date = 2026-03-17T00:00:00.000Z`.
  8. **Clock-out** with covering `ON_DUTY` and a full day → the record update has `status: 'ON_DUTY'` and the session update has `outIp`.
  9. **Clock-out** with restriction on and a disallowed IP → 403.

  To pass the selfie claim session id: create the session first (`attendanceSession.create` returns `{ id }`), then claim, then `attendanceSession.update({ where: { id }, data: { inSelfieUploadId } })`. Or claim with `entityId: sessionId` after the create — either way inside the same tx.
- [ ] **Step 4: Run** `npx jest src/modules/attendance/attendance.service`. Expected: new cases FAIL, old cases PASS.
- [ ] **Step 5: Implement in `attendance.service.ts`.**
  - Inject `AttendanceRequestsService`.
  - Add a private `assertCaptureAllowed(policy, ctx, covering, verb: 'Clock-in' | 'Clock-out')` that throws 403 "`${verb}` is only allowed from the office network".
  - Add a private `claimSelfie(tx, tenantId, ctx, uploadId, sessionId)`.
  - Order in `clockIn`: active employee → `resolveShiftDay` → `covering` → IP → geofence (skip when covering) → selfie presence → late mark → tx. Inside the tx, the first punch's status is `covering?.type ?? 'PRESENT'`.
  - `clockOut`: the same checks against the open record's date.
  - Pass `currentStatus: covering?.type ?? record.status` to the worked-day classification.
  - Records queries (`GET /attendance/me`, `GET /attendance/:employeeId`): include `sessions: { select: { id, inTime, outTime, inIp, outIp, inSelfieUploadId, outSelfieUploadId }, orderBy: { inTime: 'asc' } }`, mapped to `hasInSelfie` / `hasOutSelfie` booleans. Drop the upload ids from the response.
- [ ] **Step 6: Controller + DTO.**
  - `ClockInDto` and `ClockOutDto` get `@IsOptional() @IsUUID() selfieUploadId?: string`.
  - Controller methods take `@Req() req: Request` and pass `{ ip: req.ip, userId: user.userId }`. Update `attendance.controller.spec.ts`.
- [ ] **Step 7: Regularization.** In `applyRegularization`'s base-status branch (`regularization.service.ts:458`), look up `findApprovedCovering(tenantId, employeeId, date, tx)`. When present, its type is the base; otherwise keep the existing WFH/PRESENT logic.
  - Spec: approving a regularization on a covered ON_DUTY day writes status `ON_DUTY` for a full day.
- [ ] **Step 8: Run** `npx jest src/modules/attendance`. Expected: PASS (all attendance suites). **Commit** (`feat(wave-g): IP and selfie punch policy; WFH and on-duty day status`).

### Task A4: Capture controller (policy status, selfie upload, selfie access) + uploads lockout

**Files:**
- Modify: `attendance/capture/attendance-capture.service.ts`, `attendance-capture.controller.ts`, `uploads/uploads.controller.ts` (+ specs)

- [ ] **Step 1: Failing specs** (`attendance-capture.service.spec.ts`, `uploads.controller.spec.ts`):
  - **`getStatus(actor, ip)`:**
    - Returns `{ ipRestrictionEnabled, ipAllowed: isIpAllowed(ip, ranges), selfieRequired, coveringRequest, clientIp: ip ?? null }`.
    - `coveringRequest` is computed for the **current shift day**. Add a public `AttendanceService.currentShiftDate(tenantId, employeeId, now = new Date()): Promise<Date>` that returns the open record's date when there is an open session (the same record `clockOut` would close), else `(await this.resolveShiftDay(tenantId, employeeId, now)).date`. `AttendanceCaptureService` injects `AttendanceService` (same module) and calls it, then `findApprovedCovering` for that date. Spec: an open session on yesterday's record → yesterday's covering request is returned.
  - **`uploadSelfie(actor, file)`:**
    - Rejects missing files.
    - Rejects mime types other than jpeg/png/webp (400).
    - Rejects files over 2 MB (400).
    - Otherwise calls `uploads.upload(file, tenantId, userId, 'attendance-selfie')` and returns `{ uploadId }`.
  - **`getSelfie(actor, sessionId, which)`:**
    - Loads the session with its record's `employeeId` and the upload (`tenantId` scoped). Missing → 404.
    - Allowed: the employee themself, HR/SUPER, or the employee's direct manager (`employee.managerId === actor.employeeId`). Others → 404.
    - Returns `{ path: uploads.getFilePath(key, tenantId), mimeType }`.
  - **Uploads controller:** `download('attendance-selfie', 'x.jpg', res, user)` → `NotFoundException`, and `getFilePath` is not called.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Controller routes per spec G2.
  - `POST /selfie` uses `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))`.
  - `GET /selfies/:sessionId/:which` uses `@Param('which', new ParseEnumPipe(['in', 'out']))` and streams with `res.setHeader('Content-Type', mimeType); res.setHeader('Content-Disposition', 'inline'); res.sendFile(path)`.
  - Uploads controller: `if (folder === ATTENDANCE_SELFIE_ENTITY) throw new NotFoundException('File not found');` as the first line of `download`.
- [ ] **Step 4: Run** `npx jest src/modules/attendance/capture src/modules/uploads`. Expected: PASS. **Commit** (`feat(wave-g): selfie capture endpoints and private selfie storage`).

### Task A5: Frontend — requests, approvals, capture UI, policy section

**Files:**
- Create:
  - `frontend/src/components/attendance/SelfieCapture.tsx` (+test)
  - `app/(protected)/attendance/requests/page.tsx` (+test)
  - `app/(protected)/approvals/attendance-requests/page.tsx` (+test)
- Modify:
  - `app/(protected)/attendance/page.tsx`
  - `app/(protected)/dashboard/page.tsx`
  - `app/(protected)/admin/attendance-policy/page.tsx` (+ their tests)

- [ ] **Step 1: Failing tests** (React Testing Library, mocking `@/lib/api-attendance-requests` and `@/lib/api-attendance-capture`).
  - **Requests page:**
    - Lists `getMine` rows with status badges.
    - The form hides "Location" for WFH and shows it for ON_DUTY.
    - Submitting calls `create` with `{ type, fromDate, toDate, reason }`.
    - "Cancel" shows only for PENDING, or for APPROVED with `toDate >= today`.
  - **Approvals page:** renders `getPendingApprovals` rows. Approve calls `approve(id, note)` and removes the row. Reject does the same.
  - **Attendance page:**
    - When `getPolicy` returns `selfieRequired: true`, clicking Clock In opens the `SelfieCapture` dialog instead of calling `attendanceApi.clockIn` directly.
    - With `ipRestrictionEnabled && !ipAllowed && !coveringRequest`, the text "Office network only" is visible.
  - **SelfieCapture:** with `navigator.mediaDevices` undefined it renders "Camera not available" and a disabled Confirm button.
  - **Policy page:** it renders the "Punch capture" section. Saving sends `allowedIpRanges` split by newline, trimmed, with empties removed.
- [ ] **Step 2: Run** `cd frontend && npx jest "src/app/\(protected\)/attendance" "src/app/\(protected\)/approvals/attendance-requests" src/components/attendance "src/app/\(protected\)/admin/attendance-policy" "src/app/\(protected\)/dashboard"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`SelfieCapture` props:** `{ open: boolean; onCancel(): void; onCaptured(uploadId: string): void }`.
    - It uses `getUserMedia({ video: { facingMode: 'user' } })` and a `<video>`, and draws the frame to a `<canvas>` with `canvas.toBlob(b, 'image/jpeg', 0.85)`.
    - Preview, Retake, Confirm → `attendanceCaptureApi.uploadSelfie(blob)` → `onCaptured(res.data.uploadId)`.
    - It stops the tracks on close.
  - **Attendance and dashboard pages:**
    - Fetch the policy on mount.
    - For clock-in/out, if `selfieRequired`, open the dialog and then call `attendanceApi.clockIn(lat, lng, { selfieUploadId })` / `attendanceApi.clockOut(lat, lng, { selfieUploadId })`. Both already spread a third `data` argument into the body (`api.ts:142-145`); do not edit `api.ts`.
    - Show 403 messages from the server in a toast.
    - Add an ON_DUTY colour next to WFH in the status maps.
    - Records table: an IP column (`sessions[0]?.inIp`) and a camera button per session with a selfie, which opens the blob in a modal via `URL.createObjectURL`.
  - **Policy page:** add the section with the IP toggle, a textarea and the selfie toggle, sent with the existing update call.
- [ ] **Step 4: Run.** Expected: PASS. **Commit** (`feat(wave-g): WFH/on-duty pages, selfie capture and punch policy UI`).

**WS-A acceptance:** `cd backend && npx jest src/modules/attendance src/modules/uploads` green; the frontend tests above green; tsc clean in owned files.

---

## WS-R — Roster

**Owns:** `backend/src/modules/roster/**` (except `roster.types.ts` and `roster.module.ts`), `attendance/rules/auto-absent.service.ts`, `attendance/rules/shift-lookup.ts` + specs, `common/permissions/permission-coverage.spec.ts` (**one row only**), and the frontend `components/roster/**`, `app/(protected)/admin/roster/**`, `app/(protected)/attendance/roster/**`.
**Consumes:** `ResolvedShiftDay`, `ShiftResolverService` (the scaffold version is yours to extend).

### Task R1: Roster-aware resolver

**Files:**
- Modify: `roster/shift-resolver.service.ts` + spec, `attendance/rules/shift-lookup.ts` (add `rosterDayResult` helper)

**Interfaces produced:** as frozen in Task 0. `daysFor` issues at most two queries.

- [ ] **Step 1: Failing spec cases** (extend `shift-resolver.service.spec.ts`):
  - A roster entry with an active shift wins over an assignment (`source 'ROSTER'`).
  - A roster entry with `isOff: true` → `{ shift: null, isOff: true, source: 'ROSTER' }`.
  - A roster entry with an inactive shift → `{ shift: null, isOff: false, source: 'ROSTER' }` and **no** fallback to the assignment.
  - No roster entry → assignment (`'ASSIGNMENT'`), else `'NONE'`.
  - `daysFor(t, ['e1', 'e2'], 2026-03-16, 2026-03-22)`:
    - returns 14 results;
    - calls `rosterEntry.findMany` once with `{ tenantId, employeeId: { in }, date: { gte, lte } }` and `include: { shift: true }`;
    - calls `shiftAssignment.findMany` once.
  - `shiftOn` delegates to `dayOn(...).shift`.
- [ ] **Step 2: Run** `npx jest src/modules/roster/shift-resolver`. Expected: FAIL.
- [ ] **Step 3: Implement.**

```ts
private fromRoster(employeeId: string, date: Date,
  entry: { isOff: boolean; shift: Shift | null }): ResolvedShiftDay {
  if (entry.isOff) return { employeeId, date, shift: null, isOff: true, source: 'ROSTER' };
  return { employeeId, date, shift: entry.shift?.isActive ? entry.shift : null, isOff: false, source: 'ROSTER' };
}

async dayOn(tenantId: string, employeeId: string, date: Date): Promise<ResolvedShiftDay> {
  const entry = await this.prisma.rosterEntry.findUnique({
    where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
    include: { shift: true },
  });
  if (entry) return this.fromRoster(employeeId, date, entry);
  const assignment = await this.prisma.shiftAssignment.findFirst({
    where: { ...coveringAssignmentWhere(tenantId, date), employeeId },
    orderBy: NEWEST_ASSIGNMENT_FIRST, include: { shift: true },
  });
  const shift = effectiveShift(assignment);
  return { employeeId, date, shift, isOff: false, source: shift ? 'ASSIGNMENT' : 'NONE' };
}
```

  `daysFor`: build `Map<\`${employeeId}|${iso}\`, entry>` from one roster query. Then, for days without an entry, use the covering assignment from the one assignment query: the first row by `startDate desc` with `startDate <= day && (endDate == null || endDate >= day)`. Iterate the days with UTC `setUTCDate(+1)`.

- [ ] **Step 4: Run.** Expected: PASS. Also run `npx jest src/modules/attendance/attendance.service` to confirm night-shift attribution still passes. **Commit** (`feat(wave-g): roster-aware shift resolution`).

### Task R2: Auto-absent uses the resolver

**Files:**
- Modify: `attendance/rules/auto-absent.service.ts` + spec

- [ ] **Step 1: Failing spec cases** (Review Focus 4). Inject a resolver mock `{ daysFor: jest.fn() }`.
  - An employee whose `daysFor` result for the sweep date is `isOff: true` is **not** marked absent.
  - An employee with a rostered overnight shift (`shift.isOvernight: true`, `source 'ROSTER'`) is treated as a night worker by the day/night scoping exactly as an assigned overnight shift is today.
  - All existing auto-absent cases pass when `daysFor` returns the assignment-derived days.
- [ ] **Step 2: Run** `npx jest src/modules/attendance/rules/auto-absent`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Inject `ShiftResolverService`.
  - In `filterByScope`, replace the direct `shiftAssignment` query with `const days = await this.shiftResolver.daysFor(tenantId, employeeIds, date, date)`. Map `employeeId → day`.
  - Exclude `day.isOff`, then apply the existing night/day rule to `day.shift`.
  - Keep the existing "accounted for" checks (attendance row, approved leave, comp-off).
- [ ] **Step 4: Run** `npx jest src/modules/attendance/rules`. Expected: PASS. **Commit** (`feat(wave-g): auto-absent skips rostered OFF days`).

### Task R3: Patterns, apply, grid, cells — service + controller

**Files:**
- Modify: `roster/rotation-patterns.service.ts`, `roster/roster.service.ts`, `roster/roster.controller.ts`, `common/permissions/permission-coverage.spec.ts` (+1 row)
- Create: `roster/dto/roster.dto.ts`, `roster/roster-dates.ts` + specs

**Interfaces produced:** `patternDayIndex(start: Date, date: Date, cycleLength: number, offset: number): number`, `eachDate(from: Date, to: Date): Date[]`, `daysBetween(a: Date, b: Date): number` (in `roster-dates.ts`).

- [ ] **Step 1: Failing spec** (`roster-dates.spec.ts`):

```ts
import { daysBetween, eachDate, patternDayIndex } from './roster-dates';
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
it('index cycles with offset', () => {
  expect(patternDayIndex(d('2026-03-16'), d('2026-03-16'), 4, 0)).toBe(0);
  expect(patternDayIndex(d('2026-03-16'), d('2026-03-21'), 4, 0)).toBe(1);
  expect(patternDayIndex(d('2026-03-16'), d('2026-03-16'), 4, 3)).toBe(3);
  expect(patternDayIndex(d('2026-03-16'), d('2026-03-17'), 4, 3)).toBe(0);
});
it('eachDate inclusive', () => expect(eachDate(d('2026-03-30'), d('2026-04-02'))).toHaveLength(4));
it('daysBetween', () => expect(daysBetween(d('2026-03-16'), d('2026-03-23'))).toBe(7));
```

  Implementation: `daysBetween = Math.round((b.getTime() - a.getTime()) / 86_400_000)`, `patternDayIndex = (daysBetween(start, date) + offset) % cycleLength`.

- [ ] **Step 2: Failing service specs.**
  - **`RotationPatternsService`:**
    - `create` validates `days` length 1..31 and every non-null shiftId is an active shift in the tenant (`shift.findMany` count mismatch → 400). It creates the pattern with nested `days.create` (`dayIndex` = position) and `cycleLength`.
    - `update` replaces the days in a tx (`deleteMany` + `createMany`).
    - `remove` sets `isActive: false`.
    - `list` returns active patterns with days ordered by `dayIndex`.
  - **`RosterService.apply`:**
    - Range over 366 days → 400. `endDate < startDate` → 400.
    - An employee not ACTIVE in the tenant → 400 listing the ids.
    - An inactive pattern → 404.
    - With a 2-day pattern `[S1, null]` over 4 days for 1 employee and no existing entries: `rosterEntry.createMany` gets 4 rows alternating `{ shiftId: 'S1', isOff: false }` / `{ shiftId: null, isOff: true }`, all `source: 'PATTERN'`, and the result is `{ created: 4, updated: 0, skippedManual: 0 }`.
    - An existing MANUAL entry on day 2 without `overwriteManual` → skipped (`skippedManual: 1`). With `overwriteManual` → updated.
    - An existing PATTERN entry → updated.
    - Runs in `$transaction(fn, { timeout: 60_000 })`.
  - **`RosterService.getGrid(actor, q)`:**
    - Range over 42 days → 400.
    - HR → employees `where { tenantId, status: 'ACTIVE', departmentId? }`.
    - MANAGER without the permission → adds `managerId: actor.employeeId`.
    - MANAGER with `permissions: ['attendance.roster.manage']` → no manager filter.
    - Maps `daysFor` into rows and cells (`shiftCode`, `shiftName`, `isOvernight`).
  - **`RosterService.updateCells(actor, cells)`:**
    - More than 1000 cells → 400.
    - A cell with neither `shiftId` nor `isOff` nor `clear` → 400. Both `shiftId` and `isOff` → 400.
    - `clear` → `deleteMany({ where: { tenantId, employeeId, date } })`.
    - Otherwise upsert MANUAL with `patternId: null`.
    - Unknown employee or shift in the tenant → 400.
  - **`RosterService.getMine(actor, q)`:** no employeeId → 400. Range over 42 days → 400.
- [ ] **Step 3: Run** `npx jest src/modules/roster`. Expected: FAIL.
- [ ] **Step 4: Implement** the services.
  - Apply algorithm: load existing entries for `employeeIds × range` in one query. Build create and update lists, with updates grouped by `(shiftId, isOff)` into `updateMany({ where: { id: { in } } })` in chunks of 500. Run `createMany` in chunks of 1000 with `skipDuplicates: false`.
- [ ] **Step 5: Controller + DTOs.**
  - Routes and guards per spec G3.
  - Write routes and `GET /roster` carry `@Roles(...)` + `@RequirePermissions('attendance.roster.manage')`. `GET /roster/me` has no decorators.
  - Add `[RosterController, 'attendance.roster.manage']` to the permission coverage `TABLE`.
  - Validation:
    - `@ArrayMinSize(1) @ArrayMaxSize(31)` on `days`, with each element a string uuid or null (custom `@ValidateIf` or `@IsOptional` per element via a transform to `(string | null)[]`, checked in the service).
    - `@ArrayMaxSize(500)` on `employeeIds`.
    - `@Min(0) @Max(30)` on `cycleOffset`.
- [ ] **Step 6: Run** `npx jest src/modules/roster src/common/permissions`. Expected: PASS. **Commit** (`feat(wave-g): rotation patterns, roster apply, grid and cell edits`).

### Task R4: Frontend roster

**Files:**
- Create:
  - `frontend/src/components/roster/RosterGrid.tsx` (+test)
  - `app/(protected)/admin/roster/page.tsx` (+test)
  - `app/(protected)/attendance/roster/page.tsx` (+test)

- [ ] **Step 1: Failing tests.**
  - **`RosterGrid`:**
    - Renders one row per `rows[]`, cell text = `shiftCode`, or `OFF`, or `—` for NONE. Assignment cells have the class `opacity-60`.
    - With `editable`, clicking a cell opens the picker. Choosing OFF marks the cell dirty and shows "Save (1)".
    - Save calls `onSave([{ employeeId, date, isOff: true }])`.
  - **Admin page:**
    - The tab "Rotation patterns" lists `listPatterns`.
    - Creating a pattern with 3 days sends `days: ['s1', null, 's2']`.
    - The Apply modal posts `apply` and shows the "created / updated / skipped" summary toast.
  - **My shifts page:**
    - Shows `getMine` for the next 14 days.
    - A MANAGER (`{ role: 'MANAGER', employee: { id } }`) also sees a read-only grid (`getGrid` called).
    - An EMPLOYEE does not.
- [ ] **Step 2: Run** `cd frontend && npx jest src/components/roster "src/app/\(protected\)/admin/roster" "src/app/\(protected\)/attendance/roster"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`RosterGrid` props:** `{ grid: RosterGrid; shifts: Shift[]; editable: boolean; onSave?: (cells: CellUpdate[]) => Promise<void> }`.
    - Sticky first column. The night marker is `🌙` when `isOvernight`.
    - Week navigation lives in the pages (7 or 14 day toggle, prev/next).
    - Shifts come from the existing `shiftsApi.getAll()` in `@/lib/api`.
- [ ] **Step 4: Run.** Expected: PASS. **Commit** (`feat(wave-g): roster grid and rotation pattern pages`).

**WS-R acceptance:** `npx jest src/modules/roster src/modules/attendance src/common/permissions` green; the frontend tests above green; tsc clean in owned files.

---

## WS-P — Projects

**Owns:** `backend/src/modules/projects/**` (except `projects.module.ts`; you may add functions to `project-access.ts` but must not change the two scaffold functions), plus the frontend `app/(protected)/projects/**`.
**Consumes:** `isProjectAdmin`, `canManageProject`, `utilisationApi` (frontend, Hours tab only).

### Task P1: Projects service + controller

**Files:**
- Modify: `projects/projects.service.ts`, `projects/projects.controller.ts`
- Create: `projects/dto/project.dto.ts` + specs

**Interfaces produced:** `ProjectsService.list(actor, q)`, `get(actor, id)`, `create(actor, dto)`, `update(actor, id, dto)`, `loggable(actor, weekStart: string)`, `assertVisible(actor, id): Promise<Project>`, `assertManageable(actor, id): Promise<Project>`.

- [ ] **Step 1: Failing spec cases.**
  - **create:**
    - Uppercases the code. Rejects codes not matching `/^[A-Z0-9-]{2,20}$/` → 400.
    - A duplicate code (`project.findFirst` found, or P2002) → 409.
    - `endDate < startDate` → 400.
    - `managerEmployeeId` not ACTIVE in the tenant → 400.
    - A non-admin → 403 (the controller guard also blocks; the service double-checks with `isProjectAdmin`).
  - **list:**
    - An admin gets `where { tenantId }`.
    - A non-admin gets `where { tenantId, OR: [{ managerEmployeeId: eid }, { members: { some: { employeeId: eid } } }] }`.
    - A non-admin with no employeeId → empty result.
    - Search matches `name` / `code` / `clientName` case-insensitively.
  - **get:**
    - A non-visible project → 404.
    - Returns `manager: { id, name }`, `memberCount` / `taskCount` (via `_count`) and `canManage`.
  - **loggable:**
    - `weekStart` not a Monday → 400.
    - Returns ACTIVE projects with a member row for the caller overlapping `[weekStart, weekStart + 6]` (`startDate <= weekEnd && (endDate == null || endDate >= weekStart)`), with OPEN tasks mapped to `effectiveBillable = task.billable ?? project.billable`.
- [ ] **Step 2: Run** `npx jest src/modules/projects`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Monday check is `date.getUTCDay() === 1`.
  - Employee name is `${firstName} ${lastName}`.
- [ ] **Step 4: Controller.**
  - Routes per spec G4, with no class-level `@Roles`.
  - `POST /` and `PUT /:id` carry `@Roles(SUPER_ADMIN, HR_ADMIN) @RequirePermissions('projects.manage')`.
  - **Order matters:** declare `GET /loggable` before `GET /:id`.
  - Controller spec asserts that order via route metadata (or by calling `loggable` in a Nest testing app).
- [ ] **Step 5: Run.** Expected: PASS. **Commit** (`feat(wave-g): projects CRUD and loggable projects`).

### Task P2: Members and tasks

**Files:**
- Modify: `projects/project-members.service.ts`, `projects/project-tasks.service.ts`, `projects/projects.controller.ts` (+ specs)

- [ ] **Step 1: Failing spec cases.**
  - **Members:**
    - `add` by a non-manager, non-admin → 403.
    - Adding an employee not ACTIVE in the tenant → 400.
    - A duplicate (P2002) → 409.
    - `endDate < startDate` → 400.
    - `startDate` defaults to today.
    - `remove` when a `timesheetEntry.count({ where: { tenantId, projectId, timesheet: { employeeId } } }) > 0` → `update` with `endDate = today` returning `{ ended: true }`. Otherwise `delete` → `{ ended: false }`.
    - A member id of another project → 404.
  - **Tasks:**
    - `create` / `update` by a manager is OK; by a plain member → 403.
    - `delete` with entries → 409 "close it instead".
    - `list` maps `effectiveBillable`.
    - `status` transitions between OPEN and CLOSED are both allowed.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Services use `ProjectsService.assertManageable` / `assertVisible` (inject `ProjectsService`). Wire the routes in the controller.
- [ ] **Step 4: Run** `npx jest src/modules/projects`. Expected: PASS. **Commit** (`feat(wave-g): project members and tasks`).

### Task P3: Frontend projects

**Files:**
- Create: `app/(protected)/projects/page.tsx` (+test), `app/(protected)/projects/[id]/page.tsx` (+test)

- [ ] **Step 1: Failing tests.**
  - **List page:**
    - Renders rows from `projectsApi.list`.
    - "New project" is visible for `{ role: 'HR_ADMIN' }` and hidden for `{ role: 'EMPLOYEE', employee: { id } }`.
    - The create modal posts `create` with an uppercased code.
  - **Detail page:**
    - Tabs render.
    - Members tab: "Add member" only when `project.canManage`. Remove shows the toast "Membership ended (hours already logged)" when the response is `{ ended: true }`.
    - Tasks tab: close toggles `status`.
    - Hours tab: calls `utilisationApi.get({ groupBy: 'employee', projectId, from, to })`, visible only when `canManage`.
- [ ] **Step 2: Run** `cd frontend && npx jest "src/app/\(protected\)/projects"`. Expected: FAIL.
- [ ] **Step 3: Implement.** The employee picker reuses the existing employees list API (`employeesApi` in `@/lib/api`, read-only use).
- [ ] **Step 4: Run.** Expected: PASS. **Commit** (`feat(wave-g): projects pages`).

**WS-P acceptance:** `npx jest src/modules/projects` and the frontend project tests green; tsc clean in owned files.

---

## WS-T — Timesheets and utilisation

**Owns:** `backend/src/modules/timesheets/**` (except `timesheets.module.ts`), plus the frontend `app/(protected)/timesheets/**`, `app/(protected)/approvals/timesheets/**` and `app/(protected)/reports/utilisation/**`.
**Consumes:** `ApprovalEngineService`, `WorkflowRegistry`, `findUserIdForEmployee`, `NotificationsService`, `ShiftResolverService.daysFor`, `isProjectAdmin`, and the Prisma models `project`, `projectMember`, `projectTask`. Read these directly; do not import WS-P services.

### Task T1: Timesheet save, submit, recall

**Files:**
- Modify: `timesheets/timesheets.service.ts`
- Create: `timesheets/timesheet-week.ts`, `timesheets/dto/timesheet.dto.ts` + specs

**Interfaces produced:** `weekEnd(weekStart: Date): Date`, `assertMonday(d: Date): void`, `toHours(dec: Prisma.Decimal | number): number` (in `timesheet-week.ts`). `TimesheetsService.getMyWeek(actor, weekStart)`, `saveEntries(actor, weekStart, dto)`, `submit(actor, id)`, `recall(actor, id)`.

- [ ] **Step 1: Failing spec cases** (`timesheets.service.spec.ts`), with engine and notifications mocks.
  - **saveEntries:**
    - `weekStart` not a Monday → 400.
    - A week more than one week in the future → 400.
    - An existing SUBMITTED or APPROVED timesheet → 400.
    - An entry dated outside the week → 400.
    - `hours` of 0, of 24.5, or with three decimals → 400.
    - A project not ACTIVE → 400.
    - No member window covering the date → 400 naming the date.
    - A task of another project or CLOSED → 400.
    - The project has OPEN tasks and no `taskId` → 400 "Select a task".
    - A day totalling 25 → 400.
    - More than 200 entries → 400.
    - Success:
      - `timesheet.upsert` (DRAFT) and `timesheetEntry.deleteMany({ where: { timesheetId } })` + `createMany` with `billable = task.billable ?? project.billable`.
      - `totalHours` updated.
      - All inside one `$transaction`.
      - A REJECTED timesheet stays REJECTED.
  - **submit:**
    - A non-owner → 404.
    - Status SUBMITTED → 400.
    - `weekStart > today` → 400.
    - No entries → 400.
    - **Membership ended after saving (Review Focus 5):** an entry dated 2026-03-18 while the member's `endDate` is now 2026-03-17 → 400 whose message contains `2026-03-18`.
    - Success: `timesheet.update` status SUBMITTED with `submittedAt`, `engine.start({ entityType: 'TIMESHEET', entityId, context: { requesterEmployeeId, requesterUserId, days: null }, tx })`, then `notifyPending`.
  - **recall:**
    - SUBMITTED → DRAFT plus `engine.cancel(tenantId, 'TIMESHEET', id, tx)`.
    - Any other status → 400.
  - **getMyWeek:**
    - Returns `{ timesheet: null, entries: [], attendedMinutesByDate }` when there is no row.
    - `attendedMinutesByDate` comes from `attendanceRecord.findMany({ where: { tenantId, employeeId, date: { gte, lte } }, select: { date, workedMinutes } })`, keyed by `YYYY-MM-DD`.
- [ ] **Step 2: Run** `npx jest src/modules/timesheets`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Validation is shared between `saveEntries` and `submit` in a private `validateEntries(tx, tenantId, employeeId, weekStart, entries)`.
  - It loads all referenced projects, tasks, open-task counts and member rows in four queries and returns `{ ok: false, errors: string[] }` or the resolved billable flags.
  - Hours math uses `Prisma.Decimal`, and the day totals compare via `.gt(24)`.
- [ ] **Step 4: Run.** Expected: PASS. **Commit** (`feat(wave-g): weekly timesheet save, submit and recall`).

### Task T2: Approval, handler, reads, controller

**Files:**
- Modify: `timesheets/timesheets.service.ts`, `timesheets/timesheet-workflow.handler.ts`, `timesheets/timesheets.controller.ts` (+ specs)

- [ ] **Step 1: Failing spec cases.**
  - **approve and reject:** exactly the regularization shape.
    - The `onFinal` conditional update is `where { id, status: 'SUBMITTED' }`, with P2025 → 409.
    - `ADVANCED` → no notification.
    - A final outcome → `notifications.create` with type `TIMESHEET_APPROVED` / `TIMESHEET_REJECTED` for the owner's user.
  - **get(actor, id):**
    - The owner is OK.
    - HR is OK.
    - The direct manager (`employee.managerId === actor.employeeId`) is OK.
    - An actionable approver (`listActionableEntityIds` contains the id) is OK.
    - Anyone else → 404.
    - Includes entries with project `{ id, code, name }` and task `{ id, name }`.
  - **listPendingApprovals:** HR sees all SUBMITTED; others see the actionable ids.
  - **listAll:** paginated, with filters.
  - **Handler:**
    - `getContext` returns null unless SUBMITTED.
    - `describe` subtitle is `Week of 16 Mar 2026 · 38.5 h`.
    - Registers in `onModuleInit`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Routes per spec G5. Declare every `me/...`, `pending-approvals` and `all` route **before** `GET /:id`.
- [ ] **Step 4: Run** `npx jest src/modules/timesheets`. Expected: PASS. **Commit** (`feat(wave-g): timesheet approval and reads`).

### Task T3: Utilisation report

**Files:**
- Modify: `timesheets/utilisation.service.ts`, `timesheets/utilisation.controller.ts`
- Create: `timesheets/capacity.ts`, `timesheets/dto/utilisation.dto.ts` + specs

**Interfaces produced:**

```ts
// capacity.ts (pure)
export interface CapacityInput {
  from: Date; to: Date; joinDate: Date; exitDate: Date | null;
  holidays: Set<string>;               // 'YYYY-MM-DD'
  leaveDays: Map<string, number>;      // 'YYYY-MM-DD' -> 1 | 0.5
  standardMinutesByDate: Map<string, number>; // from resolver; missing -> 480
}
export function capacityHours(input: CapacityInput): number; // rounded 2 dp
export function pct(num: number, den: number): number | null; // 1 dp, null when den == 0
```

- [ ] **Step 1: Failing spec** (`capacity.spec.ts`, Review Focus 6):

```ts
import { capacityHours, pct } from './capacity';
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base = { joinDate: d('2020-01-01'), exitDate: null, holidays: new Set<string>(),
  leaveDays: new Map<string, number>(), standardMinutesByDate: new Map<string, number>() };

it('Mon-Fri at 8h', () =>
  expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-22') })).toBe(40));
it('holiday on a weekday removes a day; on Saturday removes nothing', () =>
  expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-22'),
    holidays: new Set(['2026-03-17', '2026-03-21']) })).toBe(32));
it('half-day leave removes half the day', () =>
  expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-22'),
    leaveDays: new Map([['2026-03-18', 0.5]]) })).toBe(36));
it('uses the shift standard minutes', () =>
  expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-16'),
    standardMinutesByDate: new Map([['2026-03-16', 540]]) })).toBe(9));
it('clips to join and exit', () =>
  expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-22'),
    joinDate: d('2026-03-18'), exitDate: d('2026-03-19') })).toBe(16));
it('weekend-only range', () =>
  expect(capacityHours({ ...base, from: d('2026-03-21'), to: d('2026-03-22') })).toBe(0));
it('pct', () => { expect(pct(30, 40)).toBe(75); expect(pct(1, 3)).toBe(33.3); expect(pct(5, 0)).toBeNull(); });
```

- [ ] **Step 2: Run** `npx jest src/modules/timesheets/capacity`. Expected: FAIL.
- [ ] **Step 3: Implement.**

```ts
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function capacityHours(i: CapacityInput): number {
  let minutes = 0;
  const join = iso(i.joinDate);
  const exit = i.exitDate ? iso(i.exitDate) : null;
  for (let t = new Date(i.from); t <= i.to; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = t.getUTCDay();
    const key = iso(t);
    if (day === 0 || day === 6) continue;
    if (key < join || (exit && key > exit)) continue;
    if (i.holidays.has(key)) continue;
    const worked = 1 - Math.min(1, i.leaveDays.get(key) ?? 0);
    minutes += worked * (i.standardMinutesByDate.get(key) ?? 480);
  }
  return round2(minutes / 60);
}

export function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}
```

  Before the `iso(i.joinDate)` comparison, normalise `joinDate` / `exitDate` to the IST calendar day with `zonedDateOnlyUtc` (they are `DateTime`, not `@db.Date`).

- [ ] **Step 4: Failing service spec cases** (`utilisation.service.spec.ts`), with a resolver mock `daysFor`:
  - A range over 92 days → 400. `to < from` → 400.
  - **Scope:**
    - HR → all ACTIVE employees (filtered by `departmentId`).
    - A holder of `projects.reports.view` → all.
    - MANAGER → direct reports.
    - MANAGER with `groupBy=project` → only projects where `managerEmployeeId = actor.employeeId`, and entries restricted to those projects.
    - A non-manager project manager with `groupBy=employee` → 403.
    - A plain EMPLOYEE who manages no project → 403.
    - A `projectId` outside scope → 404.
  - **Hours:**
    - Sums only APPROVED timesheets. `includeSubmitted` adds SUBMITTED.
    - Billable is summed from `entry.billable`.
  - **Leave:** APPROVED `LeaveRequest` rows overlapping the range expand to per-day values (1, or 0.5 when `isHalfDay`), capped to the range.
  - **Employee row:** capacity 40, logged 30, billable 20 → `utilisationPct 75`, `billablePct 50`.
  - **Project row:** `billableSharePct` = billable / logged. `contributors` = distinct employees.
  - **totals:** the sum of the rows, with the percentages recomputed from the sums.
  - **exportCsv:**
    - Header `Employee Code,Employee,Department,Capacity (h),Logged (h),Billable (h),Utilisation %,Billable %` for the employee grouping.
    - Header `Project Code,Project,Logged (h),Billable (h),Billable share %,Contributors` for the project grouping.
    - Values containing commas or quotes are CSV-escaped.
- [ ] **Step 5: Implement** `UtilisationService.build(actor, q)` and `exportCsv(actor, q)`.
  - Queries:
    - employees in scope;
    - `timesheetEntry.findMany({ where: { tenantId, date: range, timesheet: { status: { in } , employeeId: { in } }, projectId? }, select: { hours, billable, projectId, timesheet: { select: { employeeId } } } })`;
    - holidays (`isActive: true, isOptional: false`);
    - approved leaves;
    - `shiftResolver.daysFor`.
  - The controller:
    - `GET /utilisation` returns `build(...)`.
    - `GET /utilisation/export` uses `@Res({ passthrough: true })`, sets `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="utilisation-<from>-<to>-<groupBy>.csv"`, and returns the string.
    - DTO: `@IsDateString() from/to`, `@IsIn(['employee', 'project']) groupBy`, optional uuids, `@Transform(({ value }) => value === 'true' || value === true) @IsOptional() @IsBoolean() includeSubmitted`.
- [ ] **Step 6: Run** `npx jest src/modules/timesheets`. Expected: PASS. **Commit** (`feat(wave-g): utilisation report against capacity`).

### Task T4: Frontend timesheets, approvals, utilisation

**Files:**
- Create:
  - `app/(protected)/timesheets/page.tsx` (+test)
  - `app/(protected)/approvals/timesheets/page.tsx` (+test)
  - `app/(protected)/reports/utilisation/page.tsx` (+test)

- [ ] **Step 1: Failing tests.**
  - **Timesheets page:**
    - Week picker defaults to this week's Monday (compute with UTC-noon dates in tests).
    - "Add row" lists `projectsApi.loggable(weekStart)` projects and tasks.
    - Typing `4` in Monday's cell of a row and clicking Save calls `saveEntries(weekStart, [{ date: '<monday>', projectId, taskId, hours: 4, note: null }])`.
    - Row and column totals update.
    - "Attended" row shows `attendedMinutesByDate` in hours.
    - Submit calls `submit(id)`.
    - The status SUBMITTED makes the inputs disabled and shows Recall.
    - REJECTED shows `approverNote`.
  - **Approvals page:**
    - Lists `getPendingApprovals`.
    - Opening a row calls `get(id)` and shows the day × project table.
    - Approve and reject call their APIs with the note.
  - **Utilisation page:**
    - Defaults to this month with `groupBy: 'employee'`.
    - Toggling to project re-queries.
    - Renders percentages with `%` and `—` for null.
    - Download calls `exportCsv` and triggers a blob download (mock `URL.createObjectURL`).
- [ ] **Step 2: Run** `cd frontend && npx jest "src/app/\(protected\)/timesheets" "src/app/\(protected\)/approvals/timesheets" "src/app/\(protected\)/reports/utilisation"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Grid state is `Record<rowKey, Record<date, string>>`. On save, send only cells with numbers > 0. The row key is `${projectId}|${taskId ?? ''}`.
- [ ] **Step 4: Run.** Expected: PASS. **Commit** (`feat(wave-g): timesheet, approval and utilisation pages`).

**WS-T acceptance:** `npx jest src/modules/timesheets` and the frontend tests above green; tsc clean in owned files.

---

## After the workstreams (controller)

1. **Per-task review.** One review per workstream on the mid-tier model, over the path-filtered diff of its commits, checked against this plan and the spec. Its fixes go back to that workstream's implementer.
2. **Whole-branch review.** One review on the most capable model, over `git diff origin/main...HEAD`. Specific asks:
   - authorization gaps (self-approval, cross-tenant ids, selfie access);
   - the Review Focus list;
   - transaction boundaries (engine start/act inside tx, selfie claim inside the punch tx);
   - migration safety (no DROP, enum ADD VALUE).
3. **Fix wave.** One wave, split by workstream ownership.
4. **Merge main.** `git fetch origin && git merge origin/main`.
   - Resolve conflicts, keeping both sides' blocks in the shared files.
   - Rename the migration folder so its timestamp is newer than every migration on main.
   - If main's schema changed, regenerate the SQL with `migrate diff` against the new `origin/main` schema.
   - Run `npx prisma validate && npx prisma generate`.
5. **Full verification, once.**
   - `cd backend && npx tsc --noEmit -p tsconfig.json && npx jest`
   - `cd frontend && npx tsc --noEmit && npx jest && npm run build`
   - Record the counts.
6. **Push and open the PR to main.**
   - The body includes: a summary per part, the product decisions, the migration name, the "outside the area" list (payroll `ON_DUTY`, the employees summary, the uploads selfie lockout, `TYPE_LABELS`, the permissions), the `TRUST_PROXY` deploy note, the follow-ups from the spec, and the test counts.
   - Then STOP. Do not merge.
