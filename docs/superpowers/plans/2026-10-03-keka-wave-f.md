# Keka Wave F (Performance depth) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key results, company/department goals with alignment and progress
roll-up, review templates and a question bank, 360 peer feedback, a
competency framework, calibration with an audited override, a 9-box grid,
held ratings until cycle completion, and goal completions on the Wave E feed.

**Architecture:** Everything stays in one `PerformanceModule`
(`backend/src/modules/performance/`), split into sub-folders `goals/`,
`calibration/`, `competencies/`, `templates/`, `peer-reviews/`, each with its
own service, controller, DTOs and specs under the `/performance` prefix. A
scaffold commit freezes the schema, migration, module wiring, shell classes,
shared rating helpers, the frontend API client files and the sidebar; four
implementers (two backend, two frontend) then build disjoint file sets in
parallel.

**Tech Stack:** NestJS 11, Prisma 6.19 (PostgreSQL), class-validator, Jest;
Next.js 16 / React 19, axios, react-hot-toast, recharts, Testing Library.

**Spec (binding):** `docs/superpowers/specs/2026-10-03-keka-wave-f-design.md`
**Branch / worktree:** `feat/keka-wave-f` at
`C:\Users\RintuMondal\Videos\projects\hrms\.claude\worktrees\wave-f`.

## Global Constraints

- **Never** run `prisma migrate dev|reset|deploy` or `db push` — the database
  is a shared remote server. Migration SQL comes only from
  `npx prisma migrate diff --from-schema-datamodel <base.prisma> --to-schema-datamodel prisma/schema.prisma --script`.
- **Neighbour waves:** Waves G (attendance, shifts, projects) and I (assets,
  exit, travel, policies, LMS) run in parallel on other branches. Do not touch
  their modules, `modules/auth/**`, guards or `jwt-payload.type.ts`.
- **Frozen after the scaffold (Task 0) — implementers do not edit:**
  `backend/prisma/**`, `backend/src/app.module.ts`,
  `backend/src/test/helpers/prisma-mock.ts`,
  `backend/src/modules/performance/performance.module.ts` (+ its spec),
  `backend/src/modules/performance/performance-rating.ts` (+ spec),
  `backend/src/modules/engagement/feed/feed.types.ts`,
  `frontend/src/lib/api-performance-*.ts`, `frontend/src/lib/api-feed.ts`,
  `frontend/src/components/layout/Sidebar.tsx`. If a frozen contract is
  insufficient, stop and report NEEDS_CONTEXT with the exact change wanted.
- Shared files get one contiguous added block; never reorder, rename or
  reformat existing lines.
- Implementers run in parallel in the same worktree. Commit only your own
  paths: `git add <paths> && git commit -m "..." -- <paths>` (retry after a
  few seconds on `index.lock`). Never `git add -A`, `git stash`,
  `git checkout`/`git reset` of other files. Do not push.
- TDD: failing spec first. Backend specs use `createMockPrismaService()` from
  `backend/src/test/helpers` (the `src/` copy). `$transaction` in the mock
  runs the callback with the mock itself. UTC-noon dates in tests
  (`new Date('2026-03-15T12:00:00Z')`).
- `AuthenticatedUser.employeeId` is optional; employee-facing routes throw
  `BadRequestException('No employee profile linked to your account')` before
  any `where` uses it.
- Errors: 400 validation/state, 403 role/authorization, 404 missing or not
  visible, 409 duplicates/races. Every query scoped by `tenantId`.
- Controllers: `@ApiTags('performance')`, `@ApiBearerAuth()`,
  `@Controller('performance')`, `@UseGuards(JwtAuthGuard, RolesGuard)`,
  `@Roles(...)` per route. No `@RequirePermissions`. Admin =
  `UserRole.HR_ADMIN | UserRole.SUPER_ADMIN` (use `isAdminRole` from
  `performance-rating.ts`).
- DTOs: class-validator + `@ApiProperty`, like `performance/dto/performance.dto.ts`.
- Notifications: `NotificationsService.notifyEmployee(tenantId, employeeId, type, title, message, link)`
  after the transaction commits, with `.catch((e) => this.logger.warn(...))`.
- Run only the suites you touch (shared CPU). Jest path args are regexes:
  `npx jest "src/app/\(protected\)/performance/goals"`.
- `npm run lint` is broken repo-wide; ignore lint.
- Before reporting: your specs pass; `cd backend && npx tsc --noEmit -p tsconfig.json`
  and `cd frontend && npx tsc --noEmit` clean **in your files**.
- Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Frontend pages follow `app/(protected)/performance/cycles/page.tsx`:
  `'use client'`, API objects from `@/lib/api-performance-*.ts` (unwrap
  `.data`), `react-hot-toast`, components from `@/components/ui`, role gating
  via `useAuth().hasRole(...)`, loading / empty / error states. The logged-in
  employee id comes from `currentEmployeeId(user)` in
  `@/lib/current-employee` — the stored user has no top-level `employeeId`.
  Test mock users use the real shape `{ role, employee: { id } }`. No JSX in
  `.ts` files.

## Review Focus

1. **Roll-up through a long or re-aligned chain** — moving a child goal from
   parent A to parent B must recompute both A and B (and their ancestors), and
   a child completed via its KRs must complete an all-children parent and post
   exactly one feed item for each newly completed goal. Owner: WS1 Step 4.
2. **An admin opening their own review** gets the employee view (no rating
   before release, never potential or calibration fields), cannot calibrate
   it and cannot set its potential. Owners: WS2 Step 2, WS1 Step 6, WS2 Step 5.
3. **Peer anonymity leaks through status** — the employee must not learn who
   submitted vs declined (both shown APPROVED), and below 3 submissions gets
   no answers at all, even after release. Owner: WS2 Step 4.
4. **Writes after the cycle completes** — answers, potential, calibration,
   peer actions and goals linked to completed reviews return 400 once the
   cycle is `COMPLETED`. Owners: WS2 Steps 3–5, WS1 Steps 2 and 6.
5. **Undefined `employeeId`** in any new `where` (goals scope, peer
   requests, team calibration for a manager without an employee record) —
   must 400 before the query, never match every row. Owners: WS1, WS2.

---

## Task 0: Scaffold (one commit, done by the coordinator before dispatch)

**Files:**
- Modify: `backend/prisma/schema.prisma` (Wave F block; additive fields and
  back-relations; 4 `NotificationType` values)
- Create: `backend/prisma/migrations/20261003100000_keka_wave_f/migration.sql`
- Modify: `backend/src/test/helpers/prisma-mock.ts` (append 11 model names)
- Modify: `backend/src/modules/performance/performance.module.ts`; create
  `performance.module.spec.ts`
- Create: `backend/src/modules/performance/performance-rating.ts` + spec
- Move: goal handlers from `performance.service.ts`/`performance.controller.ts`
  (+ their specs) into `goals/goals.service.ts`, `goals/goals.controller.ts`,
  `goals/dto/goals.dto.ts` (+ specs), unchanged behaviour.
- Create shells: `goals/goal-progress.service.ts` (`GoalProgressService`),
  `calibration/{calibration.service.ts, calibration.controller.ts}`,
  `competencies/{competencies.service.ts, competencies.controller.ts}`,
  `templates/{templates.service.ts, templates.controller.ts}`,
  `peer-reviews/{peer-reviews.service.ts, peer-reviews.controller.ts}`,
  `review-visibility.ts` (types only, functions throw `Error('not implemented')`).
- Modify: `backend/src/modules/engagement/feed/feed.types.ts`
- Create: `frontend/src/lib/api-performance-{goals,reviews,templates,competencies,peer,calibration}.ts`
- Modify: `frontend/src/lib/api-feed.ts` (`FeedItem.type` union)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (Performance children block)

### Interfaces — Produces (frozen)

```ts
// backend/src/modules/performance/performance-rating.ts
import { UserRole } from '@prisma/client';
export const MIN_ANONYMOUS_PEER_RESPONSES = 3;
export type Band = 'LOW' | 'MEDIUM' | 'HIGH';
export function isAdminRole(role: UserRole): boolean; // HR_ADMIN | SUPER_ADMIN
export function finalRatingOf(r: { calibratedRating: number | null; overallRating: number | null }): number | null;
export function performanceBand(finalRating: number): Band; // 1-2 LOW, 3 MEDIUM, 4-5 HIGH
export function potentialBand(potential: number): Band;     // 1 LOW, 2 MEDIUM, 3 HIGH
```

```ts
// backend/src/modules/performance/review-visibility.ts  (WS2 implements)
import { UserRole } from '@prisma/client';
export type ViewerRelation = 'SELF' | 'REVIEWER' | 'ADMIN';
export interface ReviewViewer { employeeId?: string; role: UserRole }
/** SELF beats REVIEWER beats ADMIN; null = no access (caller throws 404). */
export function resolveRelation(review: { employeeId: string; reviewerId: string }, viewer: ReviewViewer): ViewerRelation | null;
/** `review` must include cycle {status}. Omits (deletes) fields per the spec F4 table. */
export function toReviewView<T extends Record<string, any>>(review: T, relation: ViewerRelation): Record<string, unknown>;
```

```ts
// backend/src/modules/performance/goals/goal-progress.service.ts  (WS1 implements)
export function computeKrProgress(kr: { metricType: KeyResultMetricType; startValue: number; targetValue: number; currentValue: number }): number;
@Injectable() export class GoalProgressService {
  /** Recompute `goalId` and every ancestor inside `tx`; posts feed items for goals that became COMPLETED. */
  recomputeChain(tenantId: string, goalId: string, tx: Prisma.TransactionClient): Promise<void>;
}
```

```ts
// engagement/feed/feed.types.ts — after the scaffold
export const FEED_ITEM_TYPES = ['RECOGNITION', 'ANNOUNCEMENT', 'BIRTHDAY', 'WORK_ANNIVERSARY', 'GOAL_COMPLETED'] as const;
export const FEED_SOURCE = { RECOGNITION: 'Recognition', ANNOUNCEMENT: 'Announcement', EMPLOYEE: 'Employee', GOAL: 'Goal' } as const;
```

Module wiring (frozen):

```ts
@Module({
  imports: [NotificationsModule, FeedModule],
  controllers: [
    PerformanceController, GoalsController, CalibrationController,
    CompetenciesController, TemplatesController, PeerReviewsController,
  ],
  providers: [
    PerformanceService, GoalsService, GoalProgressService, CalibrationService,
    CompetenciesService, TemplatesService, PeerReviewsService,
  ],
})
export class PerformanceModule {}
```

`AuditModule` is `@Global()`, so `AuditService` is injectable without an
import. Shell services inject `PrismaService` only; implementers add
`NotificationsService`, `FeedService`, `AuditService`, `GoalProgressService`
or `TemplatesService` as needed (all provided above). **Route-order note:**
`GoalsController` must declare `goals/tree` before `goals/:id`.

### Frontend API files (frozen; complete, not shells)

Each file imports `{ api } from '@/lib/api'` and exports its types and an API
object. Exact content:

```ts
// api-performance-goals.ts
export type GoalOwnerType = 'COMPANY' | 'DEPARTMENT' | 'EMPLOYEE';
export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type KeyResultMetricType = 'NUMBER' | 'PERCENT' | 'CURRENCY' | 'BOOLEAN';
export interface KeyResult { id: string; goalId: string; title: string; metricType: KeyResultMetricType;
  startValue: number; targetValue: number; currentValue: number; unit: string | null;
  weight: number; progress: number; sortOrder: number }
export interface GoalPerson { id: string; firstName: string; lastName: string }
export interface Goal { id: string; ownerType: GoalOwnerType; title: string; description: string | null;
  targetDate: string; status: GoalStatus; progress: number; weight: number; shareOnFeed: boolean;
  completedAt: string | null; reviewId: string | null; parentGoalId: string | null;
  employeeId: string | null; departmentId: string | null;
  employee?: GoalPerson | null; department?: { id: string; name: string } | null;
  keyResults: KeyResult[]; isDerived: boolean; canEdit: boolean }
export interface GoalDetail extends Goal { parent: Goal | null; children: Goal[] }
export interface GoalTreeNode extends Goal { children: GoalTreeNode[] }
export type GoalScope = 'mine' | 'team' | 'company' | 'department';
export interface GoalInput { ownerType?: GoalOwnerType; title: string; description?: string; targetDate: string;
  weight?: number; reviewId?: string | null; parentGoalId?: string | null; departmentId?: string;
  shareOnFeed?: boolean; status?: GoalStatus; progress?: number }
export interface KeyResultInput { title: string; metricType?: KeyResultMetricType; startValue?: number;
  targetValue: number; currentValue?: number; unit?: string; weight?: number; sortOrder?: number }
export const goalsApi = {
  list: (params: { scope: GoalScope; departmentId?: string }) => api.get<Goal[]>('/performance/goals', { params }),
  tree: (rootId?: string) => api.get<GoalTreeNode[]>('/performance/goals/tree', { params: rootId ? { rootId } : {} }),
  get: (id: string) => api.get<GoalDetail>(`/performance/goals/${id}`),
  create: (data: GoalInput) => api.post<Goal>('/performance/goals', data),
  update: (id: string, data: Partial<GoalInput>) => api.put<Goal>(`/performance/goals/${id}`, data),
  remove: (id: string) => api.delete(`/performance/goals/${id}`),
  addKeyResult: (goalId: string, data: KeyResultInput) => api.post<KeyResult>(`/performance/goals/${goalId}/key-results`, data),
  updateKeyResult: (goalId: string, krId: string, data: Partial<KeyResultInput>) =>
    api.put<KeyResult>(`/performance/goals/${goalId}/key-results/${krId}`, data),
  removeKeyResult: (goalId: string, krId: string) => api.delete(`/performance/goals/${goalId}/key-results/${krId}`),
};
```

```ts
// api-performance-reviews.ts
export type ReviewQuestionType = 'RATING' | 'TEXT';
export type ReviewAudience = 'SELF' | 'MANAGER' | 'PEER';
export interface CycleQuestion { id: string; text: string; type: ReviewQuestionType; audience: ReviewAudience; isRequired: boolean; sortOrder: number }
export interface ReviewAnswer { cycleQuestionId: string; audience: ReviewAudience; rating: number | null; text: string | null }
export interface CompetencyRating { id: string; name: string; expectedLevel: number; managerRating: number | null; comment: string | null }
export interface AnonymousPeerFeedback { submittedCount: number;
  questions: Array<{ text: string; type: ReviewQuestionType; ratings: number[]; texts: string[] }>; comments: string[] }
export interface ReviewView {
  id: string; cycleId: string; employeeId: string; reviewerId: string; status: string;
  relation: 'SELF' | 'REVIEWER' | 'ADMIN'; released: boolean;
  cycle: { id: string; name: string; startDate: string; endDate: string; status: string; peerFeedbackEnabled: boolean; maxPeers: number };
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string; designation?: { name: string } | null; department?: { name: string } | null };
  reviewer?: { id: string; firstName: string; lastName: string };
  selfRating: number | null; selfComments: string | null; selfSubmittedAt: string | null;
  answers?: ReviewAnswer[];            // SELF answers always; MANAGER answers only when visible
  managerComments?: string | null; managerSubmittedAt?: string | null;
  competencyRatings?: CompetencyRating[];
  finalRating?: number | null;
  managerRating?: number | null; overallRating?: number | null;
  calibratedRating?: number | null; calibrationReason?: string | null; calibratedAt?: string | null;
  potentialRating?: number | null;
  peerFeedback?: AnonymousPeerFeedback | null; peerFeedbackHiddenReason?: 'TOO_FEW_RESPONSES' | 'NOT_RELEASED';
  goals?: unknown[];
}
export interface AnswerInput { cycleQuestionId: string; rating?: number; text?: string }
export interface SelfReviewInput { selfRating: number; selfComments?: string; answers?: AnswerInput[] }
export interface ManagerReviewInput { managerRating: number; managerComments?: string; overallRating: number;
  potentialRating?: number; answers?: AnswerInput[]; competencyRatings?: Array<{ id: string; rating: number; comment?: string }> }
export const reviewsApi = {
  myReviews: (params?: Record<string, string>) => api.get<{ data: ReviewView[]; meta: unknown }>('/performance/my-reviews', { params }),
  teamReviews: (params?: Record<string, string>) => api.get<{ data: ReviewView[]; meta: unknown }>('/performance/team-reviews', { params }),
  get: (id: string) => api.get<ReviewView>(`/performance/reviews/${id}`),
  questions: (id: string) => api.get<CycleQuestion[]>(`/performance/reviews/${id}/questions`),
  submitSelf: (id: string, data: SelfReviewInput) => api.post<ReviewView>(`/performance/reviews/${id}/self-review`, data),
  submitManager: (id: string, data: ManagerReviewInput) => api.post<ReviewView>(`/performance/reviews/${id}/manager-review`, data),
  setPotential: (id: string, potentialRating: number) => api.put<ReviewView>(`/performance/reviews/${id}/potential`, { potentialRating }),
};
```

```ts
// api-performance-templates.ts
import type { ReviewAudience, ReviewQuestionType } from './api-performance-reviews';
export interface BankQuestion { id: string; text: string; type: ReviewQuestionType; category: string | null; isActive: boolean; usedByTemplates: number }
export interface TemplateEntry { questionId: string; audience: ReviewAudience; isRequired: boolean; sortOrder: number;
  question?: { id: string; text: string; type: ReviewQuestionType; isActive: boolean } }
export interface ReviewTemplate { id: string; name: string; description: string | null; isActive: boolean; questions: TemplateEntry[] }
export interface QuestionInput { text: string; type: ReviewQuestionType; category?: string; isActive?: boolean }
export interface TemplateInput { name: string; description?: string; isActive?: boolean;
  questions: Array<{ questionId: string; audience: ReviewAudience; isRequired?: boolean; sortOrder?: number }> }
export const templatesApi = {
  listQuestions: () => api.get<BankQuestion[]>('/performance/questions'),
  createQuestion: (d: QuestionInput) => api.post<BankQuestion>('/performance/questions', d),
  updateQuestion: (id: string, d: Partial<QuestionInput>) => api.put<BankQuestion>(`/performance/questions/${id}`, d),
  removeQuestion: (id: string) => api.delete(`/performance/questions/${id}`),
  list: () => api.get<ReviewTemplate[]>('/performance/templates'),
  get: (id: string) => api.get<ReviewTemplate>(`/performance/templates/${id}`),
  create: (d: TemplateInput) => api.post<ReviewTemplate>('/performance/templates', d),
  update: (id: string, d: Partial<TemplateInput>) => api.put<ReviewTemplate>(`/performance/templates/${id}`, d),
  remove: (id: string) => api.delete(`/performance/templates/${id}`),
};
```

```ts
// api-performance-competencies.ts
export interface Competency { id: string; name: string; description: string | null; category: string | null; isActive: boolean; mappedDesignations: number }
export interface DesignationCompetency { competencyId: string; expectedLevel: number; competency: { id: string; name: string; isActive: boolean } }
export interface CompetencyInput { name: string; description?: string; category?: string; isActive?: boolean }
export const competenciesApi = {
  list: () => api.get<Competency[]>('/performance/competencies'),
  create: (d: CompetencyInput) => api.post<Competency>('/performance/competencies', d),
  update: (id: string, d: Partial<CompetencyInput>) => api.put<Competency>(`/performance/competencies/${id}`, d),
  remove: (id: string) => api.delete(`/performance/competencies/${id}`),
  forDesignation: (designationId: string) => api.get<DesignationCompetency[]>(`/performance/designations/${designationId}/competencies`),
  setForDesignation: (designationId: string, items: Array<{ competencyId: string; expectedLevel: number }>) =>
    api.put<DesignationCompetency[]>(`/performance/designations/${designationId}/competencies`, { items }),
};
```

```ts
// api-performance-peer.ts
import type { AnswerInput, CycleQuestion, ReviewAnswer } from './api-performance-reviews';
export type PeerStatus = 'NOMINATED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'DECLINED';
export interface PeerRow { id: string; status: PeerStatus; closed: boolean;
  peer: { id: string; firstName: string; lastName: string };
  nominatedBy?: { id: string; firstName: string; lastName: string } | null;   // reviewer/admin only
  submittedAt?: string | null; overallComment?: string | null; answers?: ReviewAnswer[] }  // reviewer/admin only
export interface PeerRequest { id: string; status: PeerStatus; closed: boolean;
  reviewee: { id: string; firstName: string; lastName: string }; cycle: { id: string; name: string };
  questions: CycleQuestion[]; answers: ReviewAnswer[]; overallComment: string | null }
export const peerApi = {
  listForReview: (reviewId: string) => api.get<PeerRow[]>(`/performance/reviews/${reviewId}/peers`),
  add: (reviewId: string, peerEmployeeId: string) => api.post<PeerRow>(`/performance/reviews/${reviewId}/peers`, { peerEmployeeId }),
  withdraw: (reviewId: string, peerReviewId: string) => api.delete(`/performance/reviews/${reviewId}/peers/${peerReviewId}`),
  decide: (reviewId: string, peerReviewId: string, approve: boolean) =>
    api.post<PeerRow>(`/performance/reviews/${reviewId}/peers/${peerReviewId}/decision`, { approve }),
  myRequests: () => api.get<PeerRequest[]>('/performance/peer-requests'),
  getRequest: (id: string) => api.get<PeerRequest>(`/performance/peer-requests/${id}`),
  submit: (id: string, data: { answers: AnswerInput[]; overallComment: string }) =>
    api.post<PeerRequest>(`/performance/peer-requests/${id}/submit`, data),
  decline: (id: string) => api.post<PeerRequest>(`/performance/peer-requests/${id}/decline`),
};
```

```ts
// api-performance-calibration.ts
export type Band = 'LOW' | 'MEDIUM' | 'HIGH';
export interface Distribution { '1': number; '2': number; '3': number; '4': number; '5': number; unrated: number; total: number }
export interface CalibrationRow { reviewId: string; employeeId: string; employeeName: string; employeeCode: string;
  departmentName: string; reviewerName: string; status: string; managerRating: number | null; overallRating: number | null;
  calibratedRating: number | null; calibrationReason: string | null; finalRating: number | null; potentialRating: number | null }
export interface CalibrationView { cycle: { id: string; name: string; status: string }; overall: Distribution;
  byDepartment: Array<{ departmentId: string | null; departmentName: string; distribution: Distribution }>;
  byManager: Array<{ reviewerId: string; reviewerName: string; distribution: Distribution }>;
  reviews: CalibrationRow[] }
export interface NineBoxPerson { reviewId: string; employeeId: string; name: string; designation: string | null;
  departmentName: string | null; finalRating: number; potentialRating: number }
export interface NineBoxView { cells: Array<{ performance: Band; potential: Band; employees: NineBoxPerson[] }>;
  missing: Array<{ reviewId: string; employeeId: string; name: string; missingRating: boolean; missingPotential: boolean }> }
export const calibrationApi = {
  get: (params: { cycleId: string; departmentId?: string; managerId?: string }) => api.get<CalibrationView>('/performance/calibration', { params }),
  calibrate: (reviewId: string, rating: number | null, reason: string) =>
    api.post(`/performance/reviews/${reviewId}/calibrate`, { rating, reason }),
  nineBox: (params: { cycleId: string; departmentId?: string }) => api.get<NineBoxView>('/performance/nine-box', { params }),
};
```

### Steps

- [ ] **Step 1: Schema.** Add, as one block titled `// PERFORMANCE DEPTH (Wave F)`
  after the `Goal` model, the spec's enums and the 11 new models
  (`KeyResult`, `ReviewQuestion`, `ReviewTemplate`, `ReviewTemplateQuestion`,
  `ReviewCycleQuestion`, `ReviewAnswer`, `Competency`,
  `DesignationCompetency`, `ReviewCompetencyRating`, `PeerReview`,
  `PeerReviewAnswer`) with real relations: every model gets
  `tenant Tenant @relation(...)`; `ReviewAnswer.review`/`cycleQuestion`
  (Cascade), `PeerReviewAnswer.cycleQuestion` (Cascade),
  `DesignationCompetency.designation`/`competency` (Cascade / Restrict),
  `ReviewTemplateQuestion.question` (Restrict), `ReviewCycle.template`
  (SetNull), `PeerReview.peer` → `Employee` relation `"PeerReviewPeer"`.
  Edit existing models only by appending fields/back-relations at the end of
  their field lists: `Goal` (spec F1 — `reviewId` and `employeeId` become
  optional; add `ownerType`, `departmentId`, `parentGoalId`, `shareOnFeed`,
  `completedAt`, `createdByUserId`, relations and indexes), `ReviewCycle`
  (`templateId`, `peerFeedbackEnabled`, `maxPeers`, relations),
  `PerformanceReview` (`potentialRating`, `calibratedRating`,
  `calibrationReason`, `calibratedById`, `calibratedAt`, back-relations),
  `Tenant`, `Employee`, `Department`, `Designation` (back-relations only).
  Append to `NotificationType`: `REVIEW_RESULTS_RELEASED`,
  `PEER_NOMINATION_PENDING`, `PEER_FEEDBACK_REQUESTED`, `REVIEW_CALIBRATED`.
  `cd backend && npx prisma validate && npx prisma generate`.
- [ ] **Step 2: Migration.**
  `git show origin/main:backend/prisma/schema.prisma > <scratchpad>/base.prisma`;
  `npx prisma migrate diff --from-schema-datamodel <scratchpad>/base.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261003100000_keka_wave_f/migration.sql`.
  Append:
  ```sql
  -- Wave F: existing completed goals get a completion time (no feed posts for them).
  UPDATE "goals" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;
  ```
  Read the SQL: no `DROP` of existing data, `goals.reviewId`/`employeeId`
  only lose `NOT NULL`, enum values are `ADD VALUE`.
- [ ] **Step 3: Mock list.** Append the 11 camelCase model names
  (`keyResult`, `reviewQuestion`, `reviewTemplate`, `reviewTemplateQuestion`,
  `reviewCycleQuestion`, `reviewAnswer`, `competency`,
  `designationCompetency`, `reviewCompetencyRating`, `peerReview`,
  `peerReviewAnswer`) as one block at the end of `prismaModels`. Also add
  `createManyAndReturn` to `createModelMock()` if missing.
- [ ] **Step 4: `performance-rating.ts` + spec**, TDD: band edges
  (1,2→LOW, 3→MEDIUM, 4,5→HIGH; potential 1/2/3), `finalRatingOf` prefers
  calibrated, returns null when both null, `isAdminRole` for all four roles.
- [ ] **Step 5: Move goals.** Cut `getMyGoals`, `createGoal`, `updateGoal`,
  `deleteGoal` and their DTOs/routes/spec cases out of the performance files
  into `goals/` verbatim (class `GoalsService`, `GoalsController`), same
  paths. Run `npx jest src/modules/performance` — same test count passes.
- [ ] **Step 6: Shells, `review-visibility.ts` types, module, module spec.**
  Shell controllers have the decorators above and no routes. Module spec
  compiles `PerformanceModule` with `.overrideProvider(PrismaService)` and
  `ThrottlerModule.forRoot([])` if needed, 30s timeout, and asserts every
  controller/provider resolves.
- [ ] **Step 7: Feed types, frontend API files, `api-feed.ts`, sidebar.**
  `api-feed.ts`: add `'GOAL_COMPLETED'` to the `FeedItem.type` union. Sidebar:
  append after the Improvement Plans line, as one block:
  ```tsx
  { name: 'Goals', href: '/performance/goals', icon: <Target className="h-4 w-4" /> },
  { name: 'Feedback Requests', href: '/performance/feedback-requests', icon: <MessageSquare className="h-4 w-4" /> },
  { name: 'Calibration', href: '/performance/calibration', icon: <BarChart3 className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER] },
  { name: '9-Box Grid', href: '/performance/nine-box', icon: <Grid3x3 className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER] },
  { name: 'Review Templates', href: '/performance/templates', icon: <FileText className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN] },
  { name: 'Competencies', href: '/performance/competencies', icon: <Award className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN] },
  ```
  (add missing lucide imports to the existing import list's end).
- [ ] **Step 8: Verify and commit.** `npx jest src/modules/performance src/modules/engagement/feed`,
  backend `tsc --noEmit`, frontend `tsc --noEmit`,
  `npx jest src/components/layout`. Commit
  `chore: Wave F scaffold — schema, migration, module shells, API clients`.

---

## WS1 (backend): Goals, key results, roll-up, feed, calibration, 9-box, competencies

**Owns:** `backend/src/modules/performance/goals/**`,
`calibration/**`, `competencies/**`.
**Consumes:** `FeedService.post`, `AuditService.log`, `NotificationsService`,
`performance-rating.ts`.
**Produces:** nothing WS2 consumes (WS2 reads `Competency` and
`DesignationCompetency` rows directly at launch).

- [ ] **Step 1: `computeKrProgress`, TDD** (`goal-progress.service.ts`).
  ```ts
  export function computeKrProgress(kr: { metricType: KeyResultMetricType; startValue: number; targetValue: number; currentValue: number }): number {
    if (kr.metricType === 'BOOLEAN') return kr.currentValue >= 1 ? 100 : 0;
    const span = kr.targetValue - kr.startValue;
    if (span === 0) throw new BadRequestException('Target value must differ from start value');
    const pct = Math.round(((kr.currentValue - kr.startValue) / span) * 100);
    return Math.max(0, Math.min(100, pct));
  }
  ```
  Specs: 0→50 at 25 = 50; decreasing 100→20 at 60 = 50; overshoot → 100;
  below start → 0; boolean 0/1; start==target → 400. Decimals arrive from
  Prisma as `Prisma.Decimal` — callers convert with `Number(...)`.
- [ ] **Step 2: Goal access + DTOs, TDD** (`goals.service.ts`,
  `dto/goals.dto.ts`). DTOs: `CreateGoalDto` gains `ownerType?`
  (`@IsEnum(GoalOwnerType)`), `departmentId?` (UUID), `parentGoalId?`
  (UUID, nullable via `@ValidateIf(o => o.parentGoalId !== null)`),
  `shareOnFeed?`, `reviewId` becomes optional; `title` 1–200, `weight`
  0.01–9.99. `UpdateGoalDto` adds `parentGoalId?` (nullable), `shareOnFeed?`;
  `ownerType` is not accepted on update (whitelist rejects it).
  `KeyResultDto`: `title` 1–200, `metricType?`, `startValue?`, `targetValue`,
  `currentValue?` (`@IsNumber`), `unit?` ≤20, `weight?` 0.01–9.99,
  `sortOrder?` int. `GoalQueryDto { scope: 'mine'|'team'|'company'|'department'; departmentId? }`.
  Helpers (private):
  - `canRead(goal, user)`: COMPANY/DEPARTMENT → true; EMPLOYEE → owner,
    admin, or `goal.employee.managerId === user.employeeId` (guard
    `user.employeeId` defined).
  - `canWrite(goal, user)`: COMPANY/DEPARTMENT → admin; EMPLOYEE →
    `goal.employeeId === user.employeeId` (defined).
  - `assertUnlocked(goal)`: goal with `review.status === 'COMPLETED'` → 400
    `'This review is completed; its goals can no longer be changed'`.
  Create rules: `ownerType` default EMPLOYEE; EMPLOYEE needs
  `user.employeeId` (400) and sets `employeeId` to it; COMPANY/DEPARTMENT
  need admin (403); DEPARTMENT needs `departmentId` in tenant (404), others
  must not send it (400); `reviewId` (EMPLOYEE only) as today;
  `createdByUserId = user.id`. Specs for each rule, plus a manager reading a
  direct report's goal (ok) and a peer's goal (404), and an admin editing an
  employee goal (403).
- [ ] **Step 3: Alignment, TDD.** `validateParent(tenantId, goal: {id?, ownerType, employeeId}, parentGoalId, user, tx)`:
  - parent `findFirst({ where: { id, tenantId } })` → 404 if missing or
    `!canRead(parent, user)`;
  - allowed: COMPANY→COMPANY; DEPARTMENT→COMPANY|DEPARTMENT;
    EMPLOYEE→COMPANY|DEPARTMENT|EMPLOYEE where parent's employee is the
    owner's manager (`owner.managerId === parent.employeeId`) — else 400
    `'This goal cannot be aligned to that parent'`;
  - cycle: walk `parentGoalId` from the parent (select `id, parentGoalId`),
    max 20 hops; meeting `goal.id` → 400 `'Alignment would create a cycle'`;
    exceeding 20 → 400.
  Specs: every allowed/refused pair, a cycle of 3, cross-tenant parent 404.
- [ ] **Step 4: Roll-up + feed, TDD** (`GoalProgressService.recomputeChain`).
  ```ts
  async recomputeChain(tenantId: string, goalId: string, tx: Prisma.TransactionClient) {
    let currentId: string | null = goalId;
    for (let hops = 0; currentId && hops <= 20; hops++) {
      const goal = await tx.goal.findFirst({
        where: { id: currentId, tenantId },
        include: { keyResults: true, children: { select: { progress: true, weight: true } },
                   department: { select: { name: true } } },
      });
      if (!goal) return;
      const derived = this.derive(goal); // null when manual
      if (derived) {
        const wasCompleted = goal.status === 'COMPLETED';
        const status = derived.progress === 0 ? 'NOT_STARTED' : derived.progress === 100 ? 'COMPLETED' : 'IN_PROGRESS';
        await tx.goal.update({ where: { id: goal.id }, data: {
          progress: derived.progress, status,
          completedAt: status === 'COMPLETED' ? (goal.completedAt ?? new Date()) : null } });
        if (!wasCompleted && status === 'COMPLETED') await this.postCompletion(goal, tx);
      }
      currentId = goal.parentGoalId;
    }
  }
  // derive: KRs → weighted mean of kr.progress by Number(kr.weight); else children → weighted mean of
  // child.progress by Number(child.weight); else null. Round to integer.
  ```
  `postCompletion(goal, tx)` (also called by `GoalsService` when a manual
  goal is set `COMPLETED`): skip when `ownerType === 'EMPLOYEE' && !goal.shareOnFeed`;
  else `feedService.post({ tenantId, type: 'GOAL_COMPLETED', sourceType: FEED_SOURCE.GOAL,
  sourceId: goal.id, subjectEmployeeId: goal.employeeId, actorEmployeeId: null,
  title: goal.title, payload: { ownerType: goal.ownerType, departmentName: goal.department?.name ?? null },
  dedupeKey: \`goal-completed:${goal.id}\` }, tx)`.
  Specs: KRs win over children; children-only weighted; manual goal is left
  alone but its parent still recomputes; parent completed by a child posts
  once with `tx`; unshared employee goal does not post; already-completed
  parent does not post again; chain of 3 recomputes all three *(Review Focus 1)*.
- [ ] **Step 5: Goal endpoints, TDD** (`goals.service.ts`, `goals.controller.ts`).
  Every write runs in `prisma.$transaction(async tx => …)`:
  - create → validateParent → create → `recomputeChain(tenantId, newGoal.parentGoalId)` if a parent.
  - update → `canWrite`/`assertUnlocked`; if derived (has KRs or children),
    `progress`/`status` in the DTO → 400 `'Progress of this goal is calculated from its key results or aligned goals'`;
    manual goal: status `COMPLETED` → progress 100 and `completedAt` stamped
    (post completion when it was not COMPLETED), leaving COMPLETED clears
    `completedAt`; re-align → validateParent; after update recompute the
    goal's chain, and also the old parent's chain when `parentGoalId` changed.
  - delete → children count > 0 → 400 `'Re-align or delete the child goals first'`;
    delete; recompute old parent chain.
  - KR create/update/delete → goal `canWrite` + `assertUnlocked`; KR
    `progress = computeKrProgress(...)`; BOOLEAN forces start 0 / target 1;
    then `recomputeChain(goalId)`.
  - `list(scope)`: `mine` → `{ tenantId, ownerType: 'EMPLOYEE', employeeId }`
    (400 without employeeId); `team` → admins: all EMPLOYEE goals; managers:
    `employee: { managerId: user.employeeId }` (400 without employeeId);
    others 403; `company` → `ownerType COMPANY`; `department` →
    `ownerType DEPARTMENT` (+ `departmentId` filter).
  - `tree(rootId?)`: load all COMPANY + DEPARTMENT goals and the EMPLOYEE
    goals the caller can read (own, reports', or all for admins), build the
    forest in memory by `parentGoalId`; a node whose parent is not visible
    becomes a root; `rootId` returns that subtree (404 if not visible).
  - `get(id)`: goal + KRs (sortOrder) + parent (if readable) + readable children.
  Every returned goal is mapped with `isDerived` (has KRs or children),
  `canEdit` (canWrite && not locked), Decimals as numbers.
  Keep `GET my-goals` returning the `mine` list. Controller tests per route
  incl. the employeeId 400 guard *(Review Focus 5)*.
- [ ] **Step 6: Calibration + 9-box, TDD** (`calibration.service.ts`,
  `calibration.controller.ts`, `dto/calibration.dto.ts`).
  - `CalibrateDto { rating: number | null (IsInt 1–5 unless null), reason: string (10–1000) }`.
  - `calibrate(user, reviewId, dto)`: admin (403); review in tenant with cycle
    (404); `review.employeeId === user.employeeId` → 403 *(Review Focus 2)*;
    review `COMPLETED` and cycle `ACTIVE` else 400 *(Review Focus 4)*; in one
    tx: update `calibratedRating`, `calibrationReason`, `calibratedById: user.id`,
    `calibratedAt: now` (all null-ed except reason/by/at on revert —
    `calibratedRating: null`, reason kept as the revert reason), then
    `auditService.log({ tenantId, userId: user.id, action: 'UPDATE',
    entityType: 'PerformanceReviewCalibration', entityId: reviewId,
    oldValues: { calibratedRating, calibrationReason }, newValues: {...} }, tx)`.
    After commit notify the reviewer `REVIEW_CALIBRATED`, link `/performance/team`.
  - `getCalibration(user, query)`: cycle in tenant (404); where
    `{ tenantId, cycleId }` + for MANAGER `reviewerId: user.employeeId`
    (400 without it), EMPLOYEE 403; filters `departmentId` →
    `employee: { departmentId }`, `managerId` → `reviewerId`. Include employee
    (name, code, department), reviewer. Build distributions with
    `finalRatingOf`; `unrated` counts null final rating; `total` = count.
    Group by department (null → `'No department'`) and reviewer, sorted by name.
  - `getNineBox(user, query)`: same scoping; 9 cells always present (order:
    potential HIGH→LOW rows, performance LOW→HIGH columns); reviews missing a
    final rating or potential go to `missing`.
  Specs: own-review 403, wrong state 400, audit called with the tx object,
  revert, manager scoping, distribution counts, band placement.
- [ ] **Step 7: Competencies, TDD** (`competencies.service.ts`,
  `competencies.controller.ts`, `dto/competencies.dto.ts`), all admin-only.
  CRUD; `name` 1–100 unique per tenant (409 on P2002); delete refused (400)
  when any `designationCompetency` references it; list includes
  `mappedDesignations` count. `PUT designations/:id/competencies { items }`:
  designation in tenant (404); every competency in tenant and active (400);
  `expectedLevel` 1–5; no duplicate ids (400); in a tx `deleteMany` then
  `createMany`; returns the list with competency names.
- [ ] **Step 8: Commit** `feat(performance): goals with key results, roll-up, calibration, 9-box, competencies`.

---

## WS2 (backend): Templates, review flow, rating release, 360

**Owns:** `performance.service.ts`, `performance.controller.ts`,
`dto/performance.dto.ts` (+ specs), `review-visibility.ts` (+ spec),
`templates/**`, `peer-reviews/**`.
**Consumes:** `performance-rating.ts`, `NotificationsService`.

- [ ] **Step 1: Templates + bank, TDD** (`templates/`). Admin-only CRUD.
  Question `text` 1–500, `type`, `category?` ≤100; delete refused (400) when
  any `reviewTemplateQuestion` references it; list returns `usedByTemplates`.
  Template `name` 1–100 unique (409), `questions[]` (1–50) with
  `questionId`, `audience`, `isRequired?` (default true), `sortOrder?`
  (default index); every question in tenant (404) and active (400); no
  duplicate `(questionId, audience)` (400). Create/replace entries in a tx.
  Delete refused (400) while a `DRAFT` cycle has `templateId` = it.
- [ ] **Step 2: Visibility mapper, TDD** (`review-visibility.ts`).
  ```ts
  export function resolveRelation(review, viewer) {
    if (viewer.employeeId && viewer.employeeId === review.employeeId) return 'SELF';
    if (viewer.employeeId && viewer.employeeId === review.reviewerId) return 'REVIEWER';
    if (isAdminRole(viewer.role)) return 'ADMIN';
    return null;
  }
  const NEVER_TO_SELF = ['managerRating', 'overallRating', 'calibratedRating', 'calibrationReason',
    'calibratedById', 'calibratedAt', 'potentialRating'];
  const HIDDEN_FROM_SELF_UNTIL_RELEASE = ['managerComments', 'managerSubmittedAt', 'competencyRatings'];
  export function toReviewView(review, relation) {
    const released = review.cycle?.status === 'COMPLETED';
    const view: Record<string, unknown> = { ...review, relation, released,
      finalRating: finalRatingOf(review) };
    if (relation === 'SELF') {
      for (const k of NEVER_TO_SELF) delete view[k];
      view.answers = (review.answers ?? []).filter(a => released || a.audience === 'SELF');
      if (!released) { for (const k of HIDDEN_FROM_SELF_UNTIL_RELEASE) delete view[k]; delete view.finalRating; }
    }
    delete view.peerReviews; // peer data is added by the caller per relation
    return view;
  }
  ```
  Specs: the full spec F4 table for SELF before/after, REVIEWER, ADMIN;
  admin-as-self gets SELF *(Review Focus 2)*; stranger → null.
- [ ] **Step 3: Review flow, TDD** (`performance.service.ts`,
  `performance.controller.ts`, `dto/performance.dto.ts`).
  - Cycle DTOs gain `templateId?` (UUID, nullable), `peerFeedbackEnabled?`,
    `maxPeers?` (1–10); create/update validate the template is in tenant and
    active (404/400). Update still DRAFT-only.
  - `launchCycle`: inside the existing transaction, after the status update:
    ```ts
    const reviews = await tx.performanceReview.createManyAndReturn({ data: employees.map(...), select: { id: true, employeeId: true } });
    if (cycle.templateId) {
      const entries = await tx.reviewTemplateQuestion.findMany({ where: { templateId: cycle.templateId, question: { isActive: true } },
        include: { question: true }, orderBy: { sortOrder: 'asc' } });
      await tx.reviewCycleQuestion.createMany({ data: entries.map(e => ({ tenantId, cycleId: id, questionId: e.questionId,
        text: e.question.text, type: e.question.type, audience: e.audience, isRequired: e.isRequired, sortOrder: e.sortOrder })) });
    }
    // competencies: employees selected with designationId; mappings for those designations (competency.isActive)
    await tx.reviewCompetencyRating.createMany({ data: /* one row per (review, mapping) */ });
    ```
    `employees` select adds `designationId`. Specs: questions snapshotted,
    inactive question skipped, no template → none, employee without
    designation → no competency rows.
  - `validateAnswers(questions, answers, audience)` (exported pure function
    in `performance.service.ts` or `review-answers.ts` you create): unknown
    or other-audience `cycleQuestionId` → 400; duplicates → 400; every
    required question of `audience` answered → else 400
    `'Please answer every required question'`; RATING int 1–5 and no text;
    TEXT trimmed 1–5000 and no rating. Returns rows for `reviewAnswer`.
    Reused by peer submit.
  - `submitSelfReview`: also validates/stores `answers` (SELF) with
    `deleteMany` + `createMany` in a tx with the status update; refuses when
    cycle not `ACTIVE` (400).
  - `submitManagerReview`: cycle `ACTIVE` (400); self-view refusal — reviewer
    reviewing themselves is impossible by launch, but an admin acting on
    their own review → 403; validates MANAGER answers; `competencyRatings`
    must cover exactly the review's rows (400) with rating 1–5;
    `potentialRating?` 1–3; all writes in one tx. Notification text becomes
    `'Your manager has completed your review. Results are released when the cycle closes.'`
    (no rating) — update the existing spec expectation.
  - `setPotential(user, reviewId, potentialRating)`: reviewer or admin,
    not own review (403), review not missing (404), cycle `ACTIVE` (400).
  - `completeCycle`: after the update, notify each employee with a
    `COMPLETED` review: `REVIEW_RESULTS_RELEASED`, `'Performance review results released'`,
    link `/performance`.
  - `getReview`/`getMyReviews`/`getTeamReviews`/submit responses: include
    `cycle: { id, name, startDate, endDate, status, peerFeedbackEnabled, maxPeers }`,
    `answers`, `competencyRatings`; access via `resolveRelation` (null →
    404 — update the existing 403 spec); map with `toReviewView`; for SELF
    add `peerFeedback` from `PeerReviewsService.anonymousFeedback(reviewId, released)`.
    Team reviews use relation REVIEWER/ADMIN per row.
  - `GET reviews/:id/questions`: viewer relation required (404); SELF gets
    SELF questions (and MANAGER after release); REVIEWER/ADMIN get all.
  Specs for each bullet *(Review Focus 4: every write after completion → 400)*.
- [ ] **Step 4: 360, TDD** (`peer-reviews/`). `PeerReviewsService` methods:
  `listForReview`, `add`, `withdraw`, `decide`, `myRequests`, `getRequest`,
  `submit`, `decline`, `anonymousFeedback(reviewId, released)`.
  - Common: review in tenant with cycle (404); relation via
    `resolveRelation` (null → 404); cycle `peerFeedbackEnabled` and `ACTIVE`
    for writes (400); review `COMPLETED` → 400 `'Peer feedback is closed'`.
  - `add`: SELF → only while review `PENDING`/`SELF_REVIEW`, status
    `NOMINATED`, `nominatedByEmployeeId = self`; REVIEWER/ADMIN → status
    `APPROVED`, `decidedAt`, `decidedByUserId`. Peer `ACTIVE` in tenant
    (404), not the employee nor the reviewer (400); non-REJECTED count <
    `maxPeers` (400); existing row for the peer → 409 (covers re-nominating a
    rejected peer). Notify reviewer (NOMINATED) or peer (APPROVED).
  - `withdraw`: SELF only, row `NOMINATED` (400), delete.
  - `decide { approve }`: REVIEWER/ADMIN only (SELF → 403); row `NOMINATED`
    (400); approved → notify peer `PEER_FEEDBACK_REQUESTED`, link
    `/performance/feedback-requests`.
  - `myRequests`/`getRequest`: `peerEmployeeId = user.employeeId` (400
    without; 404 for others' rows); statuses `APPROVED|SUBMITTED|DECLINED`;
    `closed = status === 'APPROVED' && review.status === 'COMPLETED'`;
    include reviewee name, cycle name, PEER cycle questions, own answers.
  - `submit`: row `APPROVED` and not closed (400); `validateAnswers(..., 'PEER')`;
    `overallComment` 1–5000; tx: answers createMany + status `SUBMITTED`,
    `submittedAt`. `decline`: `APPROVED` → `DECLINED`.
  - `listForReview` shaping: REVIEWER/ADMIN → full rows with peer,
    nominatedBy, answers, comment; SELF → `{ id, status: mask(status), closed, peer }`
    with `mask = s => (s === 'SUBMITTED' || s === 'DECLINED') ? 'APPROVED' : s`
    *(Review Focus 3)*.
  - `anonymousFeedback(reviewId, released)`: not released →
    `{ peerFeedback: null, peerFeedbackHiddenReason: 'NOT_RELEASED' }`;
    submitted count < `MIN_ANONYMOUS_PEER_RESPONSES` →
    `{ peerFeedback: null, peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES' }`;
    else group answers by cycle question (sortOrder), shuffle each
    `ratings`/`texts` array and `comments` with Fisher–Yates, no ids/names/timestamps.
  Specs: cap, self/reviewer refused, 409, decide by SELF 403, closed after
  manager submit, masking, threshold 2 vs 3, released false, output has no
  `id`/`peer` keys.
- [ ] **Step 5: Controllers + routes, TDD.** `PeerReviewsController` routes per
  spec F5 (all roles; services enforce relation). `PerformanceController`
  adds `PUT reviews/:id/potential`, `GET reviews/:id/questions`.
  Employee-id guards on `peer-requests*` *(Review Focus 5)*.
- [ ] **Step 6: Commit** `feat(performance): templates, review release, competency ratings and 360 feedback`.

---

## WS3 (frontend): Goals, calibration, 9-box, competencies, feed card

**Owns:** `frontend/src/app/(protected)/performance/{goals,calibration,nine-box,competencies}/**`,
`frontend/src/components/performance/goals/**`,
`frontend/src/components/performance/calibration/**`,
`frontend/src/components/engagement/feed/FeedItemCard.tsx` (+ test).
**Consumes:** `goalsApi`, `calibrationApi`, `competenciesApi` (frozen).

- [ ] **Step 1: Goal components, TDD.** `components/performance/goals/`:
  `GoalTree.tsx` (recursive, expand/collapse, owner chip
  Company/Department/name, progress bar, status badge, KR count),
  `GoalFormModal.tsx` (ownerType select shown only to admins; department
  select for DEPARTMENT; parent picker from `goalsApi.list` company +
  department + team-visible goals; review select from
  `reviewsApi.myReviews` non-completed for EMPLOYEE; weight; share toggle
  for EMPLOYEE; progress/status inputs hidden when `isDerived`),
  `KeyResultEditor.tsx` (list + inline add/edit/delete; BOOLEAN shows a
  done checkbox instead of numbers). Tests: derived goal hides progress
  input; non-admin cannot pick COMPANY; KR save calls `updateKeyResult`.
- [ ] **Step 2: `/performance/goals` page, TDD.** Tabs: Alignment tree
  (`goalsApi.tree()`), My goals, Team goals (managers/admins), Company,
  Department. "New goal" for everyone; "New company goal"/"New department
  goal" for admins. Goal detail drawer with KRs, parent link, children.
  Tests: employee sees no admin buttons; tree renders nested children;
  employee user mock `{ role: 'EMPLOYEE', employee: { id } }`.
- [ ] **Step 3: `/performance/calibration` page, TDD.** Cycle picker
  (`performanceApi.getCycles` from `@/lib/api`), department/manager
  filters, recharts bar charts for overall/by-department/by-manager
  distributions, review table (manager rating, calibrated, final, potential,
  reason). Admins: "Override" button → dialog (rating 1–5 or "Revert",
  reason textarea min 10 chars, disabled until valid) → `calibrationApi.calibrate`.
  Managers: no override buttons, banner "Read-only: your reviewees".
  Tests: override disabled under 10 chars; manager sees no override.
- [ ] **Step 4: `/performance/nine-box` page, TDD.** Cycle + department
  filters; 3×3 grid, y = potential (HIGH top), x = performance (LOW left),
  cell titles (e.g. "Star" HIGH/HIGH, "Core player" MEDIUM/MEDIUM, "Risk"
  LOW/LOW; the other six named High potential / Future star / Inconsistent
  / Solid performer / Effective / Underperformer), employee chips; "Not
  placed" list with missing reasons. Test: chips land in the right cell.
- [ ] **Step 5: `/performance/competencies` page, TDD.** Library table with
  add/edit/deactivate/delete (delete error toast shows the 400 message);
  Designation mapping tab: designation select (existing designations API in
  `@/lib/api`), rows of competency + expected level 1–5, save via
  `setForDesignation`. Admin-only page (non-admin → "You do not have access").
- [ ] **Step 6: Feed card, TDD.** `FeedItemCard.tsx`: `GOAL_COMPLETED` →
  icon `Target`, text `"{subject name} completed a goal: {title}"` when
  `subject`, else `"{Company|Department} goal completed: {title}"` from
  `payload.ownerType` (+ `payload.departmentName`).
- [ ] **Step 7: Commit** `feat(performance-ui): goals, calibration, 9-box, competencies pages`.

---

## WS4 (frontend): Templates, feedback requests, reviews, cycles

**Owns:** `frontend/src/app/(protected)/performance/page.tsx` (+test),
`performance/team/**`, `performance/cycles/**`, `performance/templates/**`,
`performance/feedback-requests/**`,
`frontend/src/components/performance/reviews/**`,
`frontend/src/components/performance/peer/**`.
**Consumes:** `reviewsApi`, `templatesApi`, `peerApi`, `goalsApi` (frozen).

- [ ] **Step 1: Shared review components, TDD**
  (`components/performance/reviews/`): `QuestionAnswersForm.tsx` (renders
  `CycleQuestion[]` for one audience; RATING as 1–5 buttons, TEXT as
  textarea; marks required; returns `AnswerInput[]`; reports
  `isComplete`), `AnswersReadonly.tsx`, `CompetencyRatingsForm.tsx`
  (name, expected level, 1–5, comment), `ReleasedResults.tsx` (final rating,
  manager comments and answers, competency ratings, anonymous peer
  feedback block or "Peer feedback is shown when at least 3 colleagues
  respond" / "Results are released when the cycle closes").
- [ ] **Step 2: Peer components, TDD** (`components/performance/peer/`):
  `PeerNominations.tsx` (employee view: list with status chips
  NOMINATED/APPROVED/REJECTED, add from employee search excluding self and
  reviewer, withdraw while NOMINATED, remaining slots `maxPeers - non-rejected`),
  `PeerApprovals.tsx` (reviewer/admin: approve/reject nominated, add peer,
  named submitted feedback with answers).
- [ ] **Step 3: `/performance` (my performance), TDD.** Review detail uses
  `reviewsApi.get` + `questions`; self-review form adds
  `QuestionAnswersForm` (SELF) and blocks submit until required answers;
  peers section when `cycle.peerFeedbackEnabled`; `released` → 
  `ReleasedResults`, else "Submitted — awaiting release" without any rating
  field. Goals tab links to `/performance/goals` and shows KR progress
  from `goalsApi.list({ scope: 'mine' })`. Update the existing page test.
- [ ] **Step 4: `/performance/team`, TDD.** Manager review form adds MANAGER
  questions, `CompetencyRatingsForm`, potential (1–3, optional), blocks
  submit until required answers and all competencies rated; review detail
  shows `PeerApprovals`, calibration info when `calibratedRating` set
  ("Calibrated from X to Y: reason"), and a potential editor while the
  cycle is ACTIVE.
- [ ] **Step 5: `/performance/cycles`, TDD.** Create/edit form adds template
  select (`templatesApi.list`, active only), peer feedback toggle, max peers
  (1–10, shown when toggle on); fields disabled unless DRAFT.
- [ ] **Step 6: `/performance/templates`, TDD.** Admin-only. Tab "Question
  bank": table + add/edit/deactivate/delete. Tab "Templates": list +
  editor (name, description, ordered entries: question select from active
  bank, audience, required; move up/down; remove).
- [ ] **Step 7: `/performance/feedback-requests`, TDD.** `peerApi.myRequests`;
  list grouped Open / Submitted / Closed or declined; open request page or
  modal with PEER questions via `QuestionAnswersForm`, overall comment,
  Submit and Decline (confirm).
- [ ] **Step 8: Commit** `feat(performance-ui): templates, 360 feedback, released results`.

---

## After the workstreams

1. **Per-task review** (mid-tier model) of each workstream against this plan
   and the spec. WS1's reviewer re-walks roll-up and the feed post (Review
   Focus 1). WS2's reviewer checks the visibility table field by field and
   that no peer response leaks names/ids/timestamps or submit-vs-decline to
   the employee (Review Focus 2–3).
2. **Whole-branch review** (most capable model): tenant scoping, every
   `employeeId` guard, IDOR on every `:id` (goals, KRs, reviews, peer rows,
   templates, competencies, designations), the Review Focus list, and
   regressions on the existing review flow. **One fix wave.**
3. **Integrate:** `git fetch origin && git merge origin/main`; resolve
   conflicts (schema, `Sidebar.tsx`, `prisma-mock.ts`, `NotificationType` —
   keep both sides' blocks). Rename the migration folder so its timestamp is
   newer than every migration on main; if main's schema changed, regenerate
   the SQL from the new `origin/main` schema (re-append the backfill).
4. **Full verification (once):** `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`;
   `cd frontend && npx jest && npx tsc --noEmit && npm run build`.
5. **PR** to `main` listing the changes outside the performance area (feed
   type + card, sidebar, prisma-mock, the 403→404 change on `reviews/:id`,
   the held-rating behaviour change). Then stop — the user merges and applies
   the migration.
