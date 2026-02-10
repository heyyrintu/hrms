# HRMS Documentation Plan

## Phase 0: Discovery Summary

### Current State
- **README.md**: 192 lines, covers only 6/21 modules (28.6%), Next.js version outdated (says 14, actual 16), missing 60%+ tech stack items, no testing section, no deployment guide
- **Swagger**: All 20 controllers have `@ApiTags`, but ZERO have `@ApiOperation`/`@ApiResponse`. 7/20 DTO files (core modules) lack `@ApiProperty` decorators
- **Existing docs**: `PHASE1_MIGRATION_GUIDE.md` (security migration), inline JSDoc in services
- **No**: `docs/` directory, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` file, architecture diagrams

### Allowed APIs (Swagger/NestJS)
- `@ApiTags('tag')` — controller-level grouping
- `@ApiOperation({ summary, description })` — method-level docs
- `@ApiResponse({ status, description, type? })` — response docs
- `@ApiParam({ name, description, type })` — path parameter docs
- `@ApiQuery({ name, description, type, required? })` — query parameter docs
- `@ApiBody({ type })` — request body docs
- `@ApiProperty({ description?, example?, required? })` — DTO field docs
- `@ApiPropertyOptional()` — optional DTO field docs
- `@ApiBearerAuth()` — authentication indicator
- `DocumentBuilder` methods: `.addTag(name, description)` in `main.ts`

### Anti-Patterns to Avoid
- Do NOT use `@ApiExtraModels` unless needed for polymorphic responses
- Do NOT add `operationId` (not worth the maintenance overhead)
- Do NOT create separate OpenAPI YAML files — Swagger auto-generates from decorators
- Do NOT add response type classes just for documentation — use existing DTOs/entities

---

## Phase 1: README.md Complete Rewrite

### Objective
Rewrite README.md from scratch to be comprehensive, accurate, and professional.

### Tasks

#### 1.1 Header & Badges
Create header with project title, description, and badge placeholders:
```markdown
# HRMS - Human Resource Management System
> A modern, multi-tenant Human Resource Management System built with NestJS 11 and Next.js 16.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-18%2B-green.svg)
![Tests](https://img.shields.io/badge/tests-1078%20passing-brightgreen.svg)
```

#### 1.2 Table of Contents
Add a clickable TOC covering all sections.

#### 1.3 Features Section (Complete)
Replace the "Phase 1" features with the full feature set grouped by category:

**Core HR:**
- Employee Management (CRUD, org structure, 360 view)
- Department Hierarchy
- Multi-Tenant Company Management

**Time & Attendance:**
- Clock In/Out with multiple sessions
- Configurable OT rules and approval
- Shift management and assignment
- Holiday management

**Leave Management:**
- Leave types and balances
- Request/approval workflow with calendar view
- Bulk approval support
- Leave analytics

**Payroll & Finance:**
- Salary structure management
- Payroll run processing
- Payslip generation and viewing
- Expense claims and category management

**Performance:**
- Review cycles management
- Self and team reviews
- Goal setting and tracking

**Onboarding:**
- Onboarding templates
- Task-based onboarding process
- Progress tracking

**Communication & Admin:**
- Company-wide announcements
- Notification system
- Audit logging
- Document management
- Employee self-service with change requests
- Report generation

#### 1.4 Tech Stack (Complete & Accurate)
**Backend:**
- NestJS 11 + TypeScript
- PostgreSQL + Prisma ORM 6.x
- JWT Authentication (Passport)
- Winston Logging
- Swagger/OpenAPI Documentation
- BullMQ Job Queue (Redis)
- Nodemailer Email Integration
- Local/S3 File Storage
- class-validator + class-transformer

**Frontend:**
- Next.js 16 + React 19
- TypeScript
- Tailwind CSS 3
- Zustand (state management)
- React Hook Form + Zod (forms/validation)
- Axios (HTTP client)
- react-hot-toast (notifications)
- react-error-boundary
- date-fns
- Lucide React (icons)

**Testing:**
- Jest (1078 tests — 823 backend, 255 frontend)
- @testing-library/react
- @nestjs/testing

#### 1.5 Role-Based Access Control Table
Document the 4 roles and feature access matrix:
- SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE
- Copy the permission table from Phase 0 Sidebar analysis

#### 1.6 Getting Started (Expanded)
- Prerequisites: Node 18+, PostgreSQL 14+, Redis (optional), npm
- Backend setup with env validation notes
- Frontend setup with env file copying
- Swagger docs link: `http://localhost:3001/api/docs`
- Running tests: `npm test` in both directories

#### 1.7 Complete Environment Variables
Document ALL variables from both `.env.example` files with descriptions.

#### 1.8 Complete API Endpoints
Document all 21 modules with their endpoints. Reference Swagger for full details.

#### 1.9 Updated Project Structure
Show all 21 backend modules, common utilities (email, queue, storage), config directory, and complete frontend structure (contexts, types, test).

#### 1.10 Demo Accounts & Testing
Keep existing demo accounts, add testing section with stats.

#### 1.11 License
MIT with note that LICENSE file will be created.

### Verification Checklist
- [ ] All 21 modules mentioned in features or API sections
- [ ] Tech stack matches actual package.json dependencies
- [ ] Next.js version says 16 (not 14)
- [ ] React version says 19
- [ ] Environment variables match `.env.example` files
- [ ] Role permissions table matches Sidebar navigation
- [ ] Swagger docs link mentioned
- [ ] Test statistics mentioned (1078 tests)
- [ ] No broken markdown formatting

### Anti-Pattern Guards
- Do NOT list endpoints that don't exist — cross-reference with actual controllers
- Do NOT include internal implementation details (mock strategies, etc.)
- Do NOT over-explain — keep concise and scannable

---

## Phase 2: Swagger/API Documentation Enhancement

### Objective
Add method-level Swagger decorators to all 20 controllers and `@ApiProperty` to the 7 undocumented DTO files. Update `main.ts` tags.

### Tasks

#### 2.1 Update main.ts Swagger Tags
Add missing tags to the `DocumentBuilder` config in `backend/src/main.ts` (lines 41-53).

Current tags (7): auth, employees, departments, attendance, leave, admin, companies

Missing tags to add (13): announcements, audit, documents, expenses, holidays, notifications, onboarding, payroll, performance, reports, self-service, shifts, uploads

#### 2.2 Add @ApiProperty to Core Module DTOs (7 files)
These files currently lack `@ApiProperty` decorators:

1. `backend/src/modules/auth/dto/auth.dto.ts` — LoginDto, RegisterDto, AuthResponseDto
2. `backend/src/modules/employees/dto/employees.dto.ts` — CreateEmployeeDto, UpdateEmployeeDto, EmployeeQueryDto
3. `backend/src/modules/leave/dto/leave.dto.ts` — 9 DTOs
4. `backend/src/modules/attendance/dto/attendance.dto.ts` — 8 DTOs
5. `backend/src/modules/companies/dto/companies.dto.ts` — CreateCompanyDto, UpdateCompanyDto, CompanyQueryDto
6. `backend/src/modules/departments/dto/departments.dto.ts` — CreateDepartmentDto, UpdateDepartmentDto
7. `backend/src/modules/admin/dto/admin.dto.ts` — CreateOtRuleDto, UpdateOtRuleDto, DashboardStatsDto

**Pattern to copy from**: `backend/src/modules/holidays/dto/holidays.dto.ts` (uses `@ApiProperty` and `@ApiPropertyOptional` with descriptions and examples)

#### 2.3 Add @ApiOperation and @ApiResponse to All Controllers
For each of the 20 controllers, add:
- `@ApiOperation({ summary: '...' })` to every method
- `@ApiResponse({ status: 200/201, description: '...' })` for success
- `@ApiResponse({ status: 400, description: 'Bad request' })` where validation applies
- `@ApiResponse({ status: 401, description: 'Unauthorized' })` for protected endpoints
- `@ApiResponse({ status: 403, description: 'Forbidden' })` for role-restricted endpoints
- `@ApiResponse({ status: 404, description: 'Not found' })` for `:id` endpoints

**Controllers to annotate (by priority):**

Priority 1 — Core (most used):
1. `auth.controller.ts` — 3 methods
2. `employees.controller.ts` — ~6 methods
3. `attendance.controller.ts` — ~8 methods
4. `leave.controller.ts` — ~12 methods
5. `departments.controller.ts` — ~6 methods
6. `companies.controller.ts` — ~4 methods
7. `admin.controller.ts` — ~5 methods

Priority 2 — Extended modules:
8. `payroll.controller.ts`
9. `performance.controller.ts`
10. `expenses.controller.ts`
11. `onboarding.controller.ts`
12. `holidays.controller.ts`
13. `shifts.controller.ts`
14. `announcements.controller.ts`
15. `reports.controller.ts`

Priority 3 — Support modules:
16. `notifications.controller.ts`
17. `documents.controller.ts`
18. `self-service.controller.ts`
19. `audit.controller.ts`
20. `uploads.controller.ts`

### Verification Checklist
- [ ] `main.ts` has all 20 tags defined
- [ ] Zero DTO files have missing `@ApiProperty` on required fields
- [ ] All 20 controllers have `@ApiOperation` on every method
- [ ] All protected endpoints have `@ApiResponse({ status: 401 })`
- [ ] All role-restricted endpoints have `@ApiResponse({ status: 403 })`
- [ ] Backend compiles without errors: `npm run build`
- [ ] Swagger UI loads at `/api/docs` and shows all tags
- [ ] All existing tests still pass: `npm test`

### Anti-Pattern Guards
- Do NOT change any business logic — only ADD decorators
- Do NOT add `@ApiExtraModels` unless polymorphic responses exist
- Do NOT remove existing decorators or comments
- Do NOT modify DTO validation decorators (`@IsString`, `@IsOptional`, etc.)
- Keep descriptions SHORT (1 sentence max per operation)

---

## Phase 3: Architecture & Developer Documentation

### Objective
Create a `docs/` directory with architecture overview, database schema docs, and developer onboarding guide.

### Tasks

#### 3.1 Create docs/ Directory Structure
```
docs/
├── architecture.md          # System architecture overview
├── database-schema.md       # Database models and relationships
├── developer-guide.md       # Developer onboarding & setup
├── deployment.md            # Deployment guide
└── api-overview.md          # API overview with Swagger link
```

#### 3.2 Architecture Document (`docs/architecture.md`)
Contents:
- System overview (multi-tenant, NestJS + Next.js + PostgreSQL)
- Multi-tenant architecture explanation (tenantId isolation, DEFAULT_TENANT_ID)
- Authentication flow (login → JWT → guarded endpoints)
- Authorization model (Roles: SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE)
- Backend module organization (21 modules + common + config)
- Frontend routing structure (auth vs protected layouts)
- Request flow: Browser → Next.js → Axios → NestJS → Prisma → PostgreSQL
- Infrastructure services: Email (SMTP), Queue (BullMQ/Redis), Storage (Local/S3), Cache, Logging (Winston)

#### 3.3 Database Schema Document (`docs/database-schema.md`)
Contents:
- List all 35 Prisma models with brief descriptions
- Group by domain: Core (Tenant, User, Employee, Department), Attendance, Leave, Payroll, Performance, Onboarding, Expenses, Documents, Communication, Audit
- List all 17+ enums with values
- Key relationships (Tenant→User→Employee, Employee→Manager, Department hierarchy)
- Note: Full schema in `backend/prisma/schema.prisma`

#### 3.4 Developer Guide (`docs/developer-guide.md`)
Contents:
- Prerequisites and environment setup (detailed)
- Step-by-step first-run guide
- Backend development workflow (create module, add to app.module, Prisma schema changes, generate, migrate)
- Frontend development workflow (create page, add route to Sidebar, create components)
- Testing guide (run tests, write new tests, mock patterns — reference `backend/src/test/helpers/`)
- Code style and conventions (NestJS module pattern, DTO validation, guard usage)
- Common pitfalls (from MEMORY.md: Prisma generate, axios .data wrapper, JSX in .ts files, etc.)
- Environment variables reference

#### 3.5 Deployment Guide (`docs/deployment.md`)
Contents:
- Environment configuration for production
- Database setup (PostgreSQL, migrations: `prisma migrate deploy`)
- Building for production (`npm run build` both)
- Running in production (`npm run start:prod` backend, `npm run start` frontend)
- Environment variable reference for production
- Swagger disabled in production (NODE_ENV=production)
- Security checklist (change JWT secret, disable seed, set CORS)
- Note: Docker setup planned as future phase

#### 3.6 API Overview (`docs/api-overview.md`)
Contents:
- Swagger UI access instructions
- Authentication (how to get JWT, how to use Bearer token)
- All 21 API module summaries with base paths
- Common response patterns (pagination, errors)
- Rate limiting / validation notes

### Verification Checklist
- [ ] All 5 files created in `docs/`
- [ ] Architecture doc mentions all 21 modules
- [ ] Database doc lists all 35 models and 17 enums
- [ ] Developer guide includes all 8 common pitfalls from MEMORY.md
- [ ] Deployment guide includes production security checklist
- [ ] No broken internal links between docs
- [ ] README references docs/ directory

### Anti-Pattern Guards
- Do NOT include code snippets longer than 10 lines — link to source files instead
- Do NOT duplicate information already in Swagger — reference `/api/docs`
- Do NOT include credentials or secrets in documentation
- Do NOT create diagrams with ASCII art — use text descriptions (diagrams can be added later)

---

## Phase 4: Supporting Files & README Cross-References

### Objective
Create LICENSE, CONTRIBUTING.md files and update README to cross-reference all new documentation.

### Tasks

#### 4.1 Create LICENSE File
Create `LICENSE` at project root with MIT license text (referenced in existing README).

#### 4.2 Create CONTRIBUTING.md
Contents:
- Getting started for contributors
- Branch naming: `feature/`, `fix/`, `docs/`
- Commit message format
- PR process
- Code style (refer to ESLint/Prettier configs)
- Testing requirements (all tests must pass)

#### 4.3 Update README Cross-References
Add links from README to:
- `docs/architecture.md`
- `docs/database-schema.md`
- `docs/developer-guide.md`
- `docs/deployment.md`
- `docs/api-overview.md`
- `CONTRIBUTING.md`

Add a "Documentation" section near the top of README with these links.

### Verification Checklist
- [ ] LICENSE file exists at root with MIT text
- [ ] CONTRIBUTING.md exists at root
- [ ] README has "Documentation" section with working relative links
- [ ] All referenced files actually exist
- [ ] Git status shows all new files as untracked

### Anti-Pattern Guards
- Do NOT use a non-MIT license (README already declares MIT)
- Do NOT include overly complex contribution rules for a small project
- Do NOT add code of conduct (keep it simple unless requested)

---

## Phase 5: Final Verification

### Objective
End-to-end verification that all documentation is complete, accurate, and consistent.

### Tasks

#### 5.1 Cross-Reference Audit
- Every module mentioned in architecture.md appears in README
- Every module in README appears in Swagger tags
- Every env variable in README matches .env.example files
- Every role in RBAC table matches Sidebar navigation

#### 5.2 Technical Verification
- `cd backend && npm run build` — compiles with new Swagger decorators
- `cd backend && npm test` — all 823 tests pass
- `cd frontend && npm test` — all 255 tests pass
- No TypeScript errors in added decorator code

#### 5.3 Markdown Linting
- All markdown files render properly
- No broken links
- Consistent heading hierarchy
- No spelling errors in headings

#### 5.4 Documentation Completeness Matrix

| Item | File | Status |
|------|------|--------|
| README (comprehensive) | README.md | |
| Architecture | docs/architecture.md | |
| Database Schema | docs/database-schema.md | |
| Developer Guide | docs/developer-guide.md | |
| Deployment Guide | docs/deployment.md | |
| API Overview | docs/api-overview.md | |
| Swagger Decorators | all 20 controllers | |
| DTO Documentation | all 20 DTO files | |
| LICENSE | LICENSE | |
| Contributing | CONTRIBUTING.md | |

### Anti-Pattern Guards
- Do NOT skip running tests — Swagger decorator imports can break builds
- Do NOT auto-fix any test failures by modifying tests — only fix documentation code
- Do NOT commit if any verification step fails