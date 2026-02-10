# Database Schema Documentation

This document provides an overview of the HRMS database schema defined using Prisma ORM. For the complete schema definition with all fields, constraints, and indexes, see `backend/prisma/schema.prisma`.

## Database Provider

PostgreSQL

## Models by Domain

### Core Models

- **Tenant**: Multi-tenant organization entity that isolates all data per customer
- **User**: Authentication entity with email/password and role-based access
- **Department**: Organizational departments with hierarchical structure support
- **Employee**: Core employee entity with personal, employment, and payroll information

### Attendance Management

- **AttendanceRecord**: Daily attendance records with clock in/out times and OT calculations
- **AttendanceSession**: Multiple in/out sessions per attendance record for flexible tracking
- **OtRule**: Overtime calculation rules per employment type with thresholds and approval settings

### Leave Management

- **LeaveType**: Leave type definitions (CL, SL, PL, LOP) with carry-forward rules
- **LeaveBalance**: Employee leave balances per type and year with usage tracking
- **LeaveRequest**: Leave applications with approval workflow

### Payroll Management

- **SalaryStructure**: Reusable salary component templates (earnings/deductions)
- **EmployeeSalary**: Employee salary assignments with effective date ranges
- **PayrollRun**: Monthly payroll processing batch with status tracking
- **Payslip**: Individual employee payslips with detailed earnings/deductions breakdown

### Performance Management

- **ReviewCycle**: Performance review periods with start/end dates
- **PerformanceReview**: Employee performance reviews with self and manager ratings
- **Goal**: Individual employee goals linked to performance reviews

### Onboarding/Offboarding

- **OnboardingTemplate**: Reusable onboarding/offboarding task templates
- **OnboardingProcess**: Employee-specific onboarding/offboarding instances
- **OnboardingTask**: Individual tasks within onboarding processes with assignment and tracking

### Expense Management

- **ExpenseCategory**: Expense types with optional max amount limits
- **ExpenseClaim**: Employee expense claims with receipt uploads and approval workflow

### Documents & File Management

- **EmployeeDocument**: Employee document metadata with categories and verification status
- **Upload**: File storage metadata with S3/local storage key references

### Communication

- **Announcement**: Company-wide announcements with priority and publication controls
- **Notification**: User notifications for various system events with read status

### Self-Service

- **EmployeeChangeRequest**: Employee-initiated profile change requests with approval workflow

### Audit & Compliance

- **AuditLog**: System-wide audit trail for all data modifications

### Shift Management

- **Shift**: Shift definitions with timing and break configurations
- **ShiftAssignment**: Employee shift assignments with date ranges

### Holiday Calendar

- **Holiday**: Company/regional holidays with optional flags

## Enums

### UserRole
- SUPER_ADMIN
- HR_ADMIN
- MANAGER
- EMPLOYEE

### EmploymentType
- PERMANENT
- CONTRACT
- TEMPORARY
- INTERN

### PayType
- MONTHLY
- HOURLY

### EmployeeStatus
- ACTIVE
- INACTIVE

### AttendanceStatus
- PRESENT
- ABSENT
- HALF_DAY
- LEAVE
- WFH
- HOLIDAY

### AttendanceSource
- WEB
- MOBILE
- API
- IMPORT

### LeaveRequestStatus
- PENDING
- APPROVED
- REJECTED
- CANCELLED

### HolidayType
- NATIONAL
- REGIONAL
- COMPANY
- OPTIONAL

### DocumentCategory
- ID_PROOF
- ADDRESS_PROOF
- EDUCATION
- EMPLOYMENT
- CONTRACT
- CERTIFICATE
- TAX
- OTHER

### ChangeRequestStatus
- PENDING
- APPROVED
- REJECTED

### NotificationType
- LEAVE_APPROVED
- LEAVE_REJECTED
- OT_APPROVED
- OT_REJECTED
- CHANGE_REQUEST_APPROVED
- CHANGE_REQUEST_REJECTED
- DOCUMENT_VERIFIED
- SHIFT_ASSIGNED
- ANNOUNCEMENT
- EXPENSE_APPROVED
- EXPENSE_REJECTED
- EXPENSE_REIMBURSED
- ONBOARDING_TASK_ASSIGNED
- ONBOARDING_COMPLETED
- REVIEW_CYCLE_LAUNCHED
- REVIEW_SUBMITTED
- REVIEW_COMPLETED
- GENERAL

### AnnouncementPriority
- LOW
- NORMAL
- HIGH
- URGENT

### PayrollRunStatus
- DRAFT
- PROCESSING
- COMPUTED
- APPROVED
- PAID

### ExpenseClaimStatus
- DRAFT
- SUBMITTED
- APPROVED
- REJECTED
- REIMBURSED

### OnboardingType
- ONBOARDING
- OFFBOARDING

### OnboardingProcessStatus
- NOT_STARTED
- IN_PROGRESS
- COMPLETED
- CANCELLED

### OnboardingTaskStatus
- PENDING
- IN_PROGRESS
- COMPLETED
- SKIPPED

### OnboardingTaskCategory
- IT_SETUP
- HR_PAPERWORK
- TRAINING
- COMPLIANCE
- FACILITIES
- GENERAL

### AuditAction
- CREATE
- UPDATE
- DELETE
- LOGIN

### ReviewCycleStatus
- DRAFT
- ACTIVE
- COMPLETED

### PerformanceReviewStatus
- PENDING
- SELF_REVIEW
- MANAGER_REVIEW
- COMPLETED

### GoalStatus
- NOT_STARTED
- IN_PROGRESS
- COMPLETED

## Key Relationships

### Multi-Tenancy
- **Tenant** has many Users, Employees, Departments, and all other domain records
- All records (except Tenant itself) include `tenantId` for data isolation
- Unique constraints include `tenantId` to enforce tenant-level uniqueness

### User & Authentication
- **User** belongs to one Tenant
- **User** optionally has one Employee (via `employeeId`)
- Email uniqueness enforced per tenant: `@@unique([tenantId, email])`

### Organization Structure
- **Employee** belongs to one Tenant
- **Employee** optionally belongs to one Department
- **Employee** optionally has one Manager (self-reference: `manager` and `directReports`)
- **Department** supports hierarchical structure with optional `parentId` (self-reference: `parent` and `children`)

### Attendance & Leave
- **AttendanceRecord** belongs to Employee, optional Shift
- **AttendanceSession** belongs to AttendanceRecord (cascade delete)
- **LeaveRequest** belongs to Employee, LeaveType, and optionally Approver (Employee)
- **LeaveBalance** links Employee and LeaveType for a specific year

### Payroll
- **EmployeeSalary** links Employee and SalaryStructure with effective date ranges
- **PayrollRun** contains multiple Payslips
- **Payslip** belongs to PayrollRun and Employee (unique per run)

### Performance
- **ReviewCycle** contains multiple PerformanceReviews
- **PerformanceReview** links Employee (reviewee) and Reviewer (Employee) within a ReviewCycle
- **Goal** belongs to PerformanceReview and Employee

### Onboarding
- **OnboardingProcess** links Employee and OnboardingTemplate
- **OnboardingTask** belongs to OnboardingProcess and optionally assigned to Employee

### Expenses
- **ExpenseClaim** belongs to Employee, ExpenseCategory, and optionally Approver (Employee)
- **ExpenseClaim** optionally links to Upload for receipt

### Documents & Uploads
- **Upload** stores file metadata for multiple use cases (documents, expense receipts)
- **EmployeeDocument** links Employee and Upload with categorization

### Communication
- **Notification** belongs to User (recipient)
- **Announcement** belongs to Employee (author)

### Shift Management
- **ShiftAssignment** links Employee and Shift with date ranges

### Approval Workflows
- **LeaveRequest** has optional `approverId` (Employee relation: "LeaveApprover")
- **ExpenseClaim** has optional `approverId` (Employee relation: "ExpenseApprover")
- **EmployeeChangeRequest** has optional `reviewedBy` (Employee relation: "ChangeRequestReviewer")

## Key Indexes

The schema includes strategic indexes on:
- `tenantId` on all tenant-scoped tables
- Foreign key fields (`employeeId`, `departmentId`, `managerId`, etc.)
- Status fields for efficient filtering (`status`, `isActive`)
- Date fields for time-based queries (`date`, `createdAt`)
- Composite indexes for common query patterns (`tenantId + email`, `tenantId + code`)

## Notes

- All monetary fields use `Decimal` type with appropriate precision (typically 12,2 for amounts)
- All date-only fields use `@db.Date` directive
- JSON fields are used for flexible structured data (salary components, announcements, etc.)
- Cascade deletes are used where appropriate (e.g., AttendanceSession deletes when AttendanceRecord is deleted)
- Timestamps (`createdAt`, `updatedAt`) are standard on all models

For the complete schema definition, see `backend/prisma/schema.prisma`.
