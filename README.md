# HRMS - Human Resource Management System

> A modern, multi-tenant Human Resource Management System built with NestJS 11 and Next.js 16.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-18%2B-green.svg)
![Tests](https://img.shields.io/badge/tests-1078%20passing-brightgreen.svg)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Role-Based Access Control](#role-based-access-control)
- [Getting Started](#getting-started)
- [Demo Accounts](#demo-accounts)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Documentation](#documentation)
- [License](#license)

## Features

### Core HR
- **Employee Management** — CRUD operations, org structure, Employee 360 view, direct reports
- **Department Hierarchy** — Nested departments with tree view
- **Multi-Tenant Company Management** — Tenant isolation with company CRUD and status toggling

### Time & Attendance
- **Clock In/Out** — Multiple sessions per day with automatic status tracking
- **Overtime (OT)** — Configurable OT rules, payable hours calculation, manager approval workflow
- **Shift Management** — Create shifts, assign to employees (individual or bulk)
- **Holiday Management** — Public/company holidays with bulk creation support

### Leave Management
- **Leave Types & Balances** — Admin-configurable leave types with per-employee balance tracking
- **Request/Approval Workflow** — Submit, approve, reject, cancel with manager authorization
- **Leave Calendar** — Visual calendar view of team leave
- **Leave Analytics** — Admin dashboard with leave usage statistics
- **Bulk Operations** — Bulk approval and balance initialization

### Payroll & Finance
- **Salary Structures** — Define salary components (basic, allowances, deductions)
- **Employee Salary Assignment** — Assign structures to employees
- **Payroll Runs** — Create, process, approve, and mark payroll runs as paid
- **Payslip Generation** — Auto-generated payslips viewable by employees
- **Expense Management** — Expense categories, claim submission, approval, and reimbursement tracking

### Performance
- **Review Cycles** — Create and manage performance review cycles (launch, complete)
- **Self & Manager Reviews** — Dual-perspective review submissions
- **Goal Setting** — Employee goal creation, tracking, and management

### Onboarding
- **Onboarding Templates** — Reusable templates with task definitions
- **Process Management** — Assign onboarding processes to new hires
- **Task Tracking** — Employees complete assigned onboarding tasks

### Communication & Admin
- **Announcements** — Company-wide announcements with priority levels
- **Notifications** — In-app notification system with read/unread tracking
- **Audit Logging** — Track all system actions with entity history
- **Document Management** — Employee document upload, verification, and download
- **Self-Service** — Employee profile changes with HR approval workflow
- **Reports** — Attendance, leave, and employee reports with Excel export

## Tech Stack

### Backend
- **NestJS 11** with TypeScript
- **PostgreSQL** with Prisma ORM 6.x
- **JWT Authentication** via Passport
- **Helmet** for security headers
- **Winston** for structured logging
- **Swagger/OpenAPI** for API documentation
- **BullMQ** job queue (Redis, optional)
- **Nodemailer** for email integration (SMTP)
- **Local/S3** file storage
- **class-validator** + **class-transformer** for validation

### Frontend
- **Next.js 16** with App Router + React 19
- **TypeScript**
- **Tailwind CSS 3** for styling
- **Zustand** for state management
- **React Hook Form** + **Zod** for form validation
- **Axios** HTTP client
- **react-hot-toast** for notifications
- **react-error-boundary** for error handling
- **date-fns** for date utilities
- **Lucide React** for icons

### Testing
- **Jest** — 1078 tests (823 backend + 255 frontend), 100% passing
- **@testing-library/react** for frontend component testing
- **@nestjs/testing** for backend unit testing

## Role-Based Access Control

The system supports four roles with hierarchical permissions:

| Feature | EMPLOYEE | MANAGER | HR_ADMIN | SUPER_ADMIN |
|---------|----------|---------|----------|-------------|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Attendance (self) | ✓ | ✓ | ✓ | ✓ |
| Leave (self) | ✓ | ✓ | ✓ | ✓ |
| My Payslips | ✓ | ✓ | ✓ | ✓ |
| Expenses (self) | ✓ | ✓ | ✓ | ✓ |
| My Onboarding Tasks | ✓ | ✓ | ✓ | ✓ |
| Notifications | ✓ | ✓ | ✓ | ✓ |
| My Profile | ✓ | ✓ | ✓ | ✓ |
| Performance (self) | ✓ | ✓ | ✓ | ✓ |
| Employee Directory | | ✓ | ✓ | ✓ |
| OT/Leave/Expense Approvals | | ✓ | ✓ | ✓ |
| Team Reviews | | ✓ | ✓ | ✓ |
| Reports | | ✓ | ✓ | ✓ |
| Change Request Approvals | | | ✓ | ✓ |
| Review Cycle Management | | | ✓ | ✓ |
| Payroll Management | | | ✓ | ✓ |
| Onboarding Management | | | ✓ | ✓ |
| Admin Settings | | | ✓ | ✓ |
| Company/Tenant Management | | | | ✓ |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis (optional — for background job processing)
- npm

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your database credentials and settings

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed the database with demo data
npm run prisma:seed

# Start development server
npm run start:dev
```

The backend runs at http://localhost:3001

API documentation (Swagger UI) is available at http://localhost:3001/api/docs in non-production environments.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

The frontend runs at http://localhost:3000

## Demo Accounts

After seeding, log in with these accounts (password: `password123`):

| Role | Email | Access Level |
|------|-------|-------------|
| HR Admin | admin@example.com | Full HR administration |
| Manager | manager@example.com | Team management + approvals |
| Employee | employee@example.com | Self-service features |
| Contractor | contractor@example.com | Hourly employee features |

> **Warning:** These are development-only credentials. Change all passwords and disable seed data in production.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — (required) |
| `JWT_SECRET` | JWT signing secret (min 16 chars) | — (required) |
| `JWT_EXPIRES_IN` | JWT expiration period | `7d` |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment (`development`/`production`) | `development` |
| `CORS_ORIGIN` | Comma-separated allowed origins | `http://localhost:3000` |
| `DEFAULT_TENANT_ID` | Default tenant for dev mode | `dev-tenant-001` |
| `LOG_LEVEL` | Winston log level | `debug` |
| `STORAGE_TYPE` | File storage type (`local`/`s3`) | `local` |
| `STORAGE_LOCAL_PATH` | Local upload directory | `./uploads` |
| `AWS_S3_BUCKET` | S3 bucket name | — (optional) |
| `AWS_S3_REGION` | S3 region | — (optional) |
| `AWS_ACCESS_KEY_ID` | AWS access key | — (optional) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | — (optional) |
| `SMTP_HOST` | SMTP server host | — (optional) |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — (optional) |
| `SMTP_PASS` | SMTP password | — (optional) |
| `SMTP_FROM` | Sender email address | — (optional) |
| `REDIS_ENABLED` | Enable BullMQ background jobs | `false` |
| `REDIS_HOST` | Redis server host | `localhost` |
| `REDIS_PORT` | Redis server port | `6379` |
| `REDIS_PASSWORD` | Redis password | — (optional) |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:3001/api` |
| `NEXT_PUBLIC_APP_NAME` | Application display name | `HRMS` |
| `NEXT_PUBLIC_APP_ENV` | Frontend environment | `development` |

## API Endpoints

All endpoints are prefixed with `/api`. Authentication is via Bearer JWT token. Full interactive documentation is available at [Swagger UI](http://localhost:3001/api/docs).

### Authentication (`/api/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new user (dev only) |
| POST | `/auth/login` | Login with email and password |
| GET | `/auth/me` | Get current user profile |

### Employees (`/api/employees`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/employees` | Create employee |
| GET | `/employees` | List employees (paginated, filterable) |
| GET | `/employees/:id` | Get employee by ID |
| GET | `/employees/:id/360` | Get Employee 360 view |
| GET | `/employees/:id/direct-reports` | Get direct reports |
| PUT | `/employees/:id` | Update employee |
| DELETE | `/employees/:id` | Delete employee |

### Departments (`/api/departments`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/departments` | Create department |
| GET | `/departments` | List departments |
| GET | `/departments/hierarchy` | Get department tree |
| GET | `/departments/:id` | Get department |
| PUT | `/departments/:id` | Update department |
| DELETE | `/departments/:id` | Delete department |

### Companies (`/api/companies`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/companies` | Create company/tenant |
| GET | `/companies` | List companies |
| GET | `/companies/stats` | Get company statistics |
| GET | `/companies/:id` | Get company |
| PUT | `/companies/:id` | Update company |
| PUT | `/companies/:id/toggle-status` | Toggle company active status |
| DELETE | `/companies/:id` | Delete company |

### Attendance (`/api/attendance`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/attendance/clock-in` | Clock in |
| POST | `/attendance/clock-out` | Clock out |
| GET | `/attendance/today` | Get today's attendance status |
| GET | `/attendance/me` | Get my attendance records |
| GET | `/attendance/summary` | Get attendance summary |
| POST | `/attendance/manual` | Create manual attendance entry |
| GET | `/attendance/:employeeId` | Get employee attendance |
| GET | `/attendance/:employeeId/payable` | Get payable hours |
| GET | `/attendance/pending-ot-approvals` | Get pending OT approvals |
| POST | `/attendance/:id/approve-ot` | Approve overtime |

### Leave (`/api/leave`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/leave/types` | Get leave types |
| GET | `/leave/balances/me` | Get my leave balances |
| GET | `/leave/requests/me` | Get my leave requests |
| GET | `/leave/requests/pending-approvals` | Get pending approvals |
| POST | `/leave/requests` | Create leave request |
| POST | `/leave/requests/:id/cancel` | Cancel leave request |
| POST | `/leave/requests/:id/approve` | Approve leave request |
| POST | `/leave/requests/:id/reject` | Reject leave request |
| POST | `/leave/admin/types` | Create leave type (admin) |
| PUT | `/leave/admin/types/:id` | Update leave type (admin) |
| DELETE | `/leave/admin/types/:id` | Delete leave type (admin) |
| GET | `/leave/admin/balances` | Get all balances (admin) |
| GET | `/leave/admin/balances/:employeeId` | Get employee balance (admin) |
| PUT | `/leave/admin/balances/:employeeId/:leaveTypeId` | Update balance (admin) |
| POST | `/leave/admin/balances/initialize` | Initialize balances (admin) |
| GET | `/leave/admin/requests` | Get all requests (admin) |
| GET | `/leave/admin/analytics` | Get leave analytics (admin) |

### Admin (`/api/admin`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard` | Get dashboard statistics |
| GET | `/admin/settings/ot-rules` | List OT rules |
| GET | `/admin/settings/ot-rules/:id` | Get OT rule |
| POST | `/admin/settings/ot-rules` | Create OT rule |
| PUT | `/admin/settings/ot-rules/:id` | Update OT rule |
| DELETE | `/admin/settings/ot-rules/:id` | Delete OT rule |

### Holidays (`/api/holidays`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/holidays` | List holidays |
| GET | `/holidays/upcoming` | Get upcoming holidays |
| GET | `/holidays/:id` | Get holiday |
| POST | `/holidays` | Create holiday |
| POST | `/holidays/bulk` | Bulk create holidays |
| PUT | `/holidays/:id` | Update holiday |
| DELETE | `/holidays/:id` | Delete holiday |

### Shifts (`/api/shifts`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/shifts` | List shifts |
| GET | `/shifts/:id` | Get shift |
| POST | `/shifts` | Create shift |
| PUT | `/shifts/:id` | Update shift |
| DELETE | `/shifts/:id` | Delete shift |
| GET | `/shifts/assignments/list` | List shift assignments |
| GET | `/shifts/assignments/employee/:employeeId` | Get employee shift history |
| POST | `/shifts/assignments` | Assign shift |
| POST | `/shifts/assignments/bulk` | Bulk assign shifts |

### Announcements (`/api/announcements`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/announcements/active` | Get active announcements |
| GET | `/announcements` | List all announcements |
| GET | `/announcements/:id` | Get announcement |
| POST | `/announcements` | Create announcement |
| PUT | `/announcements/:id` | Update announcement |
| DELETE | `/announcements/:id` | Delete announcement |

### Payroll (`/api/payroll`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/payroll/structures` | List salary structures |
| GET | `/payroll/structures/:id` | Get salary structure |
| POST | `/payroll/structures` | Create salary structure |
| PUT | `/payroll/structures/:id` | Update salary structure |
| DELETE | `/payroll/structures/:id` | Delete salary structure |
| GET | `/payroll/employees/:employeeId/salary` | Get employee salary |
| POST | `/payroll/employees/:employeeId/salary` | Assign salary to employee |
| GET | `/payroll/runs` | List payroll runs |
| GET | `/payroll/runs/:id` | Get payroll run |
| POST | `/payroll/runs` | Create payroll run |
| POST | `/payroll/runs/:id/process` | Process payroll run |
| POST | `/payroll/runs/:id/approve` | Approve payroll run |
| POST | `/payroll/runs/:id/pay` | Mark payroll run as paid |
| DELETE | `/payroll/runs/:id` | Delete payroll run |
| GET | `/payroll/runs/:runId/payslips` | Get payslips for run |
| GET | `/payroll/my-payslips` | Get my payslips |
| GET | `/payroll/payslips/:id` | Get payslip details |

### Expenses (`/api/expenses`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/expenses/categories` | List expense categories |
| POST | `/expenses/categories` | Create category |
| PUT | `/expenses/categories/:id` | Update category |
| DELETE | `/expenses/categories/:id` | Delete category |
| GET | `/expenses/my-claims` | Get my expense claims |
| POST | `/expenses/claims` | Create expense claim |
| PUT | `/expenses/claims/:id` | Update expense claim |
| POST | `/expenses/claims/:id/submit` | Submit claim for approval |
| DELETE | `/expenses/claims/:id` | Delete expense claim |
| GET | `/expenses/pending-approvals` | Get pending approvals |
| GET | `/expenses/all-claims` | Get all claims (admin) |
| POST | `/expenses/claims/:id/approve` | Approve claim |
| POST | `/expenses/claims/:id/reject` | Reject claim |
| POST | `/expenses/claims/:id/reimburse` | Mark as reimbursed |

### Performance (`/api/performance`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/performance/cycles` | List review cycles |
| GET | `/performance/cycles/:id` | Get review cycle |
| POST | `/performance/cycles` | Create review cycle |
| PUT | `/performance/cycles/:id` | Update review cycle |
| DELETE | `/performance/cycles/:id` | Delete review cycle |
| POST | `/performance/cycles/:id/launch` | Launch review cycle |
| POST | `/performance/cycles/:id/complete` | Complete review cycle |
| GET | `/performance/my-reviews` | Get my reviews |
| GET | `/performance/reviews/:id` | Get review details |
| POST | `/performance/reviews/:id/self-review` | Submit self review |
| GET | `/performance/team-reviews` | Get team reviews |
| POST | `/performance/reviews/:id/manager-review` | Submit manager review |
| GET | `/performance/my-goals` | Get my goals |
| POST | `/performance/goals` | Create goal |
| PUT | `/performance/goals/:id` | Update goal |
| DELETE | `/performance/goals/:id` | Delete goal |

### Onboarding (`/api/onboarding`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/onboarding/templates` | List templates |
| GET | `/onboarding/templates/:id` | Get template |
| POST | `/onboarding/templates` | Create template |
| PUT | `/onboarding/templates/:id` | Update template |
| DELETE | `/onboarding/templates/:id` | Delete template |
| GET | `/onboarding/processes` | List onboarding processes |
| GET | `/onboarding/processes/:id` | Get onboarding process |
| POST | `/onboarding/processes` | Create onboarding process |
| POST | `/onboarding/processes/:id/cancel` | Cancel onboarding process |
| DELETE | `/onboarding/processes/:id` | Delete onboarding process |
| GET | `/onboarding/my-tasks` | Get my onboarding tasks |
| PUT | `/onboarding/tasks/:id` | Update task |
| POST | `/onboarding/tasks/:id/complete` | Complete task |

### Notifications (`/api/notifications`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | Get notifications |
| GET | `/notifications/unread-count` | Get unread count |
| POST | `/notifications/read-all` | Mark all as read |
| POST | `/notifications/:id/read` | Mark as read |
| DELETE | `/notifications/:id` | Delete notification |

### Documents (`/api/employees/:employeeId/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/employees/:employeeId/documents` | Get employee documents |
| POST | `/employees/:employeeId/documents` | Upload document |
| GET | `/employees/:employeeId/documents/:docId` | Get document |
| GET | `/employees/:employeeId/documents/:docId/download` | Download document |
| POST | `/employees/:employeeId/documents/:docId/verify` | Verify document |
| DELETE | `/employees/:employeeId/documents/:docId` | Delete document |

### Self-Service (`/api/self-service`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/self-service/profile` | Get my profile |
| POST | `/self-service/change-requests` | Create change request |
| GET | `/self-service/change-requests` | Get my change requests |
| GET | `/self-service/admin/change-requests/pending` | Get pending reviews (admin) |
| GET | `/self-service/admin/change-requests` | Get all change requests (admin) |
| POST | `/self-service/admin/change-requests/:id/review` | Review change request (admin) |

### Audit (`/api/audit`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit` | Get audit logs |
| GET | `/audit/entity/:entityType/:entityId` | Get entity audit history |

### Reports (`/api/reports`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/reports/attendance` | Generate attendance report |
| POST | `/reports/leave` | Generate leave report |
| POST | `/reports/employees` | Generate employee report |

### Uploads (`/api/uploads`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/uploads` | Upload file |
| GET | `/uploads/:folder/:filename` | Download file |
| DELETE | `/uploads/:folder/:filename` | Delete file |

## Project Structure

```
hrms/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Database schema (35 models)
│   │   ├── migrations/            # Database migrations
│   │   └── seed.ts                # Seed data
│   ├── src/
│   │   ├── main.ts                # App bootstrap + Swagger setup
│   │   ├── app.module.ts          # Root module
│   │   ├── common/
│   │   │   ├── decorators/        # @CurrentUser, @Roles
│   │   │   ├── guards/            # RolesGuard
│   │   │   ├── types/             # JWT payload types
│   │   │   ├── email/             # Email service (SMTP)
│   │   │   ├── queue/             # BullMQ job queue
│   │   │   └── storage/           # File storage (local/S3)
│   │   ├── config/
│   │   │   ├── env.validation.ts  # Environment validation
│   │   │   └── logger.config.ts   # Winston configuration
│   │   ├── modules/
│   │   │   ├── admin/             # Dashboard & OT rules
│   │   │   ├── announcements/     # Company announcements
│   │   │   ├── attendance/        # Clock in/out & OT
│   │   │   ├── audit/             # Audit logging
│   │   │   ├── auth/              # Authentication
│   │   │   ├── companies/         # Multi-tenant companies
│   │   │   ├── departments/       # Department hierarchy
│   │   │   ├── documents/         # Document management
│   │   │   ├── employees/         # Employee CRUD & 360
│   │   │   ├── expenses/          # Expense claims
│   │   │   ├── holidays/          # Holiday management
│   │   │   ├── leave/             # Leave management
│   │   │   ├── notifications/     # Notification system
│   │   │   ├── onboarding/        # Onboarding workflows
│   │   │   ├── payroll/           # Payroll processing
│   │   │   ├── performance/       # Performance reviews
│   │   │   ├── prisma/            # Prisma database service
│   │   │   ├── reports/           # Report generation
│   │   │   ├── self-service/      # Employee self-service
│   │   │   ├── shifts/            # Shift management
│   │   │   └── uploads/           # File uploads
│   │   └── test/                  # Test helpers & mocks
│   └── test/                      # E2E tests
│
└── frontend/
    └── src/
        ├── app/
        │   ├── (auth)/            # Login page
        │   └── (protected)/       # All authenticated pages
        │       ├── dashboard/
        │       ├── employees/
        │       ├── attendance/
        │       ├── leave/
        │       ├── payroll/
        │       ├── performance/
        │       ├── expenses/
        │       ├── onboarding/
        │       ├── approvals/
        │       ├── reports/
        │       ├── notifications/
        │       ├── my-profile/
        │       ├── my-payslips/
        │       ├── companies/
        │       └── admin/
        ├── components/
        │   ├── layout/            # DashboardLayout, Header, Sidebar
        │   ├── ui/                # Badge, Button, Card, Modal, Table, etc.
        │   ├── leave/             # Leave-specific components
        │   └── approvals/         # Approval components
        ├── contexts/              # AuthContext
        ├── lib/                   # API client, utilities, date helpers
        ├── types/                 # TypeScript type definitions
        └── test/                  # Test setup & helpers
```

## Testing

The project has comprehensive test coverage:

```bash
# Run backend tests (823 tests)
cd backend
npm test

# Run frontend tests (255 tests)
cd frontend
npm test

# Run with coverage
npm run test:cov

# Run in watch mode
npm run test:watch
```

**Total: 1078 tests, 100% passing**

## Documentation

- [Architecture Overview](docs/architecture.md) — System design and multi-tenant architecture
- [Database Schema](docs/database-schema.md) — All 35 Prisma models and relationships
- [Developer Guide](docs/developer-guide.md) — Setup, workflows, and coding conventions
- [Deployment Guide](docs/deployment.md) — Production deployment instructions
- [API Overview](docs/api-overview.md) — API authentication and usage guide
- [Contributing](CONTRIBUTING.md) — How to contribute to the project
- [Swagger UI](http://localhost:3001/api/docs) — Interactive API documentation (dev only)

## License

This project is licensed under the [MIT License](LICENSE).
