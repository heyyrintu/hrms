# Keka Wave E (Engagement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulse surveys with unlinkable anonymous responses, dashboard polls,
recognition with optional points, a generic social feed, and one-on-one
meeting notes.

**Architecture:** One `backend/src/modules/engagement/` folder with five area
modules (`surveys`, `polls`, `recognition`, `feed`, `one-on-ones`) plus a
shared `settings` module and IST date helpers, aggregated by
`EngagementModule`. A scaffold commit freezes the schema, migration, shared
services (`EngagementSettingsService`, `FeedService` write side, time
helpers) and module shells; four implementers then build disjoint areas in
parallel, each owning its backend and frontend.

**Tech Stack:** NestJS 11, Prisma 5 (PostgreSQL), class-validator, Jest;
Next.js 16 / React 19, axios, react-hot-toast, recharts, Testing Library.

**Spec (binding):** `docs/superpowers/specs/2026-09-28-keka-wave-e-design.md`
**Branch / worktree:** `feat/keka-wave-e` at
`C:\Users\RintuMondal\Videos\projects\hrms\.claude\worktrees\wave-e`.

## Global Constraints

- **Never** run `prisma migrate dev|reset|deploy` or `db push` — the database
  is a shared remote server. Migration SQL comes only from
  `npx prisma migrate diff --from-schema-datamodel <base.prisma> --to-schema-datamodel prisma/schema.prisma --script`.
- **Do not touch auth code** (`modules/auth/**`, guards, JWT strategy,
  `common/types/jwt-payload.type.ts`). Wave H1 is changing it in parallel.
  Protected routes use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
- **Frozen after the scaffold (Task 0) — implementers do not edit:**
  `backend/prisma/schema.prisma`, `backend/prisma/migrations/**`,
  `backend/src/app.module.ts`, `backend/src/test/helpers/prisma-mock.ts`,
  `engagement/engagement.module.ts` (+spec), `engagement/engagement-time.ts`
  (+spec), `engagement/settings/**`, `engagement/feed/feed.service.ts`
  (+spec), `engagement/feed/feed.types.ts`, every `engagement/*/*.module.ts`,
  `frontend/src/components/layout/Sidebar.tsx`. If a frozen contract is
  insufficient, stop and report NEEDS_CONTEXT with the exact change wanted.
- Shared files get one contiguous added block; never reorder, rename or
  reformat existing lines.
- Implementers run in parallel in the same worktree. Commit only your own
  paths: `git add <paths> && git commit -m "..." -- <paths>` (retry after a
  few seconds on `index.lock`). Never `git add -A`, `git stash`,
  `git checkout`/`git reset` of other files. Do not push.
- TDD: failing spec first. Backend specs use `createMockPrismaService()` from
  `backend/src/test/helpers` (the `src/` copy). UTC-noon dates in tests
  (`new Date('2026-03-15T12:00:00Z')`).
- `AuthenticatedUser.employeeId` is optional; employee-facing routes throw
  `BadRequestException('No employee record linked to this user')` before
  using it.
- Errors: 400 validation/state, 403 role/authorization, 404 missing or not
  visible, 409 duplicates/races. Every query scoped by `tenantId`.
- DTOs: class-validator + `@ApiProperty` like `modules/loans/dto/*`.
- "Today"/"this month" are IST (`Asia/Kolkata`) via `engagement-time.ts`.
- Run only the suites you touch (shared CPU). Jest path args are regexes:
  `npx jest "src/app/\(protected\)/engagement/surveys"`.
- `npm run lint` is broken repo-wide; ignore lint.
- Before reporting: your specs pass; `cd backend && npx tsc --noEmit -p tsconfig.json`
  and `cd frontend && npx tsc --noEmit` clean **in your files**.
- Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Frontend pages follow `app/(protected)/loans/page.tsx` and
  `app/(protected)/helpdesk/page.tsx`: `'use client'`, API objects from
  `@/lib/api-*.ts` (unwrap `.data`), `react-hot-toast`, components from
  `@/components/ui`, role gating via `useAuth().hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)`,
  loading / empty / error states. No JSX in `.ts` files.

## Review Focus

1. **Double-clicked launch / concurrent launch of one survey** — the second
   call must get 409 and must not create duplicate participants. Owner: WS1
   (guarded `updateMany where status DRAFT` + `createMany skipDuplicates`).
2. **Month boundary in IST** — a recognition given at 23:30 IST on 31 March
   (18:00 UTC) counts toward March's allowance, and one at 00:30 IST on
   1 April counts toward April. Owner: Task 0 (`istMonthRange`) and WS3.
3. **Inactive / exited employees** — never recognition recipients, never in a
   survey audience snapshot, never in birthday/anniversary items, never in the
   one-on-one counterpart picker. Owners: WS1, WS2, WS3, WS4.
4. **Poll or survey whose `closesAt` passed but status is still ACTIVE** —
   votes/responses are refused (400), poll results become visible to
   everyone, and "my surveys" shows it as not open. Owners: WS1, WS2.
5. **Users without an employee record** (e.g. a SUPER_ADMIN account) calling
   employee routes — 400, never a Prisma query with `employeeId: undefined`.
   Owners: every controller spec (one test each).

Each line above has a named test in its owning task.

---

## Task 0: Scaffold (one commit, done by the coordinator before dispatch)

**Files:**
- Modify: `backend/prisma/schema.prisma` (Engagement block, relation blocks on
  `Tenant` and `Employee`, 3 `NotificationType` values appended)
- Create: `backend/prisma/migrations/20260928100000_keka_wave_e/migration.sql`
- Modify: `backend/src/test/helpers/prisma-mock.ts` (append 17 model names;
  add `$executeRaw`/`$queryRaw` jest fns)
- Modify: `backend/src/app.module.ts` (import `EngagementModule`)
- Create: `backend/src/modules/engagement/engagement.module.ts`,
  `engagement.module.spec.ts`
- Create: `backend/src/modules/engagement/engagement-time.ts`, `engagement-time.spec.ts`
- Create: `backend/src/modules/engagement/settings/{engagement-settings.module.ts, engagement-settings.service.ts, engagement-settings.service.spec.ts, engagement-settings.controller.ts, engagement-settings.controller.spec.ts, dto/engagement-settings.dto.ts}`
- Create: `backend/src/modules/engagement/feed/{feed.types.ts, feed.service.ts, feed.service.spec.ts, feed.module.ts}`
- Create module files (frozen) and empty, registered shells (owned by the
  workstream that fills them):
  - `engagement/surveys/`: `surveys.module.ts`; shells `surveys.controller.ts`
    (`SurveysController`), `surveys.service.ts` (`SurveysService`),
    `survey-submission.service.ts` (`SurveySubmissionService`),
    `survey-results.service.ts` (`SurveyResultsService`).
  - `engagement/polls/`: `polls.module.ts`; shells `polls.controller.ts`,
    `polls.service.ts`.
  - `engagement/feed/`: shells `feed.controller.ts` (`FeedController`),
    `feed-query.service.ts` (`FeedQueryService`),
    `feed-celebrations.service.ts` (`FeedCelebrationsService`),
    `feed-celebrations-cron.service.ts` (`FeedCelebrationsCronService`).
  - `engagement/recognition/`: `recognition.module.ts`; shells
    `recognition.controller.ts`, `recognition.service.ts`,
    `badges.service.ts` (`BadgesService`),
    `recognition-leaderboard.service.ts` (`RecognitionLeaderboardService`).
  - `engagement/one-on-ones/`: `one-on-ones.module.ts`; shells
    `one-on-ones.controller.ts` (`OneOnOnesController`),
    `one-on-ones.service.ts` (`OneOnOnesService`).
  Shell controllers are `@Controller('engagement/<area>')` with
  `@ApiTags`, `@ApiBearerAuth`, `@UseGuards(JwtAuthGuard, RolesGuard)` and no
  routes; shell services inject `PrismaService` only (implementers add
  constructor dependencies, which the frozen module must already provide:
  every area module lists `NotificationsService`'s module, and
  Recognition/Feed also import `EngagementSettingsModule` and `FeedModule`
  as stated below).
- Modify: `frontend/src/components/layout/Sidebar.tsx` (ENGAGEMENT section)
- Create: `docs/superpowers/plans/2026-09-28-keka-wave-e.md` (this file)

**Interfaces — Produces (frozen):**

```ts
// engagement/engagement-time.ts
export const ENGAGEMENT_TIME_ZONE = 'Asia/Kolkata';
/** IST calendar date of `now` as { year, month (1-12), day }. */
export function istDateParts(now: Date): { year: number; month: number; day: number };
/** UTC instant of IST midnight of `now`'s IST date. */
export function istStartOfDay(now: Date): Date;
/** [start, end) UTC instants of the IST calendar month containing `now`. */
export function istMonthRange(now: Date): { start: Date; end: Date };
/** [start, end) for 'month' | 'quarter' | 'year'; 'all' → { start: null, end: null }. */
export type LeaderboardPeriod = 'month' | 'quarter' | 'year' | 'all';
export function istPeriodRange(period: LeaderboardPeriod, now: Date): { start: Date | null; end: Date | null };
```

```ts
// engagement/settings/engagement-settings.service.ts
export interface EngagementSettingsView {
  pointsEnabled: boolean; monthlyPointsAllowance: number;
  showBirthdays: boolean; showAnniversaries: boolean;
}
export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettingsView =
  { pointsEnabled: false, monthlyPointsAllowance: 100, showBirthdays: true, showAnniversaries: true };
@Injectable() export class EngagementSettingsService {
  get(tenantId: string, tx?: Prisma.TransactionClient): Promise<EngagementSettingsView>; // defaults when no row
  update(tenantId: string, dto: UpdateEngagementSettingsDto): Promise<EngagementSettingsView>; // upsert
}
// Controller: GET /engagement/settings (all roles), PUT /engagement/settings (HR_ADMIN, SUPER_ADMIN)
// DTO: all four fields optional; monthlyPointsAllowance @IsInt @Min(0) @Max(100000)
```

```ts
// engagement/feed/feed.types.ts
export const FEED_ITEM_TYPES = ['RECOGNITION', 'ANNOUNCEMENT', 'BIRTHDAY', 'WORK_ANNIVERSARY'] as const;
export type FeedItemType = (typeof FEED_ITEM_TYPES)[number];
export const FEED_SOURCE = { RECOGNITION: 'Recognition', ANNOUNCEMENT: 'Announcement', EMPLOYEE: 'Employee' } as const;
export interface PostFeedItemInput {
  tenantId: string; type: FeedItemType; sourceType: string; sourceId?: string | null;
  actorEmployeeId?: string | null; subjectEmployeeId?: string | null;
  title: string; body?: string | null; payload?: Record<string, unknown>;
  dedupeKey: string; occurredAt?: Date;
}

// engagement/feed/feed.service.ts  (write side only)
@Injectable() export class FeedService {
  post(input: PostFeedItemInput, tx?: Prisma.TransactionClient): Promise<{ id: string; created: boolean }>;
  removeBySource(tenantId: string, sourceType: string, sourceId: string, tx?: Prisma.TransactionClient): Promise<number>;
}
// FeedModule: imports EngagementSettingsModule; providers [FeedService]; exports [FeedService].
// WS2 adds FeedQueryService, FeedController, FeedCelebrationsService,
// FeedCelebrationsCronService to FeedModule's providers/controllers — the
// scaffold pre-registers them as empty classes in their own files so the
// module file stays frozen.
```

Area module wiring (frozen): each area module imports `EngagementSettingsModule`
and/or `FeedModule` as needed (Surveys: none; Polls: none; Recognition: both;
OneOnOnes: none) and registers its controller/service classes, which the
scaffold creates as empty `@Controller('engagement/<area>')` /
`@Injectable()` shells. `NotificationsService` is injected via the existing
global/notifications module import used by `loans.module.ts` (copy that
import). `ScheduleModule.forRoot()` is already registered by `LeaveModule`;
`FeedModule` does not register it again.

- [ ] **Step 1: Schema.** Add the spec's enums and models verbatim as one
  block titled `// ENGAGEMENT (Wave E)` after the last model. Relations:
  `Survey.createdBy`, `Poll.createdBy`, `Recognition.giver`,
  `OneOnOneMeeting.manager/employee/createdBy`,
  `OneOnOneActionItem.assignee`, `OneOnOnePrivateNote.author` → `Employee`
  with named relations; `SurveyParticipant.employee` → `Employee`;
  relation field names the plan's code relies on: `Survey.questions`,
  `SurveyAnswer.question`, `SurveyAnswer.response`, `Poll.options`,
  `Recognition.recipients`, `Recognition.badge`, `Recognition.giver`,
  `RecognitionRecipient.recognition`, `RecognitionRecipient.employee`,
  `OneOnOneMeeting.actionItems`, `OneOnOneMeeting.privateNotes`;
  `RecognitionRecipient.employee` → `Employee`; every model → `Tenant`.
  `SurveyResponse.employeeId`, `PollVoter.employeeId`, `FeedItem.*EmployeeId`,
  `FeedReaction.employeeId` have **no** relation (plain strings) — the
  anonymity and generic-feed rules require no FK join path from a response.
  Add back-relation fields to `Tenant` and `Employee` as one contiguous block
  at the end of each model's relation list. Append `SURVEY_LAUNCHED`,
  `RECOGNITION_RECEIVED`, `ONE_ON_ONE_SCHEDULED` to `NotificationType`.
  Cascades per spec (`onDelete: Cascade` on child → parent; `Recognition.badge`
  `onDelete: SetNull`).
- [ ] **Step 2: Validate and generate.**
  Run: `cd backend && npx prisma validate && npx prisma generate`
  Expected: both succeed.
- [ ] **Step 3: Migration SQL.**
  ```bash
  cd backend
  git show origin/main:backend/prisma/schema.prisma > "$SCRATCH/base.prisma"
  mkdir -p prisma/migrations/20260928100000_keka_wave_e
  npx prisma migrate diff --from-schema-datamodel "$SCRATCH/base.prisma" \
    --to-schema-datamodel prisma/schema.prisma --script \
    > prisma/migrations/20260928100000_keka_wave_e/migration.sql
  ```
  Expected: only `CREATE TYPE`, `ALTER TYPE "NotificationType" ADD VALUE`,
  `CREATE TABLE`, `CREATE INDEX`, `ADD CONSTRAINT` statements; no `DROP`.
- [ ] **Step 4: Mock Prisma.** Append to `prismaModels` (one block, comment
  `// Wave E engagement`): `'survey', 'surveyQuestion', 'surveyParticipant',
  'surveyResponse', 'surveyAnswer', 'poll', 'pollOption', 'pollVoter', 'badge',
  'recognition', 'recognitionRecipient', 'engagementSettings', 'feedItem',
  'feedReaction', 'oneOnOneMeeting', 'oneOnOneActionItem',
  'oneOnOnePrivateNote'`. After `mock.$disconnect`, add
  `mock.$executeRaw = jest.fn().mockResolvedValue(0);` and
  `mock.$queryRaw = jest.fn().mockResolvedValue([]);` (only if absent).
- [ ] **Step 5: Time helpers, TDD.** Spec cases (all must pass):
  `istDateParts(new Date('2026-03-31T18:00:00Z'))` → `{2026,3,31}` (23:30 IST);
  `istDateParts(new Date('2026-03-31T19:00:00Z'))` → `{2026,4,1}` (00:30 IST);
  `istMonthRange(new Date('2026-03-31T18:00:00Z'))` →
  `start 2026-02-28T18:30:00Z`, `end 2026-03-31T18:30:00Z`;
  `istPeriodRange('quarter', 2026-05-10T12:00Z)` → Apr 1 IST .. Jul 1 IST;
  `istPeriodRange('year', …)` → Jan 1 IST .. next Jan 1 IST; `'all'` → nulls.
  Implementation: IST is a fixed +05:30 offset (no DST), so
  `const IST_OFFSET_MS = 330 * 60_000;` shift, read UTC parts, and build
  starts with `Date.UTC(y, m - 1, 1) - IST_OFFSET_MS`.
- [ ] **Step 6: Settings service + controller, TDD.** Specs: `get` returns
  `DEFAULT_ENGAGEMENT_SETTINGS` when `findUnique` returns null; returns stored
  values otherwise; `update` calls `upsert` with `where: { tenantId }`;
  controller role metadata (`PUT` = HR_ADMIN, SUPER_ADMIN).
- [ ] **Step 7: FeedService write side, TDD.**
  ```ts
  async post(input: PostFeedItemInput, tx?: Prisma.TransactionClient) {
    if (!(FEED_ITEM_TYPES as readonly string[]).includes(input.type)) {
      throw new Error(`Unknown feed item type: ${input.type}`);
    }
    const db = tx ?? this.prisma;
    const existing = await db.feedItem.findUnique({
      where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    try {
      const row = await db.feedItem.create({ data: {
        tenantId: input.tenantId, type: input.type, sourceType: input.sourceType,
        sourceId: input.sourceId ?? null, actorEmployeeId: input.actorEmployeeId ?? null,
        subjectEmployeeId: input.subjectEmployeeId ?? null, title: input.title,
        body: input.body ?? null, payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey, occurredAt: input.occurredAt ?? new Date(),
      }, select: { id: true } });
      return { id: row.id, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await db.feedItem.findUnique({ where: { tenantId_dedupeKey: {
          tenantId: input.tenantId, dedupeKey: input.dedupeKey } }, select: { id: true } });
        if (again) return { id: again.id, created: false };
      }
      throw e;
    }
  }
  removeBySource(tenantId, sourceType, sourceId, tx?) →
    (tx ?? this.prisma).feedItem.deleteMany({ where: { tenantId, sourceType, sourceId } }).then(r => r.count)
  ```
  Note for callers: inside an interactive transaction a caught P2002 aborts
  the transaction in Postgres; the pre-check `findUnique` is what keeps
  in-transaction callers (recognition, one per new id) safe.
  Specs: unknown type throws; existing key → `created: false`, no create;
  new key → create with defaults (`payload {}`, `occurredAt` set); uses `tx`
  when given; `removeBySource` returns the count.
- [ ] **Step 8: Module wiring.** `EngagementModule` imports
  `EngagementSettingsModule, FeedModule, SurveysModule, PollsModule,
  RecognitionModule, OneOnOnesModule` and exports `FeedModule`.
  `engagement.module.spec.ts` compiles `EngagementModule` with
  `.overrideProvider(PrismaService).useValue(createMockPrismaService())`,
  `ThrottlerModule.forRoot([])` if needed, jest timeout 30 s, and asserts
  `FeedService` resolves. Add `EngagementModule` to `app.module.ts` imports
  (one line + one import line, appended at the end of each list).
- [ ] **Step 9: Sidebar.** Add, after the MY WORKSPACE section, one section:
  ```tsx
  // Keka wave E: engagement
  {
    label: 'ENGAGEMENT',
    items: [
      { name: 'Feed', href: '/engagement/feed', icon: <Newspaper className="h-[18px] w-[18px]" /> },
      { name: 'Recognition', href: '/engagement/recognition', icon: <Award className="h-[18px] w-[18px]" /> },
      { name: 'Surveys', href: '/engagement/surveys', icon: <ClipboardCheck className="h-[18px] w-[18px]" /> },
      { name: 'One-on-ones', href: '/one-on-ones', icon: <MessagesSquare className="h-[18px] w-[18px]" /> },
      { name: 'Polls', href: '/engagement/polls', icon: <Vote className="h-[18px] w-[18px]" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN] },
    ],
  },
  ```
  (add the five lucide imports to the existing import list only if absent,
  appended at its end).
- [ ] **Step 10: Verify.** `cd backend && npx jest src/modules/engagement && npx tsc --noEmit -p tsconfig.json`;
  `cd frontend && npx tsc --noEmit && npx jest src/components/layout`.
  Expected: all green.
- [ ] **Step 11: Commit** `feat(engagement): Wave E scaffold — schema, migration, shared services, module shells`.

---

## WS1: Pulse surveys

**Owns:** `backend/src/modules/engagement/surveys/**` except
`surveys.module.ts`; frontend `app/(protected)/engagement/surveys/**`,
`components/engagement/surveys/**`, `lib/api-surveys.ts` (+`.test.ts`).
**Consumes:** `NotificationsService.createMany`.
**Produces:** nothing other workstreams consume.

Files: `surveys.service.ts` (CRUD, launch, close, mine, form),
`survey-submission.service.ts` (submit — kept separate so the anonymity path
is small and reviewable), `survey-results.service.ts` (results,
named responses), `surveys.controller.ts`, `dto/survey.dto.ts`,
`survey-answer-validation.ts` (pure function) — each with a spec.

Constant: `export const MIN_ANONYMOUS_RESPONSES = 3;` in
`survey-results.service.ts`.

- [ ] **Step 1: Answer validation (pure), TDD.**
  `validateAnswers(questions, answers): NormalizedAnswer[]` where
  `answers: { questionId: string; text?: string; choices?: string[]; value?: number }[]`,
  `NormalizedAnswer = { questionId; textValue: string|null; choiceValues: string[]; numericValue: number|null }`.
  Throws `BadRequestException` for: unknown questionId; duplicate questionId;
  missing required (TEXT trimmed empty counts as missing); SINGLE_CHOICE not
  exactly one listed option; MULTI_CHOICE empty, unlisted or duplicate
  option; RATING not an integer 1–5; ENPS not an integer 0–10; TEXT > 5000.
  Unanswered optional questions produce no row. One spec per rule.
- [ ] **Step 2: DTOs.** `CreateSurveyDto { title (1-200), description? (≤2000),
  isAnonymous?, audienceType, audienceIds: string[] (IsUUID each), closesAt?
  (ISO), questions: SurveyQuestionDto[] (ArrayMinSize 1, ArrayMaxSize 50,
  ValidateNested) }`; `SurveyQuestionDto { type, text (1-500), required?,
  options?: string[] }`; `UpdateSurveyDto` = Partial; `SubmitSurveyDto {
  answers: AnswerDto[] }`. Question-type option rules are checked in the
  service (2–20 distinct trimmed non-empty for choices; none otherwise).
- [ ] **Step 3: CRUD + launch/close, TDD.** Specs:
  create validates audience ids belong to the tenant (`department.count` /
  `branch.count` equals ids length, else 400) and writes survey + questions
  (`order` = index) in one transaction; `update`/`delete` on non-DRAFT → 400;
  update replaces questions (`deleteMany` + `createMany`);
  **launch**:
  ```ts
  await this.prisma.$transaction(async (tx) => {
    const flipped = await tx.survey.updateMany({
      where: { id, tenantId, status: 'DRAFT' }, data: { status: 'ACTIVE', launchedAt: new Date() } });
    if (flipped.count === 0) throw new ConflictException('Survey is not a draft');
    const employees = await tx.employee.findMany({ where: audienceWhere(tenantId, survey), select: { id: true } });
    if (employees.length === 0) throw new BadRequestException('The audience has no active employees');
    await tx.surveyParticipant.createMany({ data: employees.map(e => ({ tenantId, surveyId: id, employeeId: e.id })), skipDuplicates: true });
    return employees;
  });
  ```
  where `audienceWhere` = `{ tenantId, status: 'ACTIVE' }` plus
  `departmentId: { in: ids }` or `branchId: { in: ids }`. The survey is read
  (404 if missing) before the transaction; a missing/other-tenant id is 404,
  a non-draft is 409, `closesAt` in the past → 400.
  After commit: map employee ids to active users
  (`user.findMany({ where: { tenantId, employeeId: { in }, isActive: true } })`)
  and `notifications.createMany` with `SURVEY_LAUNCHED`, title
  `'New survey'`, message = survey title, link `/engagement/surveys/<id>`;
  errors caught and logged.
  Tests: DEPARTMENT audience filter passed to `employee.findMany`; inactive
  employees excluded (`status: 'ACTIVE'` in where) *(Review Focus 3)*; second
  launch → 409 and no `createMany` *(Review Focus 1)*; empty audience → 400.
  `close`: `updateMany where status ACTIVE` → count 0 → 400.
- [ ] **Step 4: mine + form, TDD.** `mine(tenantId, employeeId)` returns
  participant rows joined to survey (`id, title, description, isAnonymous,
  status, closesAt, questionCount`) + `submitted` + `isOpen = status ACTIVE &&
  (!closesAt || closesAt > now)`; ordered open-and-unsubmitted first, then
  `launchedAt` desc. Test: ACTIVE survey past `closesAt` → `isOpen: false`
  *(Review Focus 4)*. `form(tenantId, employeeId, id)`: 404 unless a
  participant row exists; returns survey, ordered questions, `submitted`.
- [ ] **Step 5: Submit, TDD** (`survey-submission.service.ts`):
  ```ts
  async submit(tenantId: string, employeeId: string, surveyId: string, dto: SubmitSurveyDto) {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, tenantId }, include: { questions: true } });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.status !== 'ACTIVE' || (survey.closesAt && survey.closesAt <= new Date()))
      throw new BadRequestException('This survey is closed');
    const rows = validateAnswers(survey.questions, dto.answers);
    await this.prisma.$transaction(async (tx) => {
      const marked = await tx.surveyParticipant.updateMany({
        where: { tenantId, surveyId, employeeId, submitted: false }, data: { submitted: true } });
      if (marked.count === 0) {
        const exists = await tx.surveyParticipant.findFirst({ where: { tenantId, surveyId, employeeId }, select: { id: true } });
        if (exists) throw new ConflictException('You have already responded');
        throw new NotFoundException('Survey not found');
      }
      const response = await tx.surveyResponse.create({ data: {
        tenantId, surveyId,
        employeeId: survey.isAnonymous ? null : employeeId,
        submittedAt: survey.isAnonymous ? null : new Date(),
      }, select: { id: true } });
      await tx.surveyAnswer.createMany({ data: rows.map(r => ({ tenantId, responseId: response.id, ...r })) });
    });
    return { submitted: true };   // never return the response id
  }
  ```
  No logger call in this method. Tests: anonymous → `surveyResponse.create`
  data has `employeeId: null, submittedAt: null`; named → both set; already
  submitted → 409; not a participant → 404; past `closesAt` → 400 *(Review
  Focus 4)*; invalid answer → 400 and no `updateMany`; return value has no id.
- [ ] **Step 6: Results, TDD** (`survey-results.service.ts`). `results(tenantId, id)`:
  404 missing; DRAFT → 400. `participantCount = surveyParticipant.count`,
  `responseCount = surveyResponse.count`. Anonymous and
  `responseCount < MIN_ANONYMOUS_RESPONSES` → return
  `{ surveyId, isAnonymous: true, withheld: true, participantCount, responseCount, responseRate }`.
  Otherwise load answers `surveyAnswer.findMany({ where: { tenantId, question: { surveyId } }, orderBy: { id: 'asc' } })`
  and aggregate per question per the spec. eNPS:
  ```ts
  const promoters = vals.filter(v => v >= 9).length, detractors = vals.filter(v => v <= 6).length;
  const passives = vals.length - promoters - detractors;
  const score = vals.length ? Math.round(((promoters - detractors) / vals.length) * 100) : null;
  ```
  Tests: 5 promoters, 2 passives, 3 detractors → `score 20`; rating average
  2 dp and distribution 1..5; choice counts in option order with zeros; text
  answers ordered by answer id (assert `orderBy: { id: 'asc' }`); withheld at
  2 anonymous responses, shown at 3; `responseRate` 1 dp; 0 responses → 0.
  `namedResponses(tenantId, id)`: anonymous → 400; returns responses with
  employee (`employee.findMany` by the response `employeeId`s — there is no
  relation) and answers.
- [ ] **Step 7: Controller, TDD.** Routes per spec table, `mine` declared
  before `:id`. Every employee route guards `user.employeeId`. Spec: role
  metadata for each HR route; `submit` without `employeeId` → 400 *(Review
  Focus 5)*; the submit handler has no `@Audit` metadata
  (`Reflect.getMetadata(AUDIT_ENTITY_KEY, handler)` undefined).
- [ ] **Step 8: Frontend client, TDD.** `lib/api-surveys.ts` exporting
  `surveysApi` (`list, create, get, update, remove, launch, close, mine,
  form, submit, results, responses`) and types (`Survey`, `SurveyQuestion`,
  `SurveyQuestionType`, `MySurvey`, `SurveyForm`, `SurveyResults`,
  `QuestionResult` discriminated by `type`, `NamedResponse`). Test each
  function's URL, method and payload with `jest.mock('@/lib/api')`.
- [ ] **Step 9: Pages, TDD.**
  `app/(protected)/engagement/surveys/page.tsx` — tabs "My surveys" (all) and
  "Manage" (HR/SUPER); `components/engagement/surveys/SurveyBuilder.tsx`
  (question list editor, type select, options editor for choice types,
  required checkbox, anonymous toggle, audience select loading departments
  via `departmentsApi`/branches via `branchesApi` from `@/lib/api`, closes-at
  input); `app/(protected)/engagement/surveys/[id]/page.tsx` — respond form
  with anonymity notice text exactly:
  *"This survey is anonymous. Your answers are not linked to you in the
  application or its data."*; already submitted → "Thanks, you have
  responded."; closed → "This survey is closed.";
  `app/(protected)/engagement/surveys/[id]/results/page.tsx` — recharts bars,
  eNPS number with split, text list, withheld state text
  *"Results are hidden until at least 3 people respond."*, named responses
  table when not anonymous. Tests: my-surveys list renders open/responded;
  manage tab hidden for EMPLOYEE; builder adds a choice question and submits
  the DTO shape; respond form posts answers; results page renders withheld
  state and eNPS score.
- [ ] **Step 10: Verify + commit.**
  `cd backend && npx jest src/modules/engagement/surveys`;
  `cd frontend && npx jest "src/app/\(protected\)/engagement/surveys" src/lib/api-surveys src/components/engagement/surveys`;
  both tsc. Commit `feat(engagement): pulse surveys with anonymous responses`.

---

## WS2: Feed (read side, celebrations, reactions), polls, announcements hook, dashboard widget

**Owns:** `engagement/feed/**` except `feed.service.ts`(+spec),
`feed.types.ts`, `feed.module.ts`; `engagement/polls/**` except
`polls.module.ts`; `backend/src/modules/announcements/announcements.{service,module}.ts`
(+ service spec); frontend `app/(protected)/engagement/feed/**`,
`app/(protected)/engagement/polls/**`, `components/engagement/PollWidget.tsx`
(+test), `components/engagement/feed/**`, `app/(protected)/dashboard/page.tsx`
(+ its test), `lib/api-feed.ts`, `lib/api-polls.ts` (+tests).
**Consumes:** `FeedService.post/removeBySource`, `FEED_ITEM_TYPES`,
`FEED_SOURCE`, `EngagementSettingsService.get`, `istDateParts`,
`istStartOfDay`.
**Produces:** nothing other workstreams consume.

Files already registered by the scaffold (empty shells to fill):
`feed-query.service.ts` (`FeedQueryService`), `feed.controller.ts`,
`feed-celebrations.service.ts`, `feed-celebrations-cron.service.ts`,
`polls.service.ts`, `polls.controller.ts`.

- [ ] **Step 1: Feed list, TDD** (`FeedQueryService.list(tenantId, employeeId, { cursor?, limit })`):
  read settings; `where = { tenantId, isHidden: false, type: { notIn: hiddenTypes } }`
  (`BIRTHDAY` when `!showBirthdays`, `WORK_ANNIVERSARY` when
  `!showAnniversaries`); keyset: when `cursor` given, load that item
  (404 if not found in tenant) and add
  `OR: [{ occurredAt: { lt: c.occurredAt } }, { occurredAt: c.occurredAt, id: { lt: c.id } }]`;
  `orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`
  (`nextCursor` = last id when more). Join actor/subject names with one
  `employee.findMany({ where: { tenantId, id: { in } }, select: { id, firstName, lastName, profilePhoto } })`
  (check the Employee field name for the photo; omit if none). Reactions:
  `feedReaction.groupBy({ by: ['feedItemId', 'kind'], _count: true, where: { feedItemId: { in } } })`
  and `feedReaction.findMany({ where: { feedItemId: { in }, employeeId } })`.
  Tests: hidden types filtered by settings; cursor condition; `nextCursor`
  null on last page; missing actor → `actor: null`; counts default 0.
- [ ] **Step 2: React + hide, TDD.** `toggleReaction(tenantId, employeeId, itemId, kind)`:
  item must exist in tenant and not be hidden (404); if a reaction exists
  `delete` it else `create` (P2002 on create → treat as already present and
  return counts); return `{ reactionCounts, myReactions }`. `hide(tenantId, id)`:
  `updateMany` count 0 → 404. Controller: `GET /engagement/feed` (limit
  `ParseIntPipe` default 20, clamp 1–50), `POST /engagement/feed/:id/reactions`
  (`{ kind: FeedReactionKind }` validated with `@IsEnum`),
  `POST /engagement/feed/:id/hide` (HR/SUPER). Controller spec includes
  missing `employeeId` → 400 *(Review Focus 5)*.
- [ ] **Step 3: Celebrations, TDD** (`FeedCelebrationsService`):
  ```ts
  /** month/day match with the Feb-29 rule. m,d = employee's; today = IST parts. */
  export function matchesToday(m: number, d: number, t: { year: number; month: number; day: number }): boolean {
    if (m === t.month && d === t.day) return true;
    const leap = (t.year % 4 === 0 && t.year % 100 !== 0) || t.year % 400 === 0;
    return !leap && m === 2 && d === 29 && t.month === 2 && t.day === 28;
  }
  ```
  `dateOfBirth` is `@db.Date` → read with `getUTCMonth()+1 / getUTCDate()`.
  `joinDate` is a timestamp → take its IST date via `istDateParts(joinDate)`.
  `runForTenant(tenantId, now)`: settings; `employee.findMany({ where: {
  tenantId, status: 'ACTIVE' }, select: { id, firstName, lastName, dateOfBirth, joinDate } })`;
  for each match call `feed.post` with dedupe keys
  `birthday:<id>:<yyyy>` / `anniversary:<id>:<yyyy>`, `sourceType
  FEED_SOURCE.EMPLOYEE`, `sourceId` = employee id, `subjectEmployeeId` = id,
  `occurredAt = istStartOfDay(now)`, payload `{}` / `{ years }`, titles per
  spec (`year`/`years` pluralised). Anniversary only when `years >= 1`.
  `runForAllTenants(now)`: `tenant.findMany({ select: { id } })` (check the
  tenant active flag used by `AutoAbsentService.runForAllTenants` and mirror
  it), each tenant in try/catch (log + count failures), returns
  `{ tenants, created, failed }`. Cron service:
  `@Cron('10 0 * * *', { name: 'feed-celebrations', timeZone: ENGAGEMENT_TIME_ZONE })`
  calling `runForAllTenants(new Date())` in try/catch, like
  `AutoAbsentCronService`.
  Tests: birthday on the day; 29 Feb person on 28 Feb 2027 (non-leap) yes and
  on 28 Feb 2028 (leap) no; anniversary `years` = 3, joined this year → none;
  `showBirthdays: false` → no birthday posts; the where clause filters
  `status: 'ACTIVE'` *(Review Focus 3)*; payload never contains a year for
  birthdays; one tenant throwing does not stop the next.
- [ ] **Step 4: Announcements hook, TDD.** `AnnouncementsModule` imports
  `FeedModule` (from `../engagement/feed/feed.module`). Constructor gains
  `private feed: FeedService`. Add a private helper:
  ```ts
  private async syncFeed(tenantId: string, a: { id: string; title: string; content: string; authorId: string; priority: string; isPublished: boolean; publishedAt: Date | null }) {
    try {
      if (a.isPublished) {
        await this.feed.post({ tenantId, type: 'ANNOUNCEMENT', sourceType: FEED_SOURCE.ANNOUNCEMENT, sourceId: a.id,
          actorEmployeeId: a.authorId, title: a.title, body: a.content.slice(0, 500),
          payload: { priority: a.priority }, dedupeKey: `announcement:${a.id}`, occurredAt: a.publishedAt ?? new Date() });
      } else {
        await this.feed.removeBySource(tenantId, FEED_SOURCE.ANNOUNCEMENT, a.id);
      }
    } catch (err) {
      this.logger.error(`Feed sync failed for announcement ${a.id}`, err as Error);
    }
  }
  ```
  Call it after `create` when published, after `update` when `dto.isPublished`
  changed the published state (either direction), and in `delete` call
  `feed.removeBySource` inside the same try/catch pattern. Add a `Logger` if
  the service has none. Tests (append to the existing spec, provide a
  `FeedService` mock in the testing module): publish on create posts; draft
  create does not; update false→true posts; update true→false removes;
  delete removes; `feed.post` rejecting does not fail `create`. Existing
  specs must still pass with the extra provider.
- [ ] **Step 5: Polls backend, TDD.** DTO `CreatePollDto { question (1-300),
  options: string[] (2-10, each 1-100, distinct after trim), closesAt? }`,
  `VoteDto { optionId: IsUUID }`. Service:
  `create` (poll + options in one tx, `order` = index);
  `active(tenantId, employeeId, isAdmin)`: `status ACTIVE` and (`closesAt`
  null or > now), newest first, each with `hasVoted`
  (`pollVoter.findMany` for the caller) and `options` with `voteCount`
  `null` unless `hasVoted || isAdmin`, plus `totalVotes` (same rule);
  `list` (HR, paginated, all statuses, counts always); `vote`:
  ```ts
  await this.prisma.$transaction(async (tx) => {
    const poll = await tx.poll.findFirst({ where: { id, tenantId }, include: { options: true } });
    if (!poll) throw new NotFoundException('Poll not found');
    if (poll.status !== 'ACTIVE' || (poll.closesAt && poll.closesAt <= new Date()))
      throw new BadRequestException('This poll is closed');
    if (!poll.options.some(o => o.id === optionId)) throw new BadRequestException('Invalid option');
    try { await tx.pollVoter.create({ data: { tenantId, pollId: id, employeeId } }); }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw new ConflictException('You have already voted'); throw e; }
    await tx.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });
  });
  ```
  `close` (`updateMany where ACTIVE` → count 0 → 400), `remove` (404 if
  missing). A poll whose `closesAt` has passed is excluded from `active` and
  its results are visible to everyone in `list`. Tests: double vote → 409
  and no increment; vote after `closesAt` → 400 *(Review Focus 4)*; counts
  hidden before voting and shown after; admin always sees counts; unknown
  option → 400. Controller: routes per spec; `active` before `:id`; missing
  `employeeId` on vote → 400 *(Review Focus 5)*.
- [ ] **Step 6: Frontend clients, TDD.** `lib/api-feed.ts` (`feedApi.list(cursor?, limit?)`,
  `react(id, kind)`, `hide(id)`, types `FeedItem`, `FeedPage`,
  `FeedReactionKind`); `lib/api-polls.ts` (`pollsApi.active, list, create,
  vote, close, remove`, types `Poll`, `PollOption`). URL/method/payload tests.
- [ ] **Step 7: Feed page + PollWidget + polls page, TDD.**
  `app/(protected)/engagement/feed/page.tsx` with
  `components/engagement/feed/FeedItemCard.tsx` (icon per type: 🎉
  BIRTHDAY, 🎊 WORK_ANNIVERSARY, 📣 ANNOUNCEMENT, badge icon from
  `payload.badge.icon` or 👏 for RECOGNITION; relative time; LIKE 👍 and
  CELEBRATE 🎉 buttons with counts, optimistic toggle rolled back on error;
  HR "Hide" button). "Load more" uses `nextCursor`. Empty state
  "Nothing here yet.".
  `components/engagement/PollWidget.tsx`: loads `pollsApi.active()`, renders
  nothing when empty, up to 3 polls; radio + Vote; after vote re-fetch and
  show percentage bars. Dashboard: add the import and `<PollWidget />` once
  in the main column after the stat cards; update the dashboard test's mocks
  so `@/lib/api-polls` returns `{ data: [] }`.
  `app/(protected)/engagement/polls/page.tsx` (HR): create form (question,
  dynamic options 2–10, optional close date), list with counts, close,
  delete with confirm.
  Tests: feed renders items and toggles a reaction; load more appends;
  PollWidget hidden when empty, votes and shows results; polls page creates
  a poll with the DTO shape; dashboard test still green.
- [ ] **Step 8: Verify + commit.**
  `cd backend && npx jest src/modules/engagement/feed src/modules/engagement/polls src/modules/announcements`;
  `cd frontend && npx jest "src/app/\(protected\)/engagement/feed" "src/app/\(protected\)/engagement/polls" "src/app/\(protected\)/dashboard" src/components/engagement/PollWidget src/components/engagement/feed src/lib/api-feed src/lib/api-polls`;
  both tsc. Commit `feat(engagement): social feed, celebrations, polls and dashboard poll widget`.

---

## WS3: Recognition

**Owns:** `engagement/recognition/**` except `recognition.module.ts`;
frontend `app/(protected)/engagement/recognition/**`,
`components/engagement/recognition/**`, `lib/api-recognition.ts` (+test).
The Settings tab UI is WS3's; it calls `GET|PUT /engagement/settings`
(scaffold backend) through `recognitionApi.getSettings/updateSettings`.
**Consumes:** `EngagementSettingsService.get(tenantId, tx?)`,
`FeedService.post(input, tx)` / `removeBySource(..., tx)`,
`FEED_SOURCE.RECOGNITION`, `istMonthRange`, `istPeriodRange`,
`NotificationsService.createMany`.

Files (all pre-registered as empty shells by the scaffold):
`badges.service.ts` (`BadgesService`), `recognition.service.ts`
(`RecognitionService`: give, remove, wall, me),
`recognition-leaderboard.service.ts` (`RecognitionLeaderboardService`),
`recognition.controller.ts`; add `dto/recognition.dto.ts` and a spec per file.

- [ ] **Step 1: Badges, TDD.** `list(tenantId, includeInactive)`: if
  `badge.count({ where: { tenantId } }) === 0` → `createMany` the five
  defaults (`skipDuplicates: true`) first; return active (or all for HR when
  `includeInactive`) ordered by name. `create/update` (P2002 → 409),
  `deactivate` (`isActive false`, 404 missing). Tests: defaults seeded once;
  duplicate name → 409.
- [ ] **Step 2: Give, TDD.**
  ```ts
  async give(tenantId: string, giverId: string, dto: GiveRecognitionDto) {
    const recipientIds = [...new Set(dto.recipientIds)];
    if (recipientIds.includes(giverId)) throw new BadRequestException('You cannot recognise yourself');
    const recipients = await this.prisma.employee.findMany({
      where: { tenantId, id: { in: recipientIds }, status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true } });
    if (recipients.length !== recipientIds.length) throw new BadRequestException('Every recipient must be an active employee');
    const badge = dto.badgeId ? await this.prisma.badge.findFirst({ where: { id: dto.badgeId, tenantId, isActive: true } }) : null;
    if (dto.badgeId && !badge) throw new BadRequestException('Badge not found');
    const giver = await this.prisma.employee.findFirst({ where: { id: giverId, tenantId }, select: { firstName: true, lastName: true } });

    const created = await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings.get(tenantId, tx);
      const per = settings.pointsEnabled ? (dto.points ?? badge?.points ?? 0) : 0;
      const cost = per * recipientIds.length;
      if (cost > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${giverId}))`;
        const { start, end } = istMonthRange(new Date());
        const spentAgg = await tx.recognitionRecipient.aggregate({
          _sum: { points: true },
          where: { tenantId, createdAt: { gte: start, lt: end }, recognition: { giverId } } });
        const spent = spentAgg._sum.points ?? 0;
        if (spent + cost > settings.monthlyPointsAllowance)
          throw new BadRequestException(`Not enough points left this month (${Math.max(0, settings.monthlyPointsAllowance - spent)} remaining)`);
      }
      const now = new Date();
      const rec = await tx.recognition.create({ data: {
        tenantId, giverId, badgeId: badge?.id ?? null, message: dto.message.trim(), pointsPerRecipient: per, createdAt: now,
        recipients: { create: recipientIds.map(employeeId => ({ tenantId, employeeId, points: per, createdAt: now })) } } });
      await this.feed.post({ tenantId, type: 'RECOGNITION', sourceType: FEED_SOURCE.RECOGNITION, sourceId: rec.id,
        actorEmployeeId: giverId, title: `${giver?.firstName ?? 'Someone'} recognised ${names(recipients)}`,
        body: rec.message, payload: { badge: badge ? { name: badge.name, icon: badge.icon } : null, recipientIds, pointsPerRecipient: per },
        dedupeKey: `recognition:${rec.id}`, occurredAt: now }, tx);
      return rec;
    });
    void this.notifyRecipients(tenantId, recipientIds, giver, created.id);
    return created;
  }
  ```
  (`names()` = "A", "A and B", or "A, B and 2 others"). Tests: self → 400;
  inactive recipient → 400 *(Review Focus 3)*; points ignored when disabled
  (per = 0, no advisory lock); badge points used when `dto.points` absent;
  allowance exceeded → 400 with remaining count; advisory lock issued when
  cost > 0; month range from `istMonthRange` — with the clock at
  `2026-03-31T18:00:00Z` the aggregate filter is March IST, at
  `2026-03-31T19:00:00Z` April IST *(Review Focus 2; use
  `jest.useFakeTimers().setSystemTime(...)`)*; feed post called with `tx`;
  notifications sent after commit.
- [ ] **Step 3: Delete, wall, me, TDD.** `remove(tenantId, id)`: 404
  missing; in one tx `feed.removeBySource(tenantId, 'Recognition', id, tx)`
  then `recognition.delete`. `wall(tenantId, { page, limit, employeeId? })`
  newest first, include giver/badge/recipients with employee names.
  `me(tenantId, employeeId)`: `pointsEnabled`, `allowance`,
  `spentThisMonth` (same aggregate as give), `remainingThisMonth =
  max(0, allowance − spent)`, `receivedPointsTotal`, `receivedCountTotal`.
- [ ] **Step 4: Leaderboard, TDD.** `leaderboard(tenantId, period)`:
  `istPeriodRange(period, new Date())`; `recognitionRecipient.groupBy({ by:
  ['employeeId'], where: { tenantId, createdAt range }, _sum: { points },
  _count: { _all } })`; join employees (name, code, department name); sort
  by points desc when `pointsEnabled` else count desc, ties by count then
  full name; top 20 with `rank`. Tests: ordering by points vs by count;
  `all` passes no date filter; invalid period → 400 (controller
  `@IsIn`).
- [ ] **Step 5: Controller, TDD.** Routes:
  `GET /engagement/recognition` (wall), `POST /engagement/recognition`,
  `GET /engagement/recognition/me`, `GET /engagement/recognition/leaderboard`,
  `GET /engagement/recognition/badges` (`includeInactive` honoured only for
  HR/SUPER), `POST|PUT|DELETE /engagement/recognition/badges[/:id]`
  (HR/SUPER), `DELETE /engagement/recognition/:id` (HR/SUPER). Static
  segments (`me`, `leaderboard`, `badges`) before `:id`. DTO
  `GiveRecognitionDto { recipientIds: IsUUID[] (1-10), message (1-1000),
  badgeId?, points? (IsInt 0-1000) }`. Spec: role metadata; give without
  `employeeId` → 400 *(Review Focus 5)*.
- [ ] **Step 6: Frontend client, TDD.** `lib/api-recognition.ts`:
  `recognitionApi.wall, give, me, leaderboard, badges, createBadge,
  updateBadge, deactivateBadge, remove, getSettings, updateSettings`, types
  `Recognition`, `Badge`, `RecognitionSummary`, `LeaderboardRow`,
  `EngagementSettings`. URL/method/payload tests.
- [ ] **Step 7: Page, TDD.** `app/(protected)/engagement/recognition/page.tsx`
  with tabs Wall, Leaderboard, Badges (HR), Settings (HR);
  `components/engagement/recognition/GiveRecognitionModal.tsx` (employee
  multi-select from `employeesApi` in `@/lib/api` excluding self, badge
  picker, message, points input shown only when `pointsEnabled`, "N points
  left this month"); `RecognitionCard.tsx`; `LeaderboardTable.tsx`;
  `BadgeManager.tsx`; `EngagementSettingsForm.tsx`. Tests: wall renders;
  modal submits the DTO; points input hidden when disabled; leaderboard
  period switch refetches; Badges/Settings tabs hidden for EMPLOYEE.
- [ ] **Step 8: Verify + commit.**
  `cd backend && npx jest src/modules/engagement/recognition`;
  `cd frontend && npx jest "src/app/\(protected\)/engagement/recognition" src/components/engagement/recognition src/lib/api-recognition`;
  both tsc. Commit `feat(engagement): recognition, badges, points and leaderboard`.

---

## WS4: One-on-ones

**Owns:** `engagement/one-on-ones/**` except `one-on-ones.module.ts`;
frontend `app/(protected)/one-on-ones/**`, `components/one-on-ones/**`,
`lib/api-one-on-ones.ts` (+test).
**Consumes:** `NotificationsService.notifyEmployee`.

Files: `one-on-ones.service.ts`, `one-on-ones.controller.ts`,
`dto/one-on-one.dto.ts` (+specs).

- [ ] **Step 1: Access helper, TDD.**
  ```ts
  private async getForParticipant(tenantId: string, employeeId: string, id: string) {
    const m = await this.prisma.oneOnOneMeeting.findFirst({
      where: { id, tenantId, OR: [{ managerId: employeeId }, { employeeId }] } });
    if (!m) throw new NotFoundException('One-on-one not found');
    return m;
  }
  ```
  Every method except `create`, `list`, `counterparts`, `openItems` starts
  with it. Test: HR_ADMIN caller who is not a participant → 404.
- [ ] **Step 2: Create, TDD.** Load `me` and `counterpart` (`employee.findFirst
  where { id, tenantId }`, counterpart must be `status ACTIVE` else 404).
  Role: `counterpart.managerId === employeeId` → manager = me; else
  `me.managerId === counterpartId` → manager = counterpart; else 403 with the
  spec message. Create with `createdById = employeeId`. After commit,
  `notifyEmployee(tenantId, otherId, ONE_ON_ONE_SCHEDULED, 'One-on-one scheduled',
  '<Name> scheduled a one-on-one for <date>', '/one-on-ones/<id>')` in
  try/catch. Tests: as manager; as report; unrelated → 403; self as
  counterpart → 400.
- [ ] **Step 3: Get, update, TDD.** `get` returns meeting, counterpart
  summary, `myRole` (`MANAGER`/`REPORT`), action items ordered by
  `createdAt`, and `myPrivateNote` =
  `oneOnOnePrivateNote.findUnique({ where: { meetingId_authorId: { meetingId, authorId: employeeId } } })`
  content or null — never a query without `authorId`. `update`: fields per
  spec; `status COMPLETED` sets `completedAt`; CANCELLED → SCHEDULED → 400.
  Tests: private note query always includes the caller's `authorId`; the
  other participant's note is never returned; status rule.
- [ ] **Step 4: Action items and private note, TDD.**
  `addItem` (assignee must be `managerId` or `employeeId` else 400),
  `updateItem`/`removeItem` (item must belong to the meeting — `findFirst
  where { id, meetingId, tenantId }` → 404), `upsertPrivateNote` (trimmed
  empty → `deleteMany where { meetingId, authorId }`; else `upsert` on the
  compound unique). Tests for each rule.
- [ ] **Step 5: List, open items, counterparts, TDD.** `list(tenantId,
  employeeId, { counterpartId?, status? })` newest `scheduledAt` first with
  counterpart name and `myRole`; `openItems(tenantId, employeeId,
  counterpartId)` = undone items where the meeting is between the two (either
  direction); `counterparts(tenantId, employeeId)` = my manager (if active)
  + active direct reports (`where: { managerId: employeeId, status: 'ACTIVE' }`)
  *(Review Focus 3)*, each `{ id, firstName, lastName, employeeCode, relation: 'MANAGER'|'REPORT' }`.
- [ ] **Step 6: Controller, TDD.** Base `engagement/one-on-ones`, all
  roles: `GET /`, `POST /`, `GET /counterparts`, `GET /open-items`,
  `GET /:id`, `PATCH /:id`, `POST /:id/action-items`,
  `PATCH /:id/action-items/:itemId`, `DELETE /:id/action-items/:itemId`,
  `PUT /:id/private-note`. Static routes before `:id`. Every route guards
  `employeeId` (test one → 400, *Review Focus 5*). DTO limits per spec
  (agenda ≤ 5000, sharedNotes ≤ 20000, text ≤ 500, content ≤ 20000,
  `scheduledAt` `@IsISO8601`).
- [ ] **Step 7: Frontend client, TDD.** `lib/api-one-on-ones.ts`:
  `oneOnOnesApi.list, create, counterparts, openItems, get, update, addItem,
  updateItem, removeItem, savePrivateNote`; types `OneOnOne`,
  `OneOnOneDetail`, `ActionItem`, `Counterpart`. URL tests.
- [ ] **Step 8: Pages, TDD.** `app/(protected)/one-on-ones/page.tsx`
  (upcoming/past groups, counterpart filter, schedule modal
  `components/one-on-ones/ScheduleOneOnOneModal.tsx`);
  `app/(protected)/one-on-ones/[id]/page.tsx` (header with status actions
  Complete/Cancel, agenda + shared notes textareas with Save, action item
  checklist `components/one-on-ones/ActionItemList.tsx`, "Open items from
  earlier one-on-ones", private note editor labelled exactly
  *"Private note — only you can see this"*). Tests: list groups by date;
  schedule posts the DTO; detail saves shared notes; toggling an item calls
  `updateItem`; private note saves.
- [ ] **Step 9: Verify + commit.**
  `cd backend && npx jest src/modules/engagement/one-on-ones`;
  `cd frontend && npx jest "src/app/\(protected\)/one-on-ones" src/components/one-on-ones src/lib/api-one-on-ones`;
  both tsc. Commit `feat(engagement): one-on-one meetings with shared and private notes`.

---

## After the workstreams

1. **Per-task review** (mid-tier model) of each workstream against this plan
   and the spec. WS1's reviewer re-checks the anonymity rules line by line
   (no FK, no timestamp, no logging, answer ordering, threshold, no id in the
   submit response). WS4's reviewer checks that no query can return another
   author's private note and that HR gets 404.
2. **Whole-branch review** (most capable model): security (tenant scoping,
   `employeeId` guards, IDOR on every `:id`), the Review Focus list, and
   announcements regressions. **One fix wave.**
3. **Integrate:** `git fetch origin && git merge origin/main`; resolve
   conflicts (schema, `app.module.ts`, `Sidebar.tsx`, `prisma-mock.ts` —
   keep both sides' blocks). Rename the migration folder so its timestamp is
   newer than every migration on main; if main's schema changed, regenerate
   the SQL from the new `origin/main` schema.
4. **Full verification (once):** `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`;
   `cd frontend && npx jest && npx tsc --noEmit && npm run build`.
5. **PR** to `main` listing the changes outside the Wave E area
   (announcements feed hook, dashboard `PollWidget`, shared-file blocks) and
   the anonymity residual risk. Then stop — the user merges and applies the
   migration.
