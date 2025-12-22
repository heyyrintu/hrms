# HRMS - Human Resource Management System

A modern, multi-tenant HRMS built with Next.js and NestJS.

## Features (Phase 1)

- **Authentication & Multi-tenancy**: JWT-based auth with role-based access control
- **Employee Management**: CRUD operations, org structure, Employee 360 view
- **Attendance & OT**: Clock in/out, multiple sessions, configurable OT rules
- **Leave Management**: Leave types, balances, request/approval workflow
- **Admin Panel**: Dashboard stats, OT rule configuration

## Tech Stack

### Backend
- NestJS with TypeScript
- PostgreSQL with Prisma ORM
- JWT authentication
- class-validator for validation

### Frontend
- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- Zustand for state management
- Axios for API calls

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed the database
npm run prisma:seed

# Start development server
npm run start:dev
```

The backend will run on http://localhost:3001

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will run on http://localhost:3000

## Demo Accounts

After seeding, you can login with these accounts (password: `password123`):

| Role | Email |
|------|-------|
| HR Admin | admin@example.com |
| Manager | manager@example.com |
| Employee | employee@example.com |
| Contractor (Hourly) | contractor@example.com |

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register (dev only)
- `GET /api/auth/me` - Get current user

### Employees
- `GET /api/employees` - List employees (with pagination/filters)
- `GET /api/employees/:id` - Get employee
- `GET /api/employees/:id/360` - Get Employee 360 view
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Departments
- `GET /api/departments` - List departments
- `GET /api/departments/hierarchy` - Get department tree
- `GET /api/departments/:id` - Get department
- `POST /api/departments` - Create department
- `PUT /api/departments/:id` - Update department
- `DELETE /api/departments/:id` - Delete department

### Attendance
- `POST /api/attendance/clock-in` - Clock in
- `POST /api/attendance/clock-out` - Clock out
- `GET /api/attendance/today` - Get today's status
- `GET /api/attendance/me` - Get my attendance
- `GET /api/attendance/:employeeId` - Get employee attendance
- `GET /api/attendance/summary` - Get attendance summary
- `GET /api/attendance/:employeeId/payable` - Get payable hours
- `POST /api/attendance/:id/approve-ot` - Approve OT

### Leave
- `GET /api/leave/types` - Get leave types
- `GET /api/leave/balances/me` - Get my balances
- `GET /api/leave/requests/me` - Get my requests
- `GET /api/leave/requests/pending-approvals` - Get pending approvals
- `POST /api/leave/requests` - Create leave request
- `POST /api/leave/requests/:id/approve` - Approve request
- `POST /api/leave/requests/:id/reject` - Reject request
- `POST /api/leave/requests/:id/cancel` - Cancel request

### Admin
- `GET /api/admin/dashboard` - Get dashboard stats
- `GET /api/admin/settings/ot-rules` - Get OT rules
- `POST /api/admin/settings/ot-rules` - Create OT rule
- `PUT /api/admin/settings/ot-rules/:id` - Update OT rule
- `DELETE /api/admin/settings/ot-rules/:id` - Delete OT rule

## Project Structure

```
hrms/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── seed.ts            # Seed data
│   └── src/
│       ├── common/            # Shared utilities
│       │   ├── decorators/
│       │   ├── guards/
│       │   └── types/
│       ├── modules/
│       │   ├── admin/         # Admin settings
│       │   ├── attendance/    # Attendance & OT
│       │   ├── auth/          # Authentication
│       │   ├── departments/   # Departments
│       │   ├── employees/     # Employees
│       │   └── leave/         # Leave management
│       └── prisma/            # Prisma service
│
└── frontend/
    └── src/
        ├── app/               # Next.js App Router pages
        │   ├── dashboard/
        │   ├── login/
        │   └── ...
        ├── components/
        │   ├── layout/        # Layout components
        │   └── ui/            # UI components
        └── lib/               # Utilities & API
```

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://user:password@localhost:5432/hrms
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
PORT=3001
NODE_ENV=development
DEFAULT_TENANT_ID=dev-tenant-001
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## License

MIT
