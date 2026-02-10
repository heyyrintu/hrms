# API Overview

## Base URL

All API endpoints are prefixed with `/api`:

```
http://localhost:3001/api    # Development
https://your-domain.com/api  # Production
```

## Interactive Documentation

Swagger UI is available at `/api/docs` in non-production environments. It provides:
- Full endpoint listing with request/response schemas
- Try-it-out functionality for testing endpoints
- Bearer token authentication support

## Authentication

### Getting a Token

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password123", "tenantId": "dev-tenant-001"}'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "email": "admin@example.com",
    "role": "HR_ADMIN"
  }
}
```

### Using the Token

Include the token in the `Authorization` header:

```bash
curl http://localhost:3001/api/employees \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

## API Modules

| Module | Base Path | Description |
|--------|-----------|-------------|
| Auth | `/api/auth` | Login, registration, profile |
| Employees | `/api/employees` | Employee CRUD, 360 view, direct reports |
| Departments | `/api/departments` | Department hierarchy |
| Companies | `/api/companies` | Multi-tenant company management |
| Attendance | `/api/attendance` | Clock in/out, OT, payable hours |
| Leave | `/api/leave` | Leave types, balances, requests, approvals |
| Admin | `/api/admin` | Dashboard stats, OT rules |
| Holidays | `/api/holidays` | Holiday management |
| Shifts | `/api/shifts` | Shift definitions and assignments |
| Announcements | `/api/announcements` | Company announcements |
| Payroll | `/api/payroll` | Salary structures, payroll runs, payslips |
| Expenses | `/api/expenses` | Expense categories and claims |
| Performance | `/api/performance` | Review cycles, reviews, goals |
| Onboarding | `/api/onboarding` | Templates, processes, tasks |
| Notifications | `/api/notifications` | In-app notifications |
| Documents | `/api/employees/:id/documents` | Employee documents |
| Self-Service | `/api/self-service` | Profile changes, change requests |
| Audit | `/api/audit` | Audit logs |
| Reports | `/api/reports` | Report generation |
| Uploads | `/api/uploads` | File upload/download |

## Common Patterns

### Pagination

List endpoints support pagination via query parameters:

```
GET /api/employees?page=1&limit=20
```

### Filtering

Many list endpoints support filtering:

```
GET /api/employees?status=ACTIVE&departmentId=dept-123
GET /api/leave/requests/me?status=PENDING
GET /api/attendance/me?startDate=2025-01-01&endDate=2025-01-31
```

### Error Responses

The API returns consistent error responses:

```json
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error": "Bad Request"
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad Request — validation failed or invalid input |
| 401 | Unauthorized — missing or invalid JWT token |
| 403 | Forbidden — insufficient role permissions |
| 404 | Not Found — resource does not exist |
| 500 | Internal Server Error — unexpected server error |

### Validation

The API uses `class-validator` with a strict whitelist policy:
- Unknown properties are rejected (HTTP 400)
- Required fields are enforced
- Type coercion is automatic (strings to numbers where applicable)

For detailed endpoint documentation including request/response schemas, see the [Swagger UI](http://localhost:3001/api/docs).
