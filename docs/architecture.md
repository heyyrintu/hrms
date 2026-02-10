# Architecture Overview

## System Overview

HRMS is a multi-tenant Human Resource Management System with a clear client-server architecture:

- **Frontend**: Next.js 16 (React 19) single-page application with App Router
- **Backend**: NestJS 11 REST API with modular architecture
- **Database**: PostgreSQL with Prisma ORM
- **Infrastructure**: Optional Redis for job queues, SMTP for email, S3/local for file storage

## Multi-Tenant Architecture

The system supports multiple tenants (companies) with data isolation at the database level.

### Tenant Isolation
- Every core entity belongs to a `Tenant` via `tenantId` foreign key
- The `User` model links to a `Tenant`, and queries are scoped by tenant
- A `DEFAULT_TENANT_ID` environment variable provides a fallback for single-tenant deployments
- Login requires `tenantId` — the system looks up users within the specified tenant

### Tenant Hierarchy
```
Tenant
  └── User (with role: SUPER_ADMIN | HR_ADMIN | MANAGER | EMPLOYEE)
        └── Employee (linked 1:1 to User)
              ├── Department (belongs to)
              ├── Manager (Employee self-reference)
              └── All HR data (attendance, leave, payroll, etc.)
```

## Authentication & Authorization

### Authentication Flow
1. User sends `POST /api/auth/login` with email, password, and tenantId
2. Backend validates credentials against bcrypt hash, scoped to tenant
3. JWT token issued containing `userId`, `role`, `tenantId`, `employeeId`
4. Frontend stores token and sends it as `Authorization: Bearer <token>` on all requests

### Authorization Model
Four roles with hierarchical permissions:

| Role | Scope |
|------|-------|
| **SUPER_ADMIN** | Full system access, multi-tenant management |
| **HR_ADMIN** | Full HR operations within tenant |
| **MANAGER** | Team management, approvals for direct reports |
| **EMPLOYEE** | Self-service only |

### Guard Implementation
- `JwtAuthGuard` — Validates JWT token on every protected request
- `RolesGuard` — Checks `@Roles()` decorator against user's role from JWT
- Controller-level: `@UseGuards(JwtAuthGuard, RolesGuard)` applied to most controllers
- Method-level: Additional `@Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)` for restricted endpoints

## Backend Module Organization

The backend follows NestJS's modular architecture. Each module encapsulates a domain with its own controller, service, DTOs, and tests.

### 21 Modules

**Core:**
- `auth` — Login, registration, JWT management
- `employees` — Employee CRUD, 360 view, direct reports
- `departments` — Department hierarchy and tree structure
- `companies` — Multi-tenant company management
- `prisma` — Database service (shared across all modules)

**Time & Attendance:**
- `attendance` — Clock in/out, OT tracking, payable hours
- `holidays` — Public and company holidays
- `shifts` — Shift definitions and assignments

**Leave:**
- `leave` — Leave types, balances, requests, approvals, analytics

**Payroll:**
- `payroll` — Salary structures, payroll runs, payslips
- `expenses` — Expense categories, claims, approvals

**People:**
- `performance` — Review cycles, reviews, goals
- `onboarding` — Templates, processes, tasks

**Admin:**
- `admin` — Dashboard stats, OT rules configuration
- `announcements` — Company-wide announcements
- `notifications` — In-app notification system
- `audit` — Action logging with entity history
- `reports` — Attendance, leave, employee reports

**Support:**
- `documents` — Employee document upload and verification
- `self-service` — Profile change requests with approval workflow
- `uploads` — File upload/download handling

### Common Utilities (`src/common/`)
- `decorators/` — `@CurrentUser()` extracts JWT payload, `@Roles()` declares required roles
- `guards/` — `RolesGuard` implements role-based access control
- `types/` — JWT payload TypeScript types
- `email/` — Email service wrapping Nodemailer (SMTP)
- `queue/` — BullMQ job queue integration (Redis-backed, optional)
- `storage/` — File storage abstraction (local filesystem or AWS S3)

### Configuration (`src/config/`)
- `env.validation.ts` — Startup validation of environment variables using class-validator
- `logger.config.ts` — Winston logger configuration with structured JSON output

## Frontend Architecture

### Routing Structure
The frontend uses Next.js App Router with two layout groups:

```
app/
├── (auth)/          # Public routes (login page)
│   └── layout.tsx   # Minimal layout, no sidebar
└── (protected)/     # Authenticated routes
    └── layout.tsx   # DashboardLayout with Header + Sidebar
```

All pages under `(protected)/` require authentication. The `AuthContext` provider manages JWT token storage, user state, and role-checking utilities.

### State Management
- **AuthContext** — React Context for auth state (token, user, roles)
- **Zustand** — Used for other client-side state as needed
- **React Hook Form + Zod** — Form state and validation

### API Communication
- Unified Axios client (`src/lib/api.ts`) with base URL from environment
- Automatic JWT token injection via Axios interceptor
- Centralized error handling

### Component Structure
- `layout/` — DashboardLayout, Header, Sidebar (role-aware navigation)
- `ui/` — Reusable components: Badge, Button, Card, FormRow, Input, Modal, Select, Spinner, Table
- `leave/` — Domain-specific leave components (calendar, request form, bulk approval)
- `approvals/` — Approval workflow components

## Request Flow

```
Browser (Next.js)
  → Axios HTTP Client (with JWT header)
    → NestJS API (global prefix: /api)
      → ValidationPipe (whitelist + transform)
        → JwtAuthGuard (token validation)
          → RolesGuard (role check)
            → Controller (route handling)
              → Service (business logic)
                → PrismaService (database queries)
                  → PostgreSQL
```

## Infrastructure Services

### Logging (Winston)
- Structured JSON logging in production
- Console transport in development
- Log levels configurable via `LOG_LEVEL` environment variable

### Email (Nodemailer)
- SMTP-based email sending
- Optional — if not configured, emails are logged to console
- Used for notifications, password resets, etc.

### Job Queue (BullMQ)
- Redis-backed background job processing
- Optional — disabled by default (`REDIS_ENABLED=false`)
- Used for async operations (email sending, report generation)

### File Storage
- Abstraction layer supporting local filesystem or AWS S3
- Configurable via `STORAGE_TYPE` environment variable
- Used by uploads and document management modules

### API Documentation (Swagger)
- Auto-generated from decorators at `/api/docs`
- Disabled in production (`NODE_ENV=production`)
- All 20 controllers tagged with operation summaries and response codes

### Security
- **Helmet** — Security headers middleware
- **CORS** — Configurable allowed origins
- **bcrypt** — Password hashing
- **JWT** — Stateless authentication tokens
- **ValidationPipe** — Input sanitization (whitelist mode strips unknown properties)
