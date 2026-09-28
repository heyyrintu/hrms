# Keka Wave E — Engagement

**Date:** 2026-09-28
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave E)
**Baseline:** `main` at `77bc80a` (Waves C+D merged). Branch `feat/keka-wave-e`.
**Format reference:** `docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md`
**Neighbour:** Wave H1 (SSO, 2FA, custom roles) is built in parallel. This wave
does not touch auth code and uses only `@Roles()` + `@UseGuards(JwtAuthGuard, RolesGuard)`.

## Goal

Add the engagement surface: pulse surveys (with truly anonymous responses),
dashboard polls, recognition (badges, kudos, optional points, leaderboard), a
social feed, and one-on-one meeting notes.

With no tenant configuration, existing behaviour is unchanged. Points are off
by default. Birthdays and anniversaries appear in the feed by default.

## Product decisions (user, 2026-09-28)

| Question | Decision |
|---|---|
| One-on-one visibility | Shared notes and action items visible to both participants; one private note per participant, author-only. HR/admin cannot read either. |
| Recognition points | Tenant toggle. When on, each employee has a monthly allowance to give. Received points drive the leaderboard. No redemption. |
| Survey and poll authoring | HR_ADMIN and SUPER_ADMIN only. Everyone else responds. |
| Feed interactions | Reactions only (LIKE, CELEBRATE). No comments. |

## Conventions (all workstreams)

- Every new model has `tenantId`; every query is scoped by it. Every `@@unique`
  that is not an id includes `tenantId` or a tenant-scoped parent id.
- Errors: 400 validation or wrong state, 403 role/authorization, 404 missing
  (also for other tenants' ids and for rows the caller may not see), 409 races
  and duplicates.
- Protected controllers: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
  "All roles" = `SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE`.
- `AuthenticatedUser.employeeId` is optional. Every employee-facing route
  (respond, vote, recognise, react, one-on-ones) throws 400
  `'No employee record linked to this user'` when it is missing, before any
  Prisma `where` uses it.
- "Today" and "this month" are computed in `Asia/Kolkata`
  (`DEFAULT_ATTENDANCE_TIME_ZONE`), same as the attendance crons.
- Notifications go through `NotificationsService.createMany` /
  `notifyEmployee`, fire-and-forget after the transaction commits; failures are
  logged, never thrown.
- Backend code lives in `backend/src/modules/engagement/<area>/`. One
  `EngagementModule` (`engagement/engagement.module.ts`) imports the five area
  modules. `FeedModule` exports `FeedService`.
- Frontend API calls live in one new client file per area —
  `frontend/src/lib/api-{surveys,polls,recognition,feed,one-on-ones}.ts` — each
  exporting its API object and its response types, so parallel workstreams
  never share a client file.
- `EngagementSettingsService` (`engagement/settings/`) and the write side of the
  feed (`FeedService.post` / `removeBySource`) plus the IST date helpers are
  implemented in the scaffold, because several areas consume them. The feed's
  read side is `FeedQueryService`.

---

## E1. Pulse surveys

### Data model

```
enum SurveyStatus        { DRAFT ACTIVE CLOSED }
enum EngagementAudience  { ALL DEPARTMENT BRANCH }
enum SurveyQuestionType  { TEXT SINGLE_CHOICE MULTI_CHOICE RATING ENPS }

Survey
  id, tenantId, title, description? (Text), isAnonymous Boolean @default(false),
  status SurveyStatus @default(DRAFT),
  audienceType EngagementAudience @default(ALL),
  audienceIds String[]            -- department ids or branch ids; [] for ALL
  closesAt DateTime?, launchedAt DateTime?, closedAt DateTime?,
  createdById (Employee), createdAt, updatedAt
  @@index([tenantId, status])

SurveyQuestion
  id, tenantId, surveyId (cascade), order Int, type SurveyQuestionType,
  text String, required Boolean @default(true),
  options String[]                -- choice labels; [] for other types
  @@index([surveyId])

SurveyParticipant                 -- audience snapshot taken at launch
  id, tenantId, surveyId (cascade), employeeId, submitted Boolean @default(false)
  -- NO timestamps, by design
  @@unique([surveyId, employeeId])
  @@index([tenantId, employeeId])

SurveyResponse
  id, tenantId, surveyId (cascade),
  employeeId String?              -- null when the survey is anonymous
  submittedAt DateTime?           -- null when the survey is anonymous
  -- NO createdAt/updatedAt, by design
  @@index([surveyId])

SurveyAnswer
  id, tenantId, responseId (cascade), questionId (cascade),
  textValue String? (Text), choiceValues String[], numericValue Int?
  -- NO timestamps
  @@index([questionId])

SurveyPendingResponse              -- anonymous submissions awaiting batch release
  id, tenantId, surveyId (cascade), payload String (Text)
  -- payload = FieldEncryptionService (AES-256-GCM) ciphertext of the normalised answers
  -- NO timestamps, NO employee column
  @@index([surveyId])
```

### Rules

- **Draft editing.** HR creates a survey with its questions in one call
  (`questions[]` in the DTO) and may replace the whole question list while it
  is `DRAFT`. Any edit after launch → 400.
- **Validation.** 1–50 questions. Choice questions need 2–20 non-empty,
  distinct options. RATING is a 1–5 scale, ENPS is 0–10; neither takes options.
  `audienceIds` must be non-empty for DEPARTMENT/BRANCH, and every id must
  belong to the tenant (else 400). `closesAt`, when set, must be in the future
  at launch.
- **Launch** (`DRAFT → ACTIVE`): in one transaction, resolve the audience
  (`status = ACTIVE` employees; filtered by `departmentId in` / `branchId in`
  for DEPARTMENT/BRANCH), `createMany` one `SurveyParticipant` per employee,
  set `launchedAt`. An empty audience → 400. After commit, notify each
  participant's user (`SURVEY_LAUNCHED`, link `/engagement/surveys/<id>`).
  `isAnonymous` is frozen from this point.
- **Close** (`ACTIVE → CLOSED`): sets `closedAt`, then force-releases any
  pending anonymous responses (see *Batch release*). A survey whose `closesAt`
  has passed is treated as closed for submissions and in listings even if its
  status is still `ACTIVE`; the release cron flushes its buffer.
- **Delete**: only `DRAFT` surveys (else 400).
- **Submit** (`POST /engagement/surveys/:id/responses`), one transaction:
  1. Survey must be ACTIVE and not past `closesAt` (else 400).
  2. Validate answers against the questions: every `required` question
     answered; SINGLE_CHOICE exactly one listed option; MULTI_CHOICE ≥1 listed
     options, no duplicates; RATING integer 1–5; ENPS integer 0–10; TEXT ≤ 5000
     chars, trimmed, empty treated as unanswered; at most one answer per
     question. Unknown question ids → 400.
  3. `updateMany SurveyParticipant where { surveyId, employeeId, submitted: false }
     set submitted = true`. Count 0 → if a participant row exists, 409
     `'You have already responded'`; else 404 (not in the audience).
  4. Named survey: insert `SurveyResponse` (with `employeeId`/`submittedAt`)
     and its `SurveyAnswer`s. Anonymous survey: insert ONE
     `SurveyPendingResponse` whose `payload` is the encrypted, padded
     normalised answers (see *Payload padding*); no `SurveyResponse`/`SurveyAnswer` row is written in this
     transaction. The payload is encrypted before the transaction starts, so a
     missing `FIELD_ENCRYPTION_KEY` fails the submit with a 500 and nothing is
     written.
  5. Anonymous survey, after commit: a non-forced batch release (below). A
     release failure is logged (survey id only, no user/employee identifier)
     and never fails the submit: the submission is already recorded.
- **Batch release** (`SurveyReleaseService.release(tenantId, surveyId, { force })`),
  its own transaction that touches NO participant rows:
  1. `SELECT id FROM survey_pending_responses WHERE "surveyId" = ... AND
     "tenantId" = ... FOR UPDATE SKIP LOCKED`.
  2. Fewer than `RELEASE_BATCH_MIN = 3` locked rows and not `force`: release
     nothing.
  3. Decrypt, shuffle with a `crypto.randomInt` Fisher-Yates, insert each as a
     `SurveyResponse` (`employeeId`/`submittedAt` null) plus its answers in the
     shuffled order, delete the pending rows.
  - Triggered after each anonymous submit (non-forced), on close (forced), and
    by a cron every 15 minutes (`survey-release`, IST): forced for surveys that
    are CLOSED or past `closesAt`, non-forced for ACTIVE ones.
- **Anonymity guarantees** (anonymous surveys):
  - No column on `SurveyResponse` or `SurveyAnswer` identifies the employee or
    the submission time. `SurveyParticipant` holds only a boolean.
  - The submit route has no `@Audit()` decorator and logs nothing that pairs a
    user with a response id.
  - Every results query orders text answers by answer `id` (random UUID),
    never by insertion order.
  - Results (aggregates and text) are withheld until the survey has at least
    `MIN_ANONYMOUS_RESPONSES = 3` released responses; below that the endpoint
    returns `{ withheld: true, responseCount }` with no answer data.
  - **Transaction-id (`xmin`) side channel.** Every PostgreSQL row version
    records the id of the transaction that wrote it in the `xmin` system
    column, readable by any role with SELECT, and freezing keeps it. If the
    participant flag (which names the employee) and the response were written
    in one transaction, `JOIN ... ON r.xmin = p.xmin` would de-anonymise every
    response; two consecutive transactions would still correlate by adjacent
    ids. Hence the pending buffer: the submit transaction's only
    non-participant row is ciphertext, and responses are written later by a
    release transaction that writes no participant row and inserts at least 3
    shuffled responses at once (except a forced release after close). Every
    released row in a batch shares one `xmin` that matches no participant, and
    physical order within the batch is random. Results therefore change in
    steps of 3 or more responses, which also blunts differential reading of
    live results.
  - **Payload padding.** AES-GCM ciphertext is as long as its plaintext, so an
    unpadded pending row would leak the byte length of the answers, which
    anyone with SELECT could match against released responses. Before
    encryption the JSON is framed as `<UTF-8 byte length, 8 zero-padded
    digits>` + JSON + spaces up to a bucket of `max(8192, next multiple of
    8192 ≥ 8 + byte length)` bytes; release strips it using the length
    prefix. Every normal submission therefore encrypts to the same size. Poll
    pending votes are not padded: their payload is a fixed-length option id.
  - **Out of scope (documented residual risk):**
    - Someone holding BOTH database access AND `FIELD_ENCRYPTION_KEY` can
      decrypt submissions that are still pending and pair each with the
      participant row that shares its `xmin`. Once released, the pending row
      is deleted and the link is gone from live data.
    - A database superuser inspecting heap pages (dead tuples of deleted
      pending rows before vacuum, physical row order via `ctid`), the
      write-ahead log, or server access logs could still correlate a
      submission with its answers.
    - Anonymity is per release batch, not per survey. A plain-SELECT reader
      can infer which participants belong to a batch by comparing transaction
      ids (participants whose flag was set between two releases). A normal
      batch hides each respondent among at least 3; a forced release after
      close (or a submission that raced `close()`) may carry 1 or 2, and a
      batch of 1 names its respondent. A batch whose members all gave the
      same answer reveals that answer for each of them.
    - Payload size is coarse, not hidden: a submission whose answers exceed
      one bucket (roughly 8 KB of JSON, i.e. very long text answers) encrypts
      to a larger size, so an observer of a pending row learns which bucket
      it fell in and can narrow it to the released responses of similar size.
    The survey form's help text says "responses are not linked to you in the
    application or its data", which holds for anyone without both the
    encryption key and superuser-level page access.
- **Results** (`GET /engagement/surveys/:id/results`, HR/SUPER), for ACTIVE or
  CLOSED surveys:
  - `participantCount`, `responseCount` (released responses only),
    `responseRate` (0–100, 1 dp, from participants whose `submitted` flag is
    set, so it includes pending submissions) and, for anonymous surveys,
    `pendingCount` (submissions waiting in the buffer; 0 for named surveys).
    The results page shows "N responses are waiting to be released in a
    batch" when `pendingCount > 0`.
  - Per question: SINGLE/MULTI_CHOICE → `{ option, count }[]` in option order;
    RATING → `average` (2 dp), `distribution` for 1..5; ENPS → `promoters`
    (9–10), `passives` (7–8), `detractors` (0–6), `score` =
    round(%promoters − %detractors) as an integer −100..100, plus
    `distribution` 0..10; TEXT → `answers: string[]` (order by answer id).
  - Non-anonymous surveys additionally expose
    `GET /engagement/surveys/:id/responses` (HR/SUPER): each response with the
    employee's name, code and `submittedAt` and its answers. Anonymous → 400.
- **My surveys** (`GET /engagement/surveys/mine`, all roles): surveys where the
  caller has a participant row, with `status`, `closesAt`, `submitted`, and
  `isOpen` (ACTIVE and not past `closesAt`). `GET /engagement/surveys/:id/form`
  returns the survey and its questions to a participant (404 otherwise), plus
  `submitted`.

### API

| Method | Path | Roles |
|---|---|---|
| GET | `/engagement/surveys` (all, paginated, `status` filter) | HR, SUPER |
| POST | `/engagement/surveys` | HR, SUPER |
| GET | `/engagement/surveys/mine` | all |
| GET | `/engagement/surveys/:id` (full, for editing) | HR, SUPER |
| PUT | `/engagement/surveys/:id` (draft only) | HR, SUPER |
| DELETE | `/engagement/surveys/:id` (draft only) | HR, SUPER |
| POST | `/engagement/surveys/:id/launch` | HR, SUPER |
| POST | `/engagement/surveys/:id/close` | HR, SUPER |
| GET | `/engagement/surveys/:id/form` | all |
| POST | `/engagement/surveys/:id/responses` | all |
| GET | `/engagement/surveys/:id/results` | HR, SUPER |
| GET | `/engagement/surveys/:id/responses` (named only) | HR, SUPER |

Route order: `mine` is declared before `:id`.

### Frontend

- `/engagement/surveys` — employees see "My surveys" (open ones first, a
  "Respond" button, "Responded" badge). HR/SUPER additionally see a "Manage"
  tab: list with status, create/edit draft (question builder with type picker,
  options editor, required toggle, anonymous toggle, audience picker for
  departments/branches, close date), launch, close, delete draft.
- `/engagement/surveys/[id]` — respond form (radio / checkboxes / 1–5 buttons /
  0–10 buttons / textarea). Anonymous surveys show the anonymity notice.
- `/engagement/surveys/[id]/results` — HR: response-rate header, per-question
  bar charts (recharts, already a dependency), eNPS gauge-style number with
  promoter/passive/detractor split, text answer list, "Results are hidden until
  3 responses" state, and a named-responses table for non-anonymous surveys.

---

## E2. Polls

### Data model

```
enum PollStatus { ACTIVE CLOSED }

Poll
  id, tenantId, question String, status PollStatus @default(ACTIVE),
  closesAt DateTime?, closedAt DateTime?, createdById (Employee), createdAt, updatedAt
  @@index([tenantId, status])

PollOption
  id, tenantId, pollId (cascade), order Int, label String, voteCount Int @default(0)
  @@index([pollId])

PollVoter                          -- who voted; never which option
  id, tenantId, pollId (cascade), employeeId
  -- NO timestamps
  @@unique([pollId, employeeId])

PollPendingVote                    -- votes awaiting batch application
  id, tenantId, pollId (cascade), payload String (Text)
  -- payload = FieldEncryptionService ciphertext of the chosen optionId
  -- NO timestamps, NO employee column
  @@index([pollId])
```

### Rules

- Polls are single-choice, always anonymous, visible to the whole tenant, and
  published on create (no draft). 2–10 distinct non-empty options.
- **Vote**, one transaction: poll ACTIVE and not past `closesAt` (else 400);
  option belongs to the poll (else 400); `create PollVoter` — unique violation
  (P2002) → 409 `'You have already voted'`; then `create PollPendingVote`
  with the encrypted `optionId`. No option row is written in the vote
  transaction: an option's `voteCount` update would share `xmin` with the
  voter's `PollVoter` row and name the latest voter's choice. Votes are final.
- **Batch count application** (`PollReleaseService.release(tenantId, pollId, { force })`),
  same rules as the survey release: lock pending rows `FOR UPDATE SKIP LOCKED`;
  fewer than 3 and not forced: nothing; otherwise decrypt, group by option,
  `voteCount increment` per option, delete the pending rows. Triggered after
  each vote (non-forced), on close (forced), and by a 15-minute cron
  (`poll-release`, IST; forced for CLOSED or expired polls). Residual risk as
  for surveys: database access plus the encryption key decrypts still-pending
  votes, and anonymity is per batch — a forced batch of 1 at close names its
  voter's choice (each option row keeps the transaction id of the last batch
  that changed it), and on a two-option poll a batch of 3 is often unanimous.
- **Results visibility:** a caller who has voted, or HR/SUPER, or anyone once
  the poll is closed, sees `voteCount` per option and `totalVotes` (applied
  votes only) plus `pendingVotes` (votes not yet applied); otherwise counts are
  omitted (`null`). The UI shows "Some votes are still being counted" when
  `pendingVotes > 0`.
- HR/SUPER: create, close, delete (any status; cascades).

### API

| Method | Path | Roles |
|---|---|---|
| GET | `/engagement/polls/active` (open polls, each with `hasVoted` and results per visibility rule) | all |
| GET | `/engagement/polls` (all, paginated) | HR, SUPER |
| POST | `/engagement/polls` | HR, SUPER |
| POST | `/engagement/polls/:id/vote` `{ optionId }` | all |
| POST | `/engagement/polls/:id/close` | HR, SUPER |
| DELETE | `/engagement/polls/:id` | HR, SUPER |

### Frontend

- `PollWidget` (`frontend/src/components/engagement/PollWidget.tsx`) on the
  dashboard page: shows up to 3 active polls; radio + "Vote" before voting,
  percentage bars after. Renders nothing when there are no active polls.
  The dashboard change is one import and one `<PollWidget />` line.
- `/engagement/polls` (HR/SUPER): create form, list with results, close, delete.

---

## E3. Recognition

### Data model

```
Badge
  id, tenantId, name String, description String?, icon String   -- an emoji
  points Int @default(0), isActive Boolean @default(true), createdAt, updatedAt
  @@unique([tenantId, name])

Recognition
  id, tenantId, giverId (Employee), badgeId String? (Badge, SetNull),
  message String (Text), pointsPerRecipient Int @default(0), createdAt
  @@index([tenantId, createdAt])
  @@index([giverId, createdAt])

RecognitionRecipient
  id, tenantId, recognitionId (cascade), employeeId, points Int @default(0), createdAt
  @@unique([recognitionId, employeeId])
  @@index([tenantId, employeeId, createdAt])

EngagementSettings
  id, tenantId @unique,
  pointsEnabled Boolean @default(false),
  monthlyPointsAllowance Int @default(100),
  showBirthdays Boolean @default(true),
  showAnniversaries Boolean @default(true),
  createdAt, updatedAt
```

`RecognitionRecipient.createdAt` copies the recognition time so leaderboard
queries filter one table.

### Rules

- **Default badges.** `GET /engagement/recognition/badges` creates, when the
  tenant has no badges at all, five defaults (createMany, skipDuplicates):
  Team Player 🤝 10, Above and Beyond 🚀 20, Customer Hero 🏆 20,
  Innovator 💡 15, Thank You 🙏 5.
- **Badge CRUD** (HR/SUPER): name 1–50 chars unique per tenant (409), icon
  1–8 chars, points 0–1000. Delete = set `isActive = false` (history keeps it).
- **Give** (`POST /engagement/recognition`), all roles:
  - `recipientIds` 1–10 distinct active employees of the tenant (else 400);
    must not include the giver (400 `'You cannot recognise yourself'`).
  - `message` 1–1000 chars. `badgeId` optional; must be an active tenant badge.
  - Points per recipient: when `pointsEnabled` is false → 0 (any `points` in
    the DTO is ignored). When true → `dto.points` if given (0–1000), else the
    badge's points, else 0.
  - Allowance: cost = pointsPerRecipient × recipient count. Inside the
    transaction, first `SELECT pg_advisory_xact_lock(hashtext(<giverId>))`,
    then `spent` = sum of `RecognitionRecipient.points` of recognitions by this
    giver with `createdAt` in the current IST calendar month. If
    `spent + cost > monthlyPointsAllowance` → 400
    `'Not enough points left this month (N remaining)'`.
  - Writes the recognition and recipients, then (same transaction) posts a
    feed item via `FeedService.post(..., tx)` (see E4). After commit, notify
    each recipient (`RECOGNITION_RECEIVED`, link `/engagement/recognition`).
- **Delete** (HR/SUPER): deletes the recognition (cascade recipients; the
  allowance is thereby refunded) and removes its feed item in the same
  transaction.
- **Wall** (`GET /engagement/recognition`, all roles): paginated newest first,
  optional `employeeId` filter (recognitions received by that employee); each
  item has giver, recipients, badge, message, points, createdAt.
- **My summary** (`GET /engagement/recognition/me`): `pointsEnabled`,
  `allowance`, `spentThisMonth`, `remainingThisMonth`, `receivedPointsTotal`,
  `receivedCountTotal`.
- **Leaderboard** (`GET /engagement/recognition/leaderboard?period=month|quarter|year|all`):
  group `RecognitionRecipient` by `employeeId` within the IST period; rank by
  points received (desc) when `pointsEnabled`, else by count received; ties by
  count then name. Top 20 with employee name, code, department, points, count.
- **Settings** (`GET` all roles, `PUT` HR/SUPER) at
  `/engagement/settings`: upsert on first write; GET returns defaults when no
  row exists. `monthlyPointsAllowance` 0–100000.

### Frontend

`/engagement/recognition` with tabs:
- **Wall** — "Give recognition" button (modal: multi-select employees, badge
  picker, message, points input only when points are on, remaining allowance
  shown), recognition cards.
- **Leaderboard** — period switcher, ranked table.
- **Badges** (HR/SUPER) — list, create/edit, deactivate.
- **Settings** (HR/SUPER) — points toggle and allowance, birthday/anniversary
  toggles.

---

## E4. Social feed

### Data model

```
FeedItem
  id, tenantId,
  type String                     -- one of FEED_ITEM_TYPES (code constant)
  sourceType String               -- e.g. 'Recognition', 'Announcement', 'Employee'
  sourceId String?
  actorEmployeeId String?         -- who did it (giver, author)
  subjectEmployeeId String?       -- who it is about (birthday person)
  title String, body String? (Text), payload Json @default("{}"),
  dedupeKey String, occurredAt DateTime, isHidden Boolean @default(false), createdAt
  @@unique([tenantId, dedupeKey])
  @@index([tenantId, occurredAt])
  @@index([tenantId, sourceType, sourceId])

enum FeedReactionKind { LIKE CELEBRATE }

FeedReaction
  id, tenantId, feedItemId (cascade), employeeId, kind FeedReactionKind, createdAt
  @@unique([feedItemId, employeeId, kind])
```

`actorEmployeeId` / `subjectEmployeeId` are plain strings (no FK) so producers
from later waves never need a relation change; the service joins names.

### FeedService contract (frozen in the scaffold)

```ts
export const FEED_ITEM_TYPES = ['RECOGNITION', 'ANNOUNCEMENT', 'BIRTHDAY', 'WORK_ANNIVERSARY'] as const;
export type FeedItemType = (typeof FEED_ITEM_TYPES)[number];

export interface PostFeedItemInput {
  tenantId: string;
  type: FeedItemType;
  sourceType: string;
  sourceId?: string | null;
  actorEmployeeId?: string | null;
  subjectEmployeeId?: string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey: string;          // idempotency key, unique per tenant
  occurredAt?: Date;          // default now
}

class FeedService {
  post(input: PostFeedItemInput, tx?: Prisma.TransactionClient): Promise<{ id: string; created: boolean }>;
  removeBySource(tenantId: string, sourceType: string, sourceId: string, tx?): Promise<number>;
}
```

`post` is idempotent: on an existing `dedupeKey` it returns the existing id with
`created: false` (upsert with empty update). An unknown `type` throws an
`Error` (programming error). Wave F adds `'GOAL_COMPLETED'` to the constant.

### Producers

| Type | Producer | dedupeKey | Payload |
|---|---|---|---|
| RECOGNITION | recognition give (same tx) | `recognition:<id>` | `{ badge: {name, icon} \| null, recipientIds, pointsPerRecipient }` |
| ANNOUNCEMENT | announcements create/update when it becomes published | `announcement:<id>` | `{ priority }` |
| BIRTHDAY | daily cron | `birthday:<employeeId>:<yyyy>` | `{}` (never the birth year) |
| WORK_ANNIVERSARY | daily cron | `anniversary:<employeeId>:<yyyy>` | `{ years }` |

- **Announcements (outside the wave's area, minimal):** `AnnouncementsModule`
  imports `FeedModule`. In `AnnouncementsService`: after `create` with
  `isPublished`, and after `update` that newly publishes, call `feed.post`
  (title = announcement title, body = content truncated to 500 chars,
  `actorEmployeeId` = authorId, `occurredAt` = publishedAt). After `update` that
  sets `isPublished: false`, and in `delete`, call `feed.removeBySource(tenantId,
  'Announcement', id)`. Feed errors are caught and logged (never fail the
  announcement write).
- **Celebrations cron:** `FeedCelebrationsCronService`, `@Cron('10 0 * * *',
  { name: 'feed-celebrations', timeZone: 'Asia/Kolkata' })`, calls
  `FeedCelebrationsService.runForAllTenants(today)` where `today` is the IST
  date. Per tenant (read settings; skip a type when its toggle is off):
  - Birthdays: active employees whose `dateOfBirth` month/day equals today's;
    in a non-leap year on 28 Feb, also those born 29 Feb. Title
    `"Happy birthday, <First>!"`.
  - Anniversaries: active employees whose `joinDate` (IST date) month/day equals
    today's (same 29 Feb rule) and whose `years = todayYear − joinYear ≥ 1`.
    Title `"<First> <Last> completes <n> year(s) with us"`.
  - Month/day matching is done in application code over the tenant's active
    employees (select id, names, dateOfBirth, joinDate), one tenant at a time;
    a failing tenant is logged and skipped.
  - `occurredAt` = the IST midnight of today as UTC. Idempotent via dedupeKey.

### Reading

- `GET /engagement/feed?cursor=<id>&limit=20` (all roles): items with
  `isHidden = false`, newest `occurredAt` first then `id` desc; cursor is the
  last item id (keyset on `(occurredAt, id)`). BIRTHDAY / WORK_ANNIVERSARY
  items are filtered out when the matching setting is off. Each item carries
  `actor` and `subject` `{ id, firstName, lastName, profilePhoto? }` (null when
  absent or not found), `reactionCounts { LIKE, CELEBRATE }` and
  `myReactions: kind[]`. Response `{ items, nextCursor | null }`. `limit` 1–50.
- `POST /engagement/feed/:id/reactions` `{ kind }` (all roles): toggle — create
  if absent, delete if present. Returns the item's new counts and
  `myReactions`. Hidden or other-tenant item → 404.
- `POST /engagement/feed/:id/hide` (HR/SUPER): sets `isHidden = true`.

### Frontend

`/engagement/feed`: card per item with an icon per type (🎉 birthday, 🎊
anniversary, 📣 announcement, badge icon for recognition), relative time,
reaction buttons with counts (optimistic toggle), "Load more", HR "Hide" menu.

---

## E5. One-on-ones

### Data model

```
enum OneOnOneStatus { SCHEDULED COMPLETED CANCELLED }

OneOnOneMeeting
  id, tenantId, managerId (Employee), employeeId (Employee),
  scheduledAt DateTime, status OneOnOneStatus @default(SCHEDULED),
  agenda String? (Text), sharedNotes String? (Text),
  createdById (Employee), completedAt DateTime?, createdAt, updatedAt
  @@index([tenantId, managerId, scheduledAt])
  @@index([tenantId, employeeId, scheduledAt])

OneOnOneActionItem
  id, tenantId, meetingId (cascade), text String, assigneeId (Employee),
  isDone Boolean @default(false), dueDate DateTime? @db.Date, createdAt, updatedAt
  @@index([meetingId])

OneOnOnePrivateNote
  id, tenantId, meetingId (cascade), authorId (Employee), content String (Text),
  createdAt, updatedAt
  @@unique([meetingId, authorId])
```

### Rules

- **Participants** are the stored `managerId` and `employeeId`. Access to a
  meeting, its action items and anything under it requires
  `user.employeeId ∈ {managerId, employeeId}`; everyone else — including
  HR_ADMIN and SUPER_ADMIN — gets 404. Stored participants keep access after a
  reporting-line change.
- **Create** (`POST /engagement/one-on-ones`, all roles) with `counterpartId`:
  - If `counterpart.managerId === user.employeeId` → caller is manager.
  - Else if `me.managerId === counterpartId` → caller is the report.
  - Else 403 `'You can only schedule one-on-ones with your manager or direct reports'`.
  - Counterpart must be an active tenant employee (404 otherwise).
    `scheduledAt` required; `agenda` optional (≤ 5000 chars).
  - After commit, notify the other participant (`ONE_ON_ONE_SCHEDULED`, link
    `/one-on-ones/<id>`).
- **Update** (`PATCH /engagement/one-on-ones/:id`, participants): `scheduledAt`,
  `agenda`, `sharedNotes` (≤ 20000 chars), `status`. Setting `COMPLETED` sets
  `completedAt`; `CANCELLED` and `COMPLETED` meetings still accept notes;
  a `CANCELLED` meeting cannot be set back to `SCHEDULED` (400).
- **Action items** (participants): create `{ text ≤ 500, assigneeId ∈
  participants, dueDate? }`, update `{ text?, isDone?, dueDate? }`, delete.
- **Private note** (`PUT /engagement/one-on-ones/:id/private-note`
  `{ content ≤ 20000 }`, participants): upsert on `(meetingId, authorId =
  user.employeeId)`. Empty content deletes the note. `GET` of the meeting
  returns only the caller's own private note as `myPrivateNote`; no endpoint
  ever returns another author's note.
- **List** (`GET /engagement/one-on-ones?counterpartId=&status=`): meetings
  where the caller is a participant, newest `scheduledAt` first, with the
  counterpart's name and the caller's role in it (`MANAGER` | `REPORT`).
- **Open items** (`GET /engagement/one-on-ones/open-items?counterpartId=`):
  undone action items across all meetings of the caller with that counterpart.
- **Counterparts** (`GET /engagement/one-on-ones/counterparts`): the caller's
  manager (if any) and active direct reports, for the "schedule" picker.
- Route order: `open-items` and `counterparts` before `:id`.

### Frontend

- `/one-on-ones` — list grouped as upcoming / past, filter by counterpart,
  "Schedule one-on-one" modal (counterpart picker, date-time, agenda).
- `/one-on-ones/[id]` — header (counterpart, time, status actions), agenda and
  shared notes editors (explicit Save), action item checklist (add, toggle,
  assignee, due date, delete), open items carried from earlier meetings with
  this person, and a "Private note — only you can see this" editor.

---

## Shared changes

- **`schema.prisma`**: one contiguous "ENGAGEMENT (Wave E)" block with all enums
  and models above; back-relation fields on `Tenant` and `Employee` added as
  one contiguous block at the end of each model's relation list.
  `NotificationType` gains `SURVEY_LAUNCHED`, `RECOGNITION_RECEIVED`,
  `ONE_ON_ONE_SCHEDULED` appended at the end.
- **Migration**: `backend/prisma/migrations/<ts>_keka_wave_e/migration.sql`,
  generated with `prisma migrate diff` from `origin/main`'s schema. Never run
  against the database.
- **`app.module.ts`**: import `EngagementModule`.
- **`backend/src/test/helpers/prisma-mock.ts`**: append the new model
  delegates (`survey`, `surveyQuestion`, `surveyParticipant`, `surveyResponse`,
  `surveyAnswer`, `poll`, `pollOption`, `pollVoter`, `badge`, `recognition`,
  `recognitionRecipient`, `engagementSettings`, `feedItem`, `feedReaction`,
  `oneOnOneMeeting`, `oneOnOneActionItem`, `oneOnOnePrivateNote`) and
  `$executeRaw` if absent.
- **`Sidebar.tsx`**: one "Engagement" group — Feed, Recognition, Surveys,
  One-on-ones (all roles); Polls (HR/SUPER).
- **Dashboard page**: `<PollWidget />` (one import, one line).
- **Announcements module/service**: feed hook as described in E4.

## Testing

- Backend: a service spec and a controller spec per area (role metadata,
  `employeeId` guard, delegation). Key cases:
  - Surveys: launch snapshots audience by department/branch; submit twice → 409;
    non-participant → 404; anonymous submit writes `employeeId: null` and no
    `submittedAt`; results withheld below 3; eNPS maths (e.g. 5 promoters,
    2 passives, 3 detractors → score 20); required/invalid answers → 400;
    after `closesAt` → 400.
  - Polls: double vote (P2002) → 409; counts hidden before voting, shown after.
  - Recognition: self-recognition → 400; allowance exceeded → 400; points
    ignored when disabled; advisory lock issued; feed post and notification;
    leaderboard ranking by points vs count.
  - Feed: `post` idempotency; unknown type throws; toggle reaction create then
    delete; hidden items excluded; celebrations cron — birthday match, 29 Feb in
    a non-leap year, anniversary years ≥ 1, toggles off skip.
  - One-on-ones: create as manager / as report / unrelated → 403; HR
    non-participant → 404; private note only returned to its author;
    cancelled → scheduled → 400.
  - Announcements: publish posts a feed item; unpublish/delete removes it; feed
    failure does not fail the write.
  - Module wiring spec for `EngagementModule` with
    `.overrideProvider(PrismaService)` (CI has no `DATABASE_URL`).
- Frontend: a page test per new page and a `PollWidget` test (mock the
  `api-*` client), plus a client test per `api-*.ts` for URL/verb mapping.

## Out of scope

Recognition point redemption; comments on feed items; recurring one-on-one
series and calendar invites; survey templates, scheduling and reminders;
per-department results breakdown; poll audiences other than the whole tenant;
DB-superuser-level forensic unlinkability (see E1).
