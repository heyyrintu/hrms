# Keka Wave F — Performance depth

**Date:** 2026-10-03
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave F)
**Baseline:** `main` at `a1728a5` (Wave E follow-ups merged). Branch `feat/keka-wave-f`.
**Format reference:** `docs/superpowers/specs/2026-09-28-keka-wave-e-design.md`
**Neighbours:** Waves G (attendance, shifts, projects) and I (assets, exit,
travel, policies, LMS) are built in parallel. This wave touches none of their
modules.

## Goal

Deepen performance management: key results under goals, company and
department goals with alignment and progress roll-up, review templates and a
question bank, 360 peer feedback, a competency framework per designation,
calibration with an audited HR override, and a 9-box grid. Goal completions
post to the Wave E feed.

With no new configuration, existing behaviour is unchanged except one
deliberate change: employees no longer see their rating until HR completes
the cycle (F4).

## Product decisions (user, 2026-10-01)

| Question | Decision |
|---|---|
| Goal ownership | `COMPANY`, `DEPARTMENT` and `EMPLOYEE` goals. Company and department goals live outside reviews; employee goals may link to a review. Any goal can align to a parent. Existing goals become `EMPLOYEE` goals and keep their review. |
| Progress roll-up | Key results drive their goal. A goal with no KRs but aligned children takes its children's weighted average. A goal with neither is set by hand. |
| Rating release | The employee sees no rating until HR completes the cycle. Ratings lock at completion. |
| 360 anonymity | Manager and HR see peer names. The employee sees peer answers without names, only with 3+ submissions, only after release. |
| Competency raters | Manager only. Informational; does not compute the overall rating. |
| Calibration and 9-box visibility | HR/SUPER see everything and are the only ones who override. Managers see their own reviewees read-only. Employees never see potential or the 9-box. |
| What the manager sees after an override | Their original rating, the calibrated rating and HR's reason. The employee sees only the final rating. Every override is audited. |
| Feed posts | Company and department goal completions post automatically; an employee goal posts only if its owner ticked "share on feed". |

## Conventions (all workstreams)

- Every new model has `tenantId`; every query is scoped by it. Every
  non-id `@@unique` includes `tenantId` or a tenant-scoped parent id.
- Errors: 400 validation or wrong state, 403 role/authorization, 404 missing
  (also other tenants' ids and rows the caller may not see), 409 duplicates
  and races.
- Controllers: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`. No
  `@RequirePermissions` this wave (services branch on `user.role`; see the H1
  rule in memory). "All roles" = `SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE`.
- `AuthenticatedUser.employeeId` is optional. Every employee-facing route
  throws 400 `'No employee profile linked to your account'` (the existing
  performance message) before any Prisma `where` uses it. An undefined id in
  a `where` matches every row.
- "Admin" means `HR_ADMIN` or `SUPER_ADMIN`.
- Notifications: `NotificationsService.notifyEmployee`, fire-and-forget after
  the transaction commits, `.catch` logs, never throws.
- Backend code lives under `backend/src/modules/performance/` in sub-folders
  `goals/`, `templates/`, `competencies/`, `peer-reviews/`, `calibration/`, each
  with its own service, controller, DTOs and specs, all registered in the one
  `PerformanceModule`. Route prefix stays `/performance`. `app.module.ts` does
  not change.
- Frontend API calls live in new files
  `frontend/src/lib/api-performance-{goals,reviews,templates,competencies,peer,calibration}.ts`,
  each exporting its API object and response types. The shared API client is
  not edited.
- Ratings are integers 1–5; potential is an integer 1–3.

---

## F1. Goals, key results, alignment and roll-up

### Data model

```prisma
enum GoalOwnerType { COMPANY DEPARTMENT EMPLOYEE }
enum KeyResultMetricType { NUMBER PERCENT CURRENCY BOOLEAN }

model Goal {                       // existing, extended
  // existing: id, tenantId, title, description, targetDate, status, progress, weight, timestamps
  reviewId        String?          // was required
  employeeId      String?          // was required; required iff ownerType = EMPLOYEE
  ownerType       GoalOwnerType @default(EMPLOYEE)
  departmentId    String?          // required iff ownerType = DEPARTMENT
  parentGoalId    String?
  shareOnFeed     Boolean   @default(false)
  completedAt     DateTime?
  createdByUserId String?          // plain id, no FK

  review     PerformanceReview? @relation(..., onDelete: Restrict)
  employee   Employee?
  department Department?
  parent     Goal?  @relation("GoalAlignment", fields: [parentGoalId], references: [id], onDelete: Restrict)
  children   Goal[] @relation("GoalAlignment")
  keyResults KeyResult[]
  @@index([tenantId, ownerType])
  @@index([parentGoalId])
  @@index([departmentId])
}

model KeyResult {
  id           String @id @default(uuid())
  tenantId     String
  goalId       String
  title        String
  metricType   KeyResultMetricType @default(NUMBER)
  startValue   Decimal @default(0) @db.Decimal(14, 2)
  targetValue  Decimal @db.Decimal(14, 2)
  currentValue Decimal @default(0) @db.Decimal(14, 2)
  unit         String?
  weight       Decimal @default(1.0) @db.Decimal(3, 2)
  progress     Int     @default(0)
  sortOrder    Int     @default(0)
  timestamps
  goal Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  @@index([tenantId]) @@index([goalId])
  @@map("key_results")
}
```

The migration keeps every existing goal: `ownerType` defaults to `EMPLOYEE`,
`employeeId` and `reviewId` stay populated. A goal already `COMPLETED` gets
`completedAt = updatedAt` in the migration (no feed posts for old goals).

### Rules

**Who can do what**
- `COMPANY` and `DEPARTMENT` goals: admins create, edit and delete. Every
  employee in the tenant can read them.
- `EMPLOYEE` goals: the owner creates, edits and deletes their own. The
  owner's current manager (`employee.managerId`) and admins can read them.
  Nobody else can (404).
- `reviewId` is optional. When set, it must be the owner's own review and that
  review must not be `COMPLETED`. A goal linked to a `COMPLETED` review is
  locked: update, delete, KR changes and re-aligning return 400 (existing
  rule, extended to KRs).
- `ownerType` cannot change after creation.

**Alignment (`parentGoalId`)**
- `EMPLOYEE` goal → a company goal, a department goal, or a goal owned by the
  owner's manager.
- `DEPARTMENT` goal → a company goal or another department goal.
- `COMPANY` goal → another company goal.
- Parent must be in the same tenant and visible to the caller (else 404).
  Cycles are refused (400) by walking up the parent chain from the proposed
  parent; the walk also stops at depth 20 and refuses deeper chains.
- Deleting a goal with children returns 400 `'Re-align or delete the child
  goals first'`. Deleting a goal deletes its key results.

**Key result progress** (`computeKrProgress`, a pure function)
- `BOOLEAN`: `currentValue >= 1` → 100, else 0. `startValue`/`targetValue`
  are forced to 0/1.
- Others: `round((current − start) / (target − start) × 100)`, clamped 0–100.
  Works for decreasing targets. `target == start` → 400.
- `weight` 0.01–9.99, same as `Goal.weight`.

**Roll-up** (`GoalProgressService.recompute(goalId, tx)`)
- A goal with KRs: progress = KR progress weighted by KR weight.
- A goal with no KRs but children: progress = children's progress weighted by
  each child's `weight`.
- A goal with neither keeps manual progress.
- On a derived goal (KRs or children), `progress` in an update → 400, and
  `status` is derived: 0 `NOT_STARTED`, 1–99 `IN_PROGRESS`, 100 `COMPLETED`.
  `status` in an update of a derived goal → 400.
- On a manual goal, setting status `COMPLETED` sets progress 100; setting
  progress 100 does not change status (existing behaviour).
- Every change that can move progress (KR create/update/delete, goal
  progress/status/weight change, goal create/delete, re-align) recomputes in
  the same transaction, then recomputes each ancestor up the chain (old and
  new parent on re-align).
- `completedAt` is stamped when status becomes `COMPLETED` and cleared when it
  leaves.

**Feed**
- When a goal's status becomes `COMPLETED` (including ancestors completed by
  roll-up), in the same transaction, post via `FeedService.post(input, tx)`
  if `ownerType` is `COMPANY`/`DEPARTMENT`, or `EMPLOYEE` with `shareOnFeed`.
- Input: `type 'GOAL_COMPLETED'`, `sourceType 'Goal'`, `sourceId goal.id`,
  `subjectEmployeeId` the owner (employee goals) else null,
  `actorEmployeeId` null, `title` = goal title,
  `payload { ownerType, departmentName? }`,
  `dedupeKey 'goal-completed:<goalId>'` (a reopened and re-completed goal does
  not post again).
- Wave E changes: add `'GOAL_COMPLETED'` to `FEED_ITEM_TYPES`, `GOAL: 'Goal'`
  to `FEED_SOURCE`, and a render case in `FeedItemCard.tsx`.

### API (`/performance`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `goals?scope=mine\|team\|company\|department&departmentId=` | all | `team` = goals of the caller's direct reports (managers; admins get all employee goals) |
| GET | `goals/tree?rootId=` | all | company→department→employee tree, filtered to what the caller may see; `rootId` limits to one subtree |
| GET | `goals/:id` | all | goal + KRs + parent + direct children (visible ones) |
| POST | `goals` | all | admins for COMPANY/DEPARTMENT |
| PUT | `goals/:id` | all | |
| DELETE | `goals/:id` | all | |
| POST | `goals/:id/key-results` | goal writer | |
| PUT | `goals/:id/key-results/:krId` | goal writer | |
| DELETE | `goals/:id/key-results/:krId` | goal writer | |

The existing `GET my-goals`, `POST goals`, `PUT goals/:id`, `DELETE goals/:id`
keep their request and response shapes (new fields are additive; `ownerType`
defaults to `EMPLOYEE`, `reviewId` becomes optional). The existing goal
handlers move from `performance.service.ts` into `goals/goals.service.ts`;
`performance.controller.ts` drops them and `goals.controller.ts` serves the
same paths.

"Goal writer": admins for company/department goals; the owner for employee
goals. Admins may read but not edit another employee's goal or its KRs.

### Frontend

- `/performance/goals`: alignment tree (expand/collapse) with progress bars,
  KR lists, owner chips. Admins get "New company goal" / "New department
  goal". Everyone gets "New goal" (employee), with parent picker, review
  link, weight, share-on-feed toggle, and a KR editor.
- `/performance` (my performance): the goals list shows KRs, alignment and
  the share toggle; derived goals show progress read-only.
- `FeedItemCard.tsx`: `GOAL_COMPLETED` card ("<name> completed a goal: <title>"
  or "Company goal completed: <title>").

---

## F2. Question bank and review templates

### Data model

```prisma
enum ReviewQuestionType { RATING TEXT }
enum ReviewAudience { SELF MANAGER PEER }

model ReviewQuestion {
  id, tenantId, text String, type ReviewQuestionType, category String?,
  isActive Boolean @default(true), timestamps
  @@index([tenantId]) @@map("review_questions")
}

model ReviewTemplate {
  id, tenantId, name String, description String?, isActive Boolean @default(true), timestamps
  questions ReviewTemplateQuestion[]
  @@unique([tenantId, name]) @@map("review_templates")
}

model ReviewTemplateQuestion {
  id, tenantId, templateId, questionId, audience ReviewAudience,
  isRequired Boolean @default(true), sortOrder Int @default(0)
  template ReviewTemplate @relation(onDelete: Cascade)
  question ReviewQuestion @relation(onDelete: Restrict)
  @@unique([templateId, questionId, audience]) @@map("review_template_questions")
}

model ReviewCycle {                 // existing, extended
  templateId          String?      // onDelete: SetNull
  peerFeedbackEnabled Boolean @default(false)
  maxPeers            Int     @default(5)
}

/// Snapshot of the template, taken at launch.
model ReviewCycleQuestion {
  id, tenantId, cycleId, questionId String?  // plain id, no FK
  text String, type ReviewQuestionType, audience ReviewAudience,
  isRequired Boolean, sortOrder Int
  cycle ReviewCycle @relation(onDelete: Cascade)
  @@index([cycleId]) @@map("review_cycle_questions")
}

/// Self and manager answers.
model ReviewAnswer {
  id, tenantId, reviewId, cycleQuestionId, audience ReviewAudience,
  rating Int?, text String? @db.Text, timestamps
  @@unique([reviewId, cycleQuestionId]) @@map("review_answers")
}
```

### Rules

- Bank and templates are admin-only (read and write).
- A question used by any template can be deactivated but not deleted (400).
  An inactive question cannot be added to a template.
- A template entry's `audience` is per entry; the same question may appear
  once per audience.
- A cycle's `templateId`, `peerFeedbackEnabled` and `maxPeers` (1–10) can be
  set only while the cycle is `DRAFT` (existing edit rule). The template must
  be active.
- Launch copies the template's entries (with active questions only) into
  `ReviewCycleQuestion`, in the launch transaction. A cycle without a template
  gets no questions and behaves as today.
- Self-review submit accepts `answers[]` (`cycleQuestionId`, `rating` or
  `text`). Every required `SELF` question must be answered; answers to non-SELF
  or other cycles' questions → 400. `RATING` answers 1–5, `TEXT` 1–5000
  chars.
- Manager-review submit does the same for `MANAGER` questions.
- The existing `selfRating`, `managerRating`, `overallRating` fields are
  unchanged and still required as today.

### API

| Method | Path | Roles |
|---|---|---|
| GET/POST | `questions` | admin |
| PUT/DELETE | `questions/:id` | admin |
| GET/POST | `templates` | admin |
| GET/PUT/DELETE | `templates/:id` | admin (PUT replaces the entry list; DELETE refused while any DRAFT cycle uses it → 400) |
| GET | `reviews/:id/questions` | anyone who may view the review; filtered by audience the viewer may see |

### Frontend

- `/performance/templates`: two tabs, Question bank and Templates. Template
  editor with an ordered entry list (question, audience, required).
- `/performance/cycles`: template select, peer feedback toggle, max peers.
- Self-review and manager-review forms render the cycle's questions.

---

## F3. Competency framework

### Data model

```prisma
model Competency {
  id, tenantId, name String, description String?, category String?,
  isActive Boolean @default(true), timestamps
  @@unique([tenantId, name]) @@map("competencies")
}

model DesignationCompetency {
  id, tenantId, designationId, competencyId, expectedLevel Int  // 1–5
  @@unique([designationId, competencyId]) @@map("designation_competencies")
}

/// Snapshot per review, taken at launch.
model ReviewCompetencyRating {
  id, tenantId, reviewId, competencyId String?  // plain id
  name String, expectedLevel Int,
  managerRating Int?, comment String? @db.Text, timestamps
  review PerformanceReview @relation(onDelete: Cascade)
  @@index([reviewId]) @@map("review_competency_ratings")
}
```

### Rules

- Library and designation mapping are admin-only. A competency mapped to any
  designation can be deactivated but not deleted (400). Inactive competencies
  are not snapshotted.
- At launch, each review gets one row per active competency mapped to the
  employee's designation at that moment. No designation → no rows.
- Manager-review submit accepts `competencyRatings[]` (`id`, `rating` 1–5,
  `comment?`). Every row of the review must be rated (400 otherwise).
- Informational only: no effect on `overallRating`.
- Visibility: reviewer and admins always; the employee after release (F4).

### API

| Method | Path | Roles |
|---|---|---|
| GET/POST | `competencies` | admin |
| PUT/DELETE | `competencies/:id` | admin |
| GET | `designations/:id/competencies` | admin |
| PUT | `designations/:id/competencies` | admin (replaces the list `{competencyId, expectedLevel}[]`) |

### Frontend

- `/performance/competencies`: library table + designation mapping editor.
- Manager review form: one row per competency (name, expected level, rating,
  comment).

---

## F4. Review flow changes and rating release

### Data model

```prisma
model PerformanceReview {          // existing, extended
  potentialRating   Int?          // 1–3
  calibratedRating  Int?
  calibrationReason String? @db.Text
  calibratedById    String?       // user id, plain
  calibratedAt      DateTime?
}
```

`finalRating = calibratedRating ?? overallRating` (computed, not stored).

### Launch

In one transaction: set the cycle `ACTIVE`, snapshot questions (F2), create
reviews with `createManyAndReturn`, create competency rows (F3). Notifications
as today.

### Visibility (`review-visibility.ts`)

A single mapper `toReviewView(review, viewer)` shapes every review response
(`my-reviews`, `reviews/:id`, `team-reviews`, the submit responses). The
viewer's relation to the review is decided in this order:

1. **SELF** — `viewer.employeeId === review.employeeId`. Self-view always
   wins, even for admins.
2. **REVIEWER** — `viewer.employeeId === review.reviewerId`.
3. **ADMIN** — admin role.
4. Otherwise 404 (was 403; no existence leak).

| Field | SELF before release | SELF after release | REVIEWER | ADMIN |
|---|---|---|---|---|
| self rating, comments, self answers, goals | ✓ | ✓ | ✓ | ✓ |
| `managerComments`, manager answers, competency ratings | – | ✓ | ✓ | ✓ |
| `finalRating` | – | ✓ | ✓ | ✓ |
| `managerRating`, `overallRating` | – | – | ✓ | ✓ |
| `calibratedRating`, `calibrationReason`, `calibratedAt` | – | – | ✓ | ✓ |
| `potentialRating` | – | – | ✓ | ✓ |
| peer feedback | – | anonymous, if ≥3 submitted | named | named |

"Release" = the review's cycle is `COMPLETED`. Fields marked – are omitted
from the response, not nulled.

### Other changes

- Manager-review submit also accepts `potentialRating?` (1–3), `answers[]`
  and `competencyRatings[]`. Its notification to the employee drops the
  rating ("Your manager has completed your review. Results are released when
  the cycle closes.").
- `PUT reviews/:id/potential { potentialRating }`: the reviewer or an admin,
  while the cycle is `ACTIVE`; not on one's own review (403).
- `completeCycle`: in addition to today, notifies each employee whose review
  is `COMPLETED` (`REVIEW_RESULTS_RELEASED`, link `/performance`). After
  completion every write on the cycle's reviews (answers, potential,
  calibration, peer actions, goals linked to completed reviews) returns 400.
- New `NotificationType` values: `REVIEW_RESULTS_RELEASED`,
  `PEER_NOMINATION_PENDING`, `PEER_FEEDBACK_REQUESTED`, `REVIEW_CALIBRATED`.

---

## F5. 360 peer feedback

### Data model

```prisma
enum PeerReviewStatus { NOMINATED APPROVED REJECTED SUBMITTED DECLINED }

model PeerReview {
  id, tenantId, reviewId, peerEmployeeId, nominatedByEmployeeId String?,
  status PeerReviewStatus @default(NOMINATED),
  decidedAt DateTime?, decidedByUserId String?,
  submittedAt DateTime?, overallComment String? @db.Text, timestamps
  review PerformanceReview @relation(onDelete: Cascade)
  peer   Employee @relation("PeerReviewPeer")
  answers PeerReviewAnswer[]
  @@unique([reviewId, peerEmployeeId])
  @@index([tenantId, peerEmployeeId, status])
  @@map("peer_reviews")
}

model PeerReviewAnswer {
  id, tenantId, peerReviewId, cycleQuestionId, rating Int?, text String? @db.Text
  peerReview PeerReview @relation(onDelete: Cascade)
  @@unique([peerReviewId, cycleQuestionId]) @@map("peer_review_answers")
}
```

### Rules

- Only when the review's cycle has `peerFeedbackEnabled` and is `ACTIVE`
  (else 400).
- **Nominate** (the employee, on their own review): while the review is
  `PENDING` or `SELF_REVIEW`. Peer must be an `ACTIVE` employee of the tenant,
  not the employee, not the reviewer (400). Count of non-`REJECTED` rows ≤
  `maxPeers` (400). Duplicate peer → 409. A previously `REJECTED` peer cannot
  be re-nominated (409). Notifies the reviewer (`PEER_NOMINATION_PENDING`).
  The employee may withdraw a `NOMINATED` row (DELETE).
- **Decide** (reviewer or admin): `NOMINATED` → `APPROVED` or `REJECTED`.
  Approval notifies the peer (`PEER_FEEDBACK_REQUESTED`).
- **Add directly** (reviewer or admin): creates an `APPROVED` row, same
  checks and cap; notifies the peer.
- **Respond** (the peer): `APPROVED` → `SUBMITTED` with `answers[]` (every
  required `PEER` question; same validation as F2) and `overallComment`
  (1–5000, required), or → `DECLINED`.
- **Close**: peer actions are refused (400) once the review is `COMPLETED`.
  Open `APPROVED` rows are reported as `closed: true` (derived, no status
  change).

### Visibility

- Reviewer and admins: every row with peer name, status, answers, comment.
- The employee (own review): the nominations list with peer name and status
  mapped to `NOMINATED | APPROVED | REJECTED` (both `SUBMITTED` and `DECLINED`
  shown as `APPROVED`). After release, if `SUBMITTED` count ≥ 3:
  `peerFeedback: { submittedCount, questions: [{ text, type, ratings: number[] (shuffled), texts: string[] (shuffled) }], comments: string[] (shuffled) }`
  — no ids, names or timestamps. Below 3: `peerFeedback: null` with
  `peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES'`.
- The peer: their own requests (reviewee name, cycle name, status, closed,
  `PEER` questions, their own answers). Nothing else about the review.

### API

| Method | Path | Roles |
|---|---|---|
| GET | `reviews/:id/peers` | employee, reviewer, admin (shaped per above) |
| POST | `reviews/:id/peers` | employee (nominate) / reviewer, admin (add approved) |
| DELETE | `reviews/:id/peers/:peerReviewId` | employee, while `NOMINATED` |
| POST | `reviews/:id/peers/:peerReviewId/decision` `{ approve: boolean }` | reviewer, admin |
| GET | `peer-requests` | all (the caller's requests as peer) |
| GET | `peer-requests/:id` | the peer |
| POST | `peer-requests/:id/submit` | the peer |
| POST | `peer-requests/:id/decline` | the peer |

### Frontend

- `/performance` review panel: "Peers" section to nominate/withdraw; after
  release, the anonymous peer feedback block.
- `/performance/team`: pending nominations with approve/reject, add peer,
  named peer feedback.
- `/performance/feedback-requests`: the peer's inbox and response form.

---

## F6. Calibration

### Rules

- `POST reviews/:id/calibrate { rating: 1–5 | null, reason }` — admin only.
  `reason` 10–1000 chars. Review must be `COMPLETED`, cycle `ACTIVE` (400).
  Own review → 403. `null` reverts the override. Every call (set, revise,
  revert) writes an `AuditLog` row in the same transaction via
  `AuditService.log(..., tx)`: `action UPDATE`,
  `entityType 'PerformanceReviewCalibration'`, `entityId review.id`,
  `oldValues { calibratedRating, calibrationReason }`,
  `newValues { calibratedRating, calibrationReason }`, `userId` the caller.
  Notifies the reviewer (`REVIEW_CALIBRATED`).
- `GET calibration?cycleId=&departmentId=&managerId=` — admins (any scope);
  managers get only reviews where they are the reviewer (filters applied
  within that). Response:

```ts
{
  cycle: { id, name, status },
  overall: Distribution,
  byDepartment: Array<{ departmentId: string | null; departmentName: string; distribution: Distribution }>,
  byManager: Array<{ reviewerId: string; reviewerName: string; distribution: Distribution }>,
  reviews: Array<{ reviewId, employeeId, employeeName, employeeCode, departmentName,
                   reviewerName, status, managerRating, overallRating,
                   calibratedRating, calibrationReason, finalRating, potentialRating }>,
}
type Distribution = { '1': number; '2': number; '3': number; '4': number; '5': number; unrated: number; total: number };
```

  Department is the employee's current department at query time.
  `unrated` = reviews with no `finalRating`.

### Frontend

- `/performance/calibration`: cycle picker, department/manager filters,
  distribution bar charts (overall, by department, by manager), review table.
  Admins get an "Override" dialog (rating, reason, revert). Managers see the
  page read-only.

---

## F7. 9-box

### Rules

- Performance band from `finalRating`: 1–2 `LOW`, 3 `MEDIUM`, 4–5 `HIGH`.
  Potential band from `potentialRating`: 1 `LOW`, 2 `MEDIUM`, 3 `HIGH`.
- `GET nine-box?cycleId=&departmentId=` — admins: all reviews of the cycle;
  managers: their reviewees. Employees: 403.
- Response: `{ cells: Array<{ performance, potential, employees: Array<{ reviewId, employeeId, name, designation, departmentName, finalRating, potentialRating }> }>`
  (always 9 cells), `missing: Array<{ reviewId, employeeId, name, missingRating: boolean, missingPotential: boolean }> }`.

### Frontend

- `/performance/nine-box`: 3×3 grid (potential on y, performance on x) with
  employee chips per cell and a "Not placed" list. Admins and managers.

---

## Shared changes

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | Wave F block: new enums and models; additive fields on `Goal`, `ReviewCycle`, `PerformanceReview`, `Department`/`Designation`/`Employee` back-relations; 4 `NotificationType` values |
| `backend/prisma/migrations/<ts>_keka_wave_f/migration.sql` | generated with `migrate diff`, plus the `completedAt` backfill |
| `backend/src/test/helpers/prisma-mock.ts` | add the 11 new models to `prismaModels` in one block |
| `backend/src/modules/performance/performance.module.ts` | register sub-folder providers/controllers; import `FeedModule` |
| `backend/src/modules/engagement/feed/feed.types.ts` | `GOAL_COMPLETED`, `GOAL` source |
| `frontend/src/components/layout/Sidebar.tsx` | one block: Goals, Feedback requests (all); Calibration, 9-box (admins, managers); Templates, Competencies (admins) |
| `frontend/src/components/engagement/feed/FeedItemCard.tsx` | `GOAL_COMPLETED` case |

## Testing

- Backend unit specs per service and controller with `createMockPrismaService()`
  (`backend/src/test/helpers`). Key cases:
  - `computeKrProgress`: increasing, decreasing, boolean, clamp, start==target.
  - Roll-up: KRs over children; children only; manual; ancestor chain;
    re-align recomputes old and new parent; derived goal rejects manual
    progress/status; completedAt stamping.
  - Alignment: allowed/refused parent types, manager's goal only, cycle,
    cross-tenant parent 404.
  - Feed: posts for company goal, for shared employee goal, not for unshared;
    posts for an ancestor completed by roll-up; uses `tx`.
  - Visibility mapper: full matrix above, admin self-view, 404 for strangers.
  - Peer: cap, self/reviewer refused, duplicate 409, decline/submit, closed
    after manager submit, anonymous block threshold 3, status masking.
  - Calibration: own review 403, wrong state 400, audit row in `tx`, revert,
    manager scoping, distribution counts.
  - 9-box band mapping and `missing`.
  - Launch snapshots: questions, competencies (no designation → none).
- Frontend page tests for each new page and the changed pages, with mock
  users in the real shape `{ role, employee: { id } }`.
- One module-wiring spec for `PerformanceModule` that overrides
  `PrismaService` (CI has no `DATABASE_URL`).

## Out of scope

- Custom-role permissions for performance routes.
- DB-level anonymity for peer answers (rows are named by design).
- Check-ins, OKR scoring/grades, goal periods/quarters.
- Peers rating competencies; competencies feeding the overall rating.
- Calibration sessions/meetings and forced distributions.
