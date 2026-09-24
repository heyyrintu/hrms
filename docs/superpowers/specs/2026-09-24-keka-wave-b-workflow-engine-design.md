# Keka Wave B — Workflow engine and multi-level approvals

**Date:** 2026-09-24
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave B)
**Baseline:** `main` at `9e6b301`. Branch `feat/keka-wave-b`.

## Goal

Replace six hard-coded single-level approvals (leave, expense claim, loan,
comp-off, attendance regularization, payroll run) with one configurable,
multi-level approval engine. With no tenant configuration, behaviour matches
today exactly.

## Today (for reference)

| Flow | Model / status awaiting approval | Service approve / reject | Today's approver |
|---|---|---|---|
| LEAVE | `LeaveRequest` PENDING | `leave.service.ts` `approveRequest` / `rejectRequest` | reporting manager; HR/SUPER any |
| EXPENSE | `ExpenseClaim` SUBMITTED | `expenses.service.ts` `approveClaim` / `rejectClaim` | reporting manager; HR/SUPER any |
| LOAN | `EmployeeLoan` REQUESTED | `loans.service.ts` `approve` / `reject` | HR/SUPER only |
| COMP_OFF | `CompOffRequest` PENDING | `leave/comp-off.service.ts` `approve` / `reject` | reporting manager; HR/SUPER any |
| REGULARIZATION | `AttendanceRegularization` PENDING | `attendance/regularization.service.ts` `approve` / `reject` | reporting manager; HR/SUPER any |
| PAYROLL_RUN | `PayrollRun` COMPUTED | `payroll.service.ts` `approveRun` (no reject) | HR/SUPER |

## Data model (scaffold commit)

```prisma
enum WorkflowEntityType { LEAVE EXPENSE LOAN COMP_OFF REGULARIZATION PAYROLL_RUN }
enum WorkflowApproverType { REPORTING_MANAGER MANAGERS_MANAGER HR_ADMIN SPECIFIC_USER ROLE }
enum ApprovalInstanceStatus { PENDING APPROVED REJECTED CANCELLED }
enum ApprovalActionType { APPROVED REJECTED }

WorkflowDefinition  (tenantId, entityType) unique; name, adminOverride (default true),
                    allowSelfApproval (default true), steps[]
WorkflowStep        definitionId, stepOrder (1-based, unique per definition), name,
                    approverType, approverUserId?, approverRole?, minAmount?, minDays?
ApprovalInstance    (entityType, entityId) unique; tenantId, definitionId? (null = built-in
                    default), status, currentStepOrder, round, steps Json (snapshot),
                    adminOverride, allowSelfApproval, requesterEmployeeId?, requesterUserId?,
                    amount?, days?, completedAt?
ApprovalAction      instanceId, round, stepOrder, action, actorUserId, onBehalfOfUserId?,
                    isOverride, note?, createdAt
ApprovalDelegation  tenantId, delegatorUserId, delegateUserId, entityType? (null = all),
                    startDate, endDate (inclusive, @db.Date), reason?, isActive, createdById
PayrollRun.processedById String?   -- user who last computed the run (maker)
NotificationType += APPROVAL_REQUIRED, APPROVAL_STEP_APPROVED
```

The migration backfills one PENDING `ApprovalInstance` (built-in default snapshot)
for every row currently awaiting approval, so nothing in flight is lost.

## Built-in defaults (no `WorkflowDefinition` row)

| Entity type | Steps | adminOverride | allowSelfApproval |
|---|---|---|---|
| LEAVE, EXPENSE, COMP_OFF, REGULARIZATION | 1: REPORTING_MANAGER | true | true |
| LOAN | 1: HR_ADMIN | true | true |
| PAYROLL_RUN | 1: HR_ADMIN | true | **false** (maker-checker) |

These live in `backend/src/modules/workflow/workflow.defaults.ts` (scaffold).

## Engine rules

**Starting.** A domain calls `engine.start(...)` when a request enters its
awaiting-approval status (create for leave/comp-off/regularization/loan, submit
for expense, compute and recompute for payroll). The engine loads the tenant's
definition or the built-in default, keeps each step whose conditions hold
(`minAmount` null or `amount >= minAmount`; `minDays` null or `days >= minDays`),
renumbers the kept steps 1..n, and stores the snapshot. If no step survives,
the built-in default steps are used. Starting an entity whose instance already
exists (PENDING or terminal) restarts it: `round + 1`, `currentStepOrder = 1`,
fresh snapshot, status PENDING. Old actions stay, tagged with their round.

**Who may act on the current step** (all checks tenant-scoped, users must be active):

1. *Self-approval.* When `allowSelfApproval` is false, an actor whose
   `userId === requesterUserId` or whose `employeeId === requesterEmployeeId`
   may never act, not even through override or delegation. → 403
   `"You cannot approve a request you raised"` (payroll: `"The person who computed
   a payroll run cannot approve it"`).
   A requester who is not HR_ADMIN/SUPER_ADMIN may never act on their own
   request (whatever makes them eligible: delegation, leave cover, ROLE or
   SPECIFIC_USER); `allowSelfApproval` governs admins only.
2. *Eligible approvers* for the step:
   - REPORTING_MANAGER: the user linked to the requester employee's `managerId`.
   - MANAGERS_MANAGER: the user linked to the manager's `managerId`; if there
     is none, fall back to REPORTING_MANAGER.
   - SPECIFIC_USER: `approverUserId`.
   - HR_ADMIN: any user with role HR_ADMIN or SUPER_ADMIN.
   - ROLE: any user with role `approverRole`.
   - If the resolution yields nobody (no manager, user inactive or missing, no
     user holds the role), the step falls back to HR_ADMIN.
3. *Leave cover.* When a person-resolved approver (REPORTING_MANAGER,
   MANAGERS_MANAGER, SPECIFIC_USER) is on an APPROVED leave covering today and
   has no active delegation, that approver's own reporting manager (their user)
   is also eligible, acting on their behalf.
4. *Delegation.* An actor holding an active `ApprovalDelegation` (today within
   `startDate..endDate`, `isActive`, `entityType` null or equal) from an
   eligible approver may act; the action records `onBehalfOfUserId`.
5. *Admin override.* When `adminOverride` is true, HR_ADMIN and SUPER_ADMIN may
   act on any step; the action records `isOverride = true` unless the actor
   was already eligible.

Otherwise → 403 `"You are not an approver for the current step of this request"`.

**Acting.** `act()` runs one `$transaction`: guard-update the instance
(`where: { id, status: PENDING, currentStepOrder: N, round: R }`; zero rows →
409 `"This request was already actioned"`), insert the `ApprovalAction`, then:
- REJECT → instance REJECTED, `completedAt`, run `onFinal(tx)`.
- APPROVE on the last step → instance APPROVED, `completedAt`, run `onFinal(tx)`.
- APPROVE otherwise → `currentStepOrder + 1`, outcome ADVANCED.
If `onFinal` throws, everything rolls back. After commit (fire-and-forget,
never throws): ADVANCED notifies the next step's approvers
(`APPROVAL_REQUIRED`) and the requester (`APPROVAL_STEP_APPROVED`).
The domain sends its existing approved/rejected notifications itself.

A missing instance for an awaiting-approval entity is created lazily from the
registered handler's `getContext` before acting (belt and braces for rows the
backfill missed).

**Cancel.** Domain cancel/reset paths call `engine.cancel(...)`, which marks a
PENDING instance CANCELLED (no-op otherwise).

**Notifications on start.** `start()` without `tx` notifies step-1 approvers
itself. With `tx`, the caller calls `engine.notifyPending(tenantId, entityType,
entityId)` after its transaction commits.

## Domain integration contract

Each domain module imports `WorkflowModule` and provides a handler class
(`<domain>-workflow.handler.ts`) implementing `WorkflowEntityHandler`, which
registers itself with `WorkflowRegistry` in `onModuleInit`. The handler's
`approve` / `reject` delegate to the domain service's own approve / reject so
that there is exactly one approval code path per flow.

Domain approve methods change from "check manager, then transition" to:

```ts
// pre-checks that already exist stay (status is awaiting approval, expiry, etc.)
const result = await this.workflow.act({
  tenantId, entityType: 'LEAVE', entityId: id, actor, decision: 'APPROVE', note,
  onFinal: async (tx) => { /* today's final transaction body, using tx */ },
});
if (result.outcome === 'ADVANCED') return <entity reloaded, still pending>;
// today's post-commit side effects (notification, webhook, email) unchanged
```

The manager-scope `ForbiddenException` checks inside approve/reject are removed:
the engine authorizes. Domain "pending approvals" lists: HR_ADMIN/SUPER_ADMIN
keep seeing every awaiting row; everyone else sees
`engine.listActionableEntityIds(actor, TYPE)` (so a manager's manager sees step 2
items and delegates see delegated items). Route-level `@Roles` on domain routes
stay as they are; the unified `/approvals/...` endpoints are open to all roles.

Approve/reject service methods take the `AuthenticatedUser` (they need
`userId` for the engine and `employeeId` for the existing `approverId` column,
which is set to `actor.employeeId ?? null` on the final approval).

**Payroll maker-checker.** `processRun` and `recomputeRun` store
`processedById = user.userId` and (re)start the PAYROLL_RUN instance with
`requesterUserId = processedById`. `approveRun` goes through the engine;
`resetRun` cancels the instance. Runs with `processedById` null (legacy) are
not restricted. There is no payroll reject endpoint; `reject` on the payroll
handler returns 400 `"Payroll runs are not rejected; reset the run instead"`.

## HTTP API (WorkflowModule)

All under `JwtAuthGuard, RolesGuard`; `:entityType` is the enum value (`LEAVE`,
`PAYROLL_RUN`, …) validated with `ParseEnumPipe`.

Admin — `@Roles(SUPER_ADMIN, HR_ADMIN)`, controller `workflows`:
- `GET /workflows` → `WorkflowDefinitionView[]` for all six types.
- `GET /workflows/:entityType` → `WorkflowDefinitionView`.
- `PUT /workflows/:entityType` body `UpsertWorkflowDto` → `WorkflowDefinitionView`.
  Validation: 1–10 steps; SPECIFIC_USER needs `approverUserId` of an active user
  in the tenant; ROLE needs `approverRole`; step 1 must have no condition;
  `minAmount`/`minDays` ≥ 0. Affects new instances only.
- `DELETE /workflows/:entityType` → reset to default, returns the default view.

`WorkflowDefinitionView = { entityType, isCustom, name, adminOverride,
allowSelfApproval, steps: [{ order, name, approverType, approverUserId,
approverUserName, approverRole, minAmount, minDays }] }`.

Everyone — controller `approvals`:
- `GET /approvals/inbox` → `{ items: InboxItem[] }` where
  `InboxItem = { instanceId, entityType, entityId, title, subtitle, requesterName,
  link, submittedAt, currentStepOrder, totalSteps, currentStepName,
  onBehalfOf: { userId, name } | null }`, newest first.
- `GET /approvals/:entityType/:entityId/trail` → `ApprovalTrailView =
  { instanceId, status, round, currentStepOrder, canAct, steps: [{ order, name,
  approverType, state: 'APPROVED'|'REJECTED'|'PENDING'|'WAITING'|'CANCELLED',
  actedBy: { userId, name } | null, onBehalfOf: { userId, name } | null,
  isOverride, actedAt, note }] }`. Visible to the requester, anyone who can act,
  and HR/SUPER; otherwise 403. 404 when no instance.
- `POST /approvals/:entityType/:entityId/approve` body `{ note? }` → handler.approve.
- `POST /approvals/:entityType/:entityId/reject` body `{ note? }` → handler.reject.
- `GET /approvals/delegations` → `{ given: DelegationView[], received: DelegationView[] }`
  (HR/SUPER may pass `?all=true` to list the tenant's).
- `POST /approvals/delegations` body `{ delegateUserId, startDate, endDate,
  entityType?, reason?, delegatorUserId? }` — `delegatorUserId` only for HR/SUPER;
  cannot delegate to yourself; `endDate >= startDate`; delegate must be an
  active tenant user.
- `DELETE /approvals/delegations/:id` — delegator or HR/SUPER; sets `isActive=false`.
- `GET /approvals/users?search=` → `[{ id, name, email, role }]` (active tenant
  users, max 20; name from the linked employee, else email).

## Frontend

- `frontend/src/lib/api-workflow.ts` (+ test) — typed client for all endpoints above.
- `/approvals` — **My Approvals** inbox across types: grouped/filterable by type,
  approve/reject with an optional note, expandable approval trail, link to the
  per-flow page. Empty state.
- `/approvals/delegations` — create/cancel delegations (user search, date range,
  optional type), list given and received.
- `/admin/workflows` — builder per entity type: step list with add, remove,
  move up/down, approver type, user picker (SPECIFIC_USER), role picker (ROLE),
  min amount (EXPENSE/LOAN) and min days (LEAVE) conditions, adminOverride and
  allowSelfApproval toggles, save, reset to default. Shows "Default" vs "Custom".
- `components/approvals/ApprovalTrail.tsx` shared trail component.
- Sidebar (scaffold): Approvals group visible to all roles; "My Approvals" and
  "Delegations" for everyone; existing children keep manager+ visibility;
  Admin → "Approval Workflows".

## Out of scope

Webhooks for intermediate steps; SLA/escalation timers; workflows for change
requests, OT, separations, settlements (later waves plug into the same registry);
approval by email link.
