# Keka Parity Roadmap (after Wave A)

**Date:** 2026-09-23
**Baseline:** `main` at `ced0c7b` (PR #17 merged, migration applied).
**Source:** the 2026-09-21 Keka gap analysis, the Wave A spec
(`docs/superpowers/specs/2026-09-21-keka-gap-wave-a-design.md`) and its review ledger.

Each wave below is one branch and one PR. A wave carries two to four workstreams,
not six: Wave A's six parallel workstreams cost far more in coordination and review
than the code justified. Start every wave in a fresh session.

---

## Wave 0: Cleanup and loose ends (small, do first)

Things that are half-finished or known-wrong today. No new modules.

| # | Item | Why it matters | Size |
|---|---|---|---|
| 0.1 | Settlement recovers outstanding loans (`RepaymentSource.SETTLEMENT`) | A leaver with an active loan is paid out in full today | S |
| 0.2 | Apply `minHalfDayMinutes` / `minFullDayMinutes` at clock-out | Policy fields exist in the UI but do nothing | S |
| 0.3 | Night shifts: `Shift.isOvernight` + late-mark uses the shift's start day | Late marks are wrong for shifts crossing midnight | S |
| 0.4 | Loans page explains a post-tenure arrears instalment | Employees see an unexplained deduction | XS |
| 0.5 | Payroll recompute: make loan reversal and re-recording safe on mid-run failure | Balances show high until the next good run | S |
| 0.6 | Wire webhook producers: `leave.approved`, `employee.created`, `payroll.approved`, `loan.approved`, `ticket.created` | The dispatcher exists but nothing calls it | S |
| 0.7 | Payslip email on run approval (template + queue job) | Keka emails payslips; we only show them in-app | S |
| 0.8 | Product decision: HR admin with no employee record creating a PIP | Returns 400 today | XS |
| 0.9 | Deferred minors from Wave A: helpdesk category code race returns 409, `listAgents` casts, import audit write inside the transaction, template download calls the API, a URL test for the attendance-policy client, webhook body cap overshoot | Hygiene | S |
| 0.10 | Commit or discard the local `20260921070017_hrms_new` migration and `migration_lock.toml` change | Working tree noise | XS |

---

## Wave B: Workflow engine and multi-level approvals

**Why now:** every approval today is hard-coded and single-level. This is the
foundation later waves build on (loans, expenses, ATS offers, payroll maker-checker).

- `WorkflowDefinition` (entity type, ordered steps) and `WorkflowStep`
  (approver type: reporting manager, manager's manager, HR admin, specific user,
  role; optional amount or days condition).
- `ApprovalInstance` / `ApprovalAction` so each request records who approved
  which step and when.
- Delegation while an approver is on leave.
- Migrate leave, expenses, loans, comp-off, regularization to the engine behind a
  per-tenant default that reproduces today's single-level behaviour.
- Payroll maker-checker: the person who computes a run cannot approve it.
- Admin UI: workflow builder per request type; "My approvals" inbox across types.

Size: L. Depends on: nothing.

---

## Wave C: Payroll depth

Extends the strongest module, closes the most-cited Keka payroll features.

- **Arrears / retro pay:** a backdated salary revision produces arrear lines in the
  next run, with the Section 89 relief already built.
- **One-time payments:** bonus, incentive, and deduction lines attached to a run.
- **Hold / void salary:** hold an employee in a run, release later as arrears or void.
- **Reimbursements through payroll:** approved expense claims become a non-taxable
  earnings line instead of a status flip.
- **Off-cycle runs** for settlements and corrections.
- **Accounting export:** journal voucher CSV with configurable GL mapping; Tally XML
  as the first named format.
- **Payroll variance report:** this month against last, per employee and component.
- Flexible benefit plan is deferred to a later wave.

Size: L. Depends on: Wave B for maker-checker (can land without it).

---

## Wave D: Hiring (applicant tracking)

The largest whole module Keka has and this product does not.

- `JobRequisition` (approved through the Wave B engine), `JobOpening`, public
  careers page per tenant.
- `Candidate`, `Application` with configurable pipeline stages, resume upload,
  duplicate detection by email.
- Interview scheduling with panel, `InterviewFeedback` scorecards.
- `Offer` generated from the existing letter templates; accept or decline link.
- Accepted offer converts to an `Employee` and starts onboarding.
- Pre-onboarding portal: the candidate uploads documents before day one using a
  token link, no account.
- Hiring funnel report.

Size: XL (split into D1 pipeline, D2 interviews and offers, D3 careers page and
pre-onboarding). Depends on: Wave B for requisition and offer approval.

---

## Wave E: Engagement

- Pulse surveys with question types (text, choice, rating, eNPS), anonymous option,
  results dashboard.
- Polls on the dashboard.
- Recognition: badges, peer kudos, optional points, leaderboard.
- Social feed: recognitions, announcements, birthdays and work anniversaries.
- One-on-one meeting notes between manager and report.

Size: M. Depends on: nothing.

---

## Wave F: Performance depth

- Key results under goals, goal alignment and cascading (`parentGoalId`).
- 360 reviews: peer nomination and peer feedback (`PeerReview`).
- Review templates and question banks.
- Calibration view with rating distribution and override.
- 9-box grid (`potentialRating`).
- Competency framework per designation, assessed in reviews.

Size: L. Depends on: nothing; Wave E's feed can show goal completions.

---

## Wave G: Time and attendance depth

- WFH and on-duty requests with approval.
- Shift roster grid and rotation patterns.
- Selfie punch and IP-restricted web punch as tenant capture policies.
- Timesheets against projects and tasks, weekly submit and approve.
- `Project`, `ProjectMember`, billable hours; utilisation report.

Size: L. Depends on: Wave 0.3 for night shifts; Wave B for approvals.

---

## Wave H: Platform

- Single sign-on: Google and Microsoft OpenID Connect per tenant.
- Two-factor authentication with TOTP, enforceable per role.
- Granular permissions: custom roles on top of the four fixed roles.
- Custom report builder over a curated field catalogue, CSV/XLSX export.
- Scheduled reports emailed on a cron.
- Custom fields on the employee profile.
- Installable web app (manifest, service worker) and web push notifications.

Size: XL (split H1 security: SSO, 2FA, roles; H2 reporting; H3 PWA and push).
Depends on: nothing.

---

## Wave I: Remaining modules

- Asset management: assign, return, and a return step in exit clearance.
- Structured exit clearance checklist with per-department sign-off.
- Travel requests, expense advances, mileage and per-diem.
- Policy documents with read acknowledgement.
- Learning management: courses, enrolment, completion, certificates.

Size: L. Depends on: Wave B for travel approvals.

---

## Recommended order

| Order | Wave | Size | Reason |
|---|---|---|---|
| 1 | 0 Cleanup | S | Fixes wrong behaviour already shipped |
| 2 | B Workflow engine | L | Unblocks approvals in C, D, G, I |
| 3 | C Payroll depth | L | Strongest module, most-cited Keka gaps |
| 4 | D Hiring | XL | Biggest missing module for buyers |
| 5 | H1 SSO, 2FA, roles | M | Enterprise buyers ask early |
| 6 | E Engagement | M | Cheap, visible |
| 7 | F Performance depth | L | |
| 8 | G Time depth | L | |
| 9 | H2, H3, I | L | |

## How to run each wave

1. Spec the wave in `docs/superpowers/specs/`, then a plan in `docs/superpowers/plans/`.
2. One scaffold commit for shared files: schema, migration, mock-Prisma model list,
   module shells, sidebar.
3. Two to four implementers on disjoint file sets. Use the mid-tier model for
   implementers whose plan text contains the code, and for reviewers.
4. One review per task, one whole-branch review, one fix wave.
5. Apply the migration with `npx prisma migrate deploy` after merging. `DATABASE_URL`
   points at the remote server `72.60.200.116:5559`.
