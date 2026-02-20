# Zoho People Feature Parity - Implementation Plan

**Date**: 2026-02-11
**Target**: Close 20 feature gaps against Zoho People
**Approach**: Full stack (backend + frontend) per feature

## Wave 1: Quick Wins (8 features, low complexity)

### 1.1 Attendance Regularization
- **What**: Employees request corrections for missed clock-in/out
- **Schema**: New `AttendanceRegularization` model (PENDING/APPROVED/REJECTED)
- **Pattern**: Reuse ChangeRequest pattern (oldValue/newValue + approval workflow)
- **Backend**: `regularization.controller.ts` + `regularization.service.ts` in attendance module
- **Frontend**: New section on attendance page + admin approval page
- **Notification**: ATTENDANCE_REGULARIZATION_APPROVED/REJECTED

### 1.2 Compensatory Off (Comp-Off)
- **What**: Employees who work on holidays/weekends earn comp-off leave
- **Schema**: New `CompOffRequest` model linked to attendance date
- **Pattern**: Approval workflow (like leave requests)
- **Backend**: New endpoints in leave module
- **Frontend**: Request comp-off from attendance page, view in leave balances
- **Logic**: On approval, credit comp-off balance to leave balance

### 1.3 Half-Day Leave
- **What**: Allow half-day leave requests (0.5 days)
- **Schema**: Add `isHalfDay` boolean + `halfDayPeriod` enum (FIRST_HALF/SECOND_HALF) to LeaveRequest
- **Backend**: Update leave service calculation, balance deduction = 0.5
- **Frontend**: Toggle on leave request form
- **No new module needed**

### 1.4 Letter Templates
- **What**: HR generates offer/appointment/increment letters from templates
- **Schema**: New `LetterTemplate` model (name, type, content with placeholders)
- **Pattern**: Template → Instance (like onboarding templates)
- **Backend**: CRUD for templates + generate endpoint (replaces {{firstName}}, {{designation}}, etc.)
- **Frontend**: Admin template management + generate letter modal on employee page

### 1.5 Document Expiry Alerts
- **What**: Notify when employee documents are expiring
- **Schema**: No new models - use existing `EmployeeDocument.expiryDate`
- **Backend**: New endpoint to check expiring docs + cron/manual trigger
- **Frontend**: Dashboard widget showing expiring documents
- **Notification**: DOCUMENT_EXPIRING

### 1.6 Continuous Feedback
- **What**: Standalone feedback between employees (not tied to review cycles)
- **Schema**: New `Feedback` model (senderId, receiverId, content, type, visibility)
- **Pattern**: Standalone (simpler than review workflow)
- **Backend**: New feedback module
- **Frontend**: Give/receive feedback page, team feedback view for managers

### 1.7 Performance Improvement Plan (PIP)
- **What**: Formal PIP tracking for underperforming employees
- **Schema**: New `ImprovementPlan` model (employeeId, managerId, goals, duration, status)
- **Pattern**: Status workflow (DRAFT → ACTIVE → COMPLETED/EXTENDED/TERMINATED)
- **Backend**: New PIP module
- **Frontend**: Manager creates PIP, employee views, status tracking

### 1.8 Webhooks
- **What**: External integrations can subscribe to HRMS events
- **Schema**: New `Webhook` model (url, events[], secret, isActive)
- **Backend**: Webhook registration CRUD + event dispatcher service
- **Frontend**: Admin webhook configuration page
- **Events**: employee.created, leave.approved, attendance.clocked_in, etc.

---

## Wave 2: Core HR Operations (4 features, medium complexity)

### 2.1 HR Case Management (Helpdesk)
- **What**: Employees submit HR queries/tickets, assigned to HR team members
- **Schema**:
  - `HrTicketCategory` (name, code, slaHours, isActive)
  - `HrTicket` (employeeId, categoryId, subject, description, priority, status, assignedToId, slaDeadline)
  - `HrTicketComment` (ticketId, authorId, content, isInternal)
- **Statuses**: OPEN → IN_PROGRESS → WAITING_ON_EMPLOYEE → RESOLVED → CLOSED
- **Pattern**: Like leave requests but with assignment + comments + SLA
- **Backend**: New helpdesk module with CRUD + assignment + SLA tracking
- **Frontend**: Employee ticket portal + HR admin dashboard with assignment

### 2.2 Custom Workflow Engine
- **What**: Configurable approval chains for different request types
- **Schema**:
  - `WorkflowDefinition` (name, entityType, steps JSON)
  - Steps: [{stepOrder, approverType: MANAGER|HR_ADMIN|SPECIFIC_USER, approverUserId?}]
- **Pattern**: Template-based (reuse onboarding template pattern)
- **Backend**: Workflow engine service that routes approvals through configured steps
- **Frontend**: Admin workflow builder page

### 2.3 Travel Requests
- **What**: Employees request travel with itinerary, advances, per diem
- **Schema**:
  - `TravelRequest` (employeeId, purpose, fromDate, toDate, destination, estimatedCost, status, advanceAmount)
- **Pattern**: Approval workflow (DRAFT → SUBMITTED → APPROVED → COMPLETED)
- **Backend**: New travel module
- **Frontend**: Travel request form + approvals page
- **Integration**: Link to expense claims for post-travel settlement

### 2.4 Scheduled Reports
- **What**: Auto-generate and email reports on schedule
- **Schema**:
  - `ScheduledReport` (name, reportType, parameters JSON, schedule CRON, recipients[], isActive)
  - `ReportExecution` (scheduledReportId, status, generatedAt, fileUrl)
- **Backend**: Cron-triggered report generation + email delivery
- **Frontend**: Admin schedule configuration page

---

## Wave 3: Talent & Engagement (8 features, medium-high complexity)

### 3.1 LMS - Page Layout Only (Admin/SuperAdmin)
- **What**: Course catalog management shell (content implementation later)
- **Schema**:
  - `Course` (title, description, category, duration, isPublished, isActive)
  - `CourseModule` (courseId, title, sortOrder)
  - `CourseEnrollment` (courseId, employeeId, status, progress, completedAt)
- **Frontend**: Admin page with course CRUD, enrollment management placeholder
- **Backend**: Basic CRUD endpoints

### 3.2 360-Degree Feedback
- **What**: Add peer reviewers to existing performance review system
- **Schema**:
  - `PeerReview` (reviewId, reviewerId, rating, comments, submittedAt)
  - Add `peerReviews` relation to PerformanceReview
- **Pattern**: Extend existing performance module
- **Backend**: Add peer nomination + peer review submission endpoints
- **Frontend**: Add peer review section to performance review page

### 3.3 9-Box Matrix
- **What**: Talent grid plotting performance vs potential
- **Schema**: Add `potentialRating` field to PerformanceReview
- **Backend**: New analytics endpoint that returns 9-box grid data
- **Frontend**: Interactive 9-box grid visualization on admin/performance page
- **No new module** - extends performance

### 3.4 Competency Framework
- **What**: Define competencies per role and assess employees
- **Schema**:
  - `Competency` (name, description, category)
  - `RoleCompetency` (designation, competencyId, expectedLevel)
  - `EmployeeCompetency` (employeeId, competencyId, currentLevel, assessedAt)
- **Backend**: New competency module
- **Frontend**: Admin competency management + employee competency view

### 3.5 Employee Surveys
- **What**: Create multi-question surveys, collect responses, view analytics
- **Schema**:
  - `Survey` (title, description, isAnonymous, status, startDate, endDate)
  - `SurveyQuestion` (surveyId, questionText, questionType, options JSON, sortOrder)
  - `SurveyResponse` (surveyId, employeeId, submittedAt)
  - `SurveyAnswer` (responseId, questionId, answerText, selectedOptions JSON, rating)
- **Question types**: TEXT, SINGLE_CHOICE, MULTI_CHOICE, RATING (1-5), NPS (0-10)
- **Backend**: New survey module
- **Frontend**: Admin survey builder + employee survey form + analytics dashboard

### 3.6 Polls
- **What**: Quick single-question polls with real-time results
- **Schema**:
  - `Poll` (question, options JSON, isAnonymous, expiresAt, isActive)
  - `PollVote` (pollId, employeeId, selectedOption)
- **Backend**: Create poll + vote + results endpoints
- **Frontend**: Poll widget on dashboard + admin poll management

### 3.7 Peer Recognition (Kudos)
- **What**: Employees give peer-to-peer appreciation with badges
- **Schema**:
  - `RecognitionBadge` (name, icon, description, isActive) - admin configured
  - `Recognition` (senderId, receiverId, badgeId, message, isPublic)
- **Backend**: New recognition module
- **Frontend**: Give recognition modal + recognition feed/wall + leaderboard

### 3.8 Social Feed / Activity Wall
- **What**: Company-wide feed showing recognitions, announcements, birthdays
- **Schema**: No new models - aggregation of:
  - Recent recognitions (from 3.7)
  - Active announcements (existing)
  - Birthday/work anniversary alerts (from Employee.dateOfBirth/joinDate)
- **Backend**: Aggregation endpoint combining multiple data sources
- **Frontend**: Activity feed component on dashboard

---

## Implementation Order (Recommended)

**Session 1 (Wave 1A)**: Half-day leave + Attendance regularization + Comp-off + Doc expiry alerts
**Session 2 (Wave 1B)**: Continuous feedback + PIP + Letter templates + Webhooks
**Session 3 (Wave 2A)**: HR Case Management + Travel requests
**Session 4 (Wave 2B)**: Custom workflows + Scheduled reports
**Session 5 (Wave 3A)**: Surveys + Polls + Recognition + Social feed
**Session 6 (Wave 3B)**: 360 feedback + 9-box + Competency framework + LMS layout

---

## New Prisma Models Summary

| Model | New/Extended | Module |
|-------|-------------|--------|
| AttendanceRegularization | New | attendance |
| CompOffRequest | New | leave |
| LeaveRequest (halfDay fields) | Extended | leave |
| LetterTemplate | New | letters |
| LetterGenerated | New | letters |
| Feedback | New | feedback |
| ImprovementPlan | New | pip |
| ImprovementPlanGoal | New | pip |
| Webhook | New | webhooks |
| WebhookLog | New | webhooks |
| HrTicketCategory | New | helpdesk |
| HrTicket | New | helpdesk |
| HrTicketComment | New | helpdesk |
| WorkflowDefinition | New | workflows |
| TravelRequest | New | travel |
| ScheduledReport | New | reports |
| ReportExecution | New | reports |
| Course | New | lms |
| CourseModule | New | lms |
| CourseEnrollment | New | lms |
| PeerReview | New | performance |
| PerformanceReview (potential) | Extended | performance |
| Competency | New | competency |
| RoleCompetency | New | competency |
| EmployeeCompetency | New | competency |
| Survey | New | engagement |
| SurveyQuestion | New | engagement |
| SurveyResponse | New | engagement |
| SurveyAnswer | New | engagement |
| Poll | New | engagement |
| PollVote | New | engagement |
| RecognitionBadge | New | recognition |
| Recognition | New | recognition |

## New NotificationType Values

- ATTENDANCE_REGULARIZATION_APPROVED
- ATTENDANCE_REGULARIZATION_REJECTED
- COMP_OFF_APPROVED
- COMP_OFF_REJECTED
- DOCUMENT_EXPIRING
- FEEDBACK_RECEIVED
- PIP_CREATED
- PIP_UPDATED
- TICKET_CREATED
- TICKET_ASSIGNED
- TICKET_RESOLVED
- TRAVEL_APPROVED
- TRAVEL_REJECTED
- SURVEY_PUBLISHED
- RECOGNITION_RECEIVED

## New Sidebar Navigation Items

```
Engagement (all users)
  ├── Surveys
  ├── Polls
  └── Recognition Wall

HR Helpdesk (all users)
  └── My Tickets

Admin section additions:
  ├── Letter Templates
  ├── HR Helpdesk (admin view)
  ├── Surveys (admin)
  ├── Polls (admin)
  ├── Recognition Badges
  ├── Competencies
  ├── LMS (admin)
  ├── Workflows
  ├── Webhooks
  └── Scheduled Reports

Approvals section additions:
  ├── Regularization
  ├── Comp-Off
  └── Travel Requests
```
