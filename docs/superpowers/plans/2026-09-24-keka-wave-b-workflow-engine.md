# Keka Wave B — Workflow engine: implementation plan

**Spec (binding):** `docs/superpowers/specs/2026-09-24-keka-wave-b-workflow-engine-design.md`
**Branch:** `feat/keka-wave-b`. **Scaffold commit:** `eaad819` (schema, migration,
`backend/src/modules/workflow/{workflow.types.ts, workflow.defaults.ts,
workflow-registry.service.ts, approval-engine.service.ts (stub bodies),
workflow.module.ts}`, mock-Prisma models, `app.module.ts`, Sidebar links).

## Global constraints

- Do NOT edit `backend/prisma/schema.prisma`, any migration, `prisma-mock.ts`,
  `app.module.ts`, `Sidebar.tsx`, `workflow.types.ts`, `workflow.defaults.ts`,
  `workflow-registry.service.ts`. If the contract in `workflow.types.ts` is
  genuinely insufficient, stop and report NEEDS_CONTEXT.
- Four implementers run IN PARALLEL in the same working tree. Touch only the
  files your task owns. Commit only your own paths:
  `git add <your paths> && git commit -m "..." -- <your paths>` (if
  `index.lock` exists, wait a few seconds and retry). Never `git add -A`,
  never `git stash`, never `git checkout`/`reset` other files.
- Backend specs use `createMockPrismaService()` from `backend/src/test/helpers`
  (the `src/` copy). Use UTC-noon dates in tests. Guard `AuthenticatedUser.employeeId`
  (optional) before using it in a Prisma `where`.
- Jest path args are regexes — escape parentheses: `npx jest "src/app/\(protected\)/approvals"`.
- Errors: 403 `ForbiddenException` for authorization, 400 `BadRequestException`
  for validation, 409 `ConflictException` for races, 404 for missing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run your tests and `npx tsc --noEmit` in the package you changed before
  reporting. Other workstreams' in-progress files may make tsc noisy in THEIR
  files; report but ignore errors outside your file set.

## Task 1: Engine, definitions, delegations, HTTP API (backend/src/modules/workflow/**)

**Owns:** everything under `backend/src/modules/workflow/` except the three
frozen contract files listed above. May edit `approval-engine.service.ts` and
`workflow.module.ts`. Creates e.g. `approver-resolver.service.ts`,
`workflow-definitions.service.ts`, `delegations.service.ts`,
`workflows.controller.ts`, `approvals.controller.ts`, `dto/*.ts`, and `*.spec.ts`.

Implement every method of `ApprovalEngineService` exactly per the spec section
"Engine rules": start (condition filtering, renumbering, fallback to defaults
when no step survives, restart = round + 1), notifyPending, act (single
`$transaction`, guarded `updateMany` on id+status+currentStepOrder+round → 409
`"This request was already actioned"` on zero rows, action row, terminal
`onFinal(tx)`, post-commit fire-and-forget notifications with
`NotificationType.APPROVAL_REQUIRED` to next approvers and
`APPROVAL_STEP_APPROVED` to the requester, link `/approvals`), lazy instance
creation from `registry.get(type).getContext` when missing (if that returns
null → 404 `"Request not found or not awaiting approval"`), cancel,
listActionableEntityIds, getInbox (actionable instances across types, described
via each registered handler's `describe`; types with no registered handler are
skipped), getTrail.

Authorization order exactly as the spec: self-approval block (message for
PAYROLL_RUN: `"The person who computed a payroll run cannot approve it"`, else
`"You cannot approve a request you raised"`), eligible approvers per approver
type with HR fallback, leave cover (approver on APPROVED leave covering today
with no active delegation → their manager's user also eligible, on behalf),
delegation (active, date-inclusive, entityType null or equal → on behalf),
admin override (`isOverride` true only when not otherwise eligible). 403
`"You are not an approver for the current step of this request"` otherwise.
Use the IST-agnostic date approach already used in the codebase for "today"
(compare `@db.Date` columns against today's UTC date at midnight). Keep
per-call resolution efficient: resolve once per instance, batch user lookups in
getInbox (tenants are small; loading all PENDING instances of the tenant and
filtering in memory is acceptable, cap 500).

Definitions service + `WorkflowsController` (`@Controller('workflows')`,
`@Roles(SUPER_ADMIN, HR_ADMIN)`): GET list (all six types, default view when no
row), GET one, PUT upsert (replace steps in a transaction; validation per spec),
DELETE reset. `ApprovalsController` (`@Controller('approvals')`, any role):
inbox, trail, approve, reject (both → `registry.get(type).approve/reject(user,
id, dto.note)`), delegations GET/POST/DELETE, users search. Declare static
routes (`inbox`, `delegations`, `users`) before `:entityType/...` routes.
`ParseEnumPipe(WorkflowEntityType)` on `:entityType`. DTOs with class-validator
and Swagger decorators like the rest of the codebase. Register controllers and
services in `workflow.module.ts` (keep exports `ApprovalEngineService`,
`WorkflowRegistry`).

**Tests (must exist and pass):** engine spec covering — start filtering by
minAmount/minDays and fallback; restart increments round; act: reporting manager
approves single step → APPROVED + onFinal called with tx; two-step chain →
ADVANCED then APPROVED; reject → REJECTED + onFinal; non-approver → 403;
admin override → isOverride true; self-approval blocked when
allowSelfApproval false (payroll message) and allowed when true; delegation
grants on-behalf; leave cover grants the approver's manager; no manager →
HR fallback; guarded update 0 rows → 409; onFinal throwing propagates;
lazy creation via handler. Definitions spec (validation cases, default view,
upsert, reset). Delegations spec (self-delegation rejected, date order, only
delegator/admin can cancel). Controller specs for route wiring.

## Task 2: Leave, comp-off, regularization integration

**Owns:** `backend/src/modules/leave/{leave.service.ts, leave.controller.ts,
comp-off.service.ts, comp-off.controller.ts, leave.module.ts,
leave-workflow.handler.ts, comp-off-workflow.handler.ts}` and their specs;
`backend/src/modules/attendance/{regularization.service.ts,
regularization.controller.ts, attendance.module.ts,
regularization-workflow.handler.ts}` and their specs. Any other file in those
modules only if a signature change forces it (list it in the report).

Per the spec's "Domain integration contract", for LEAVE, COMP_OFF,
REGULARIZATION:
- Start: on create, call `engine.start({ tenantId, entityType, entityId,
  context })` with requesterEmployeeId = request employee, requesterUserId =
  creating user's id when the creator is that employee (else the employee's
  linked user id, else null), days = `totalDays` (leave) / `earnedDays`
  (comp-off) / null (regularization). If creation happens in a transaction,
  pass `tx` and call `notifyPending` after commit.
- Approve / reject: change service signatures to take `actor:
  AuthenticatedUser` (plus id, note); remove the manager-scope Forbidden
  checks; call `engine.act` with the existing final transaction body moved into
  `onFinal(tx)`; on ADVANCED return the reloaded entity (still pending) without
  the domain's approved notification/webhook/email; on terminal outcomes keep
  today's post-commit side effects unchanged. Existing status/expiry
  pre-checks stay before `act`. `approverId` = `actor.employeeId ?? null`.
- Cancel (leave `cancelRequest`, and any comp-off/regularization cancel if it
  exists): call `engine.cancel` for PENDING requests.
- Pending lists: HR_ADMIN/SUPER_ADMIN unchanged (all awaiting); other roles use
  `engine.listActionableEntityIds(actor, TYPE)` → `where: { id: { in: ids } }`.
- Bulk approve/reject endpoints (if any) loop through the same path.
- Handlers: `@Injectable() class LeaveWorkflowHandler implements
  WorkflowEntityHandler, OnModuleInit` (entityType LEAVE) registering with
  `WorkflowRegistry`; getContext returns null unless status is PENDING;
  describe returns title/subtitle/requesterName (`firstName lastName`)/link
  (`/approvals/leave`, `/approvals/comp-off`, `/approvals/regularization`)/
  submittedAt; approve/reject call the service. Modules import `WorkflowModule`
  and provide the handlers.
- Update existing specs for the new signatures and add: approve ADVANCED leaves
  status PENDING and sends no approved notification; approve APPROVED runs the
  balance/attendance writes inside onFinal; handler getContext/describe tests.
  Mock `ApprovalEngineService` (jest object with the methods) — do not depend
  on Task 1's implementation.

## Task 3: Expenses, loans, payroll maker-checker integration

**Owns:** `backend/src/modules/expenses/{expenses.service.ts,
expenses.controller.ts, expenses.module.ts, expense-workflow.handler.ts}` +
specs; `backend/src/modules/loans/{loans.service.ts, loans.controller.ts,
loans.module.ts, loan-workflow.handler.ts}` + specs;
`backend/src/modules/payroll/{payroll.service.ts, payroll.controller.ts,
payroll.module.ts, payroll-workflow.handler.ts}` + `payroll.service.spec.ts`,
`payroll.controller.spec.ts`, `payroll-approve.spec.ts`. Other files only if a
signature change forces it (list them).

Same contract as Task 2 for EXPENSE (start on `submitClaim`, amount =
`amount`; approve/reject via engine; pending list via engine for non-admins;
link `/approvals/expenses`) and LOAN (start on create, amount = `principal`;
cancel → engine.cancel; `findAll` manager scope keeps working for viewing but
approve/reject authorization comes from the engine; link `/approvals/loans`).
Loans module is imported by ExitModule and PayrollModule — importing
WorkflowModule must not create a cycle (WorkflowModule imports no domain module).

PAYROLL_RUN: `processRun` and `recomputeRun` take the acting user id and set
`processedById`; after the run reaches COMPUTED, (re)start the instance with
`requesterUserId = processedById`, `amount = totalNet`, requesterEmployeeId
null. `approveRun(tenantId, id, actor)` goes through `engine.act`; the existing
status-guarded COMPUTED→APPROVED update moves into `onFinal(tx)` (keep the 409
on concurrent approval); `afterApproval` stays post-commit. `resetRun` →
`engine.cancel`. Payroll handler: getContext null unless COMPUTED; describe
title `Payroll ${Month} ${year}`, subtitle `₹<totalNet> net · <processedCount>
employees`, link `/payroll`; `reject` throws 400 `"Payroll runs are not
rejected; reset the run instead"`. Controller passes `@CurrentUser()` through.

Tests: update existing specs for new signatures; add maker-checker spec (the
engine mock rejecting with 403 propagates; processedById is written by process
and recompute; approve calls act with PAYROLL_RUN), expense ADVANCED vs
APPROVED, loan approve via engine, handler tests. Mock `ApprovalEngineService`.

## Task 4: Frontend (inbox, delegations, workflow builder)

**Owns:** `frontend/src/lib/api-workflow.ts` (+ `api-workflow.test.ts`),
`frontend/src/app/(protected)/approvals/page.tsx` (+ test),
`frontend/src/app/(protected)/approvals/delegations/page.tsx` (+ test),
`frontend/src/app/(protected)/admin/workflows/page.tsx` (+ test),
`frontend/src/components/approvals/*` (ApprovalTrail + any sub-components, + tests).

Build exactly the spec's "Frontend" section against the spec's HTTP API
(types mirror `backend/src/modules/workflow/workflow.types.ts`; read it). Follow
the existing page conventions: look at `frontend/src/app/(protected)/approvals/leave/page.tsx`
and `frontend/src/app/(protected)/admin/attendance-policy/page.tsx` plus
`frontend/src/lib/api-loans.ts` / `api-loans` tests for the client pattern
(shared axios instance from `api.ts`, `.data` unwrapping), toasts via
react-hot-toast, existing UI components. The admin page must be gated to
SUPER_ADMIN/HR_ADMIN the way other admin pages are (admin layout). Inbox:
filter chips per entity type with counts, approve/reject with an optional note
dialog, expandable ApprovalTrail (lazy-loaded), "on behalf of X" badge, link to
the per-flow page, empty and loading states, refresh after action. Builder:
select entity type (six tabs), Default/Custom badge, step editor (add, remove,
move up/down, name, approver type, user search picker via
`/approvals/users?search=` for SPECIFIC_USER, role select for ROLE, minAmount
shown for EXPENSE/LOAN/PAYROLL_RUN, minDays for LEAVE/COMP_OFF, step 1 has no
condition inputs), toggles, Save (PUT), Reset to default (DELETE, confirm).
Delegations page: form (user search, start/end date, optional type, reason),
lists "I delegated" (cancel button) and "Delegated to me".

Tests: api client URL/method/payload tests for every function; page tests for
inbox render + approve flow, builder add-step + save payload, delegation create.
Run `npx jest` on your paths and `npx tsc --noEmit` and `npm run lint` if it exists.
