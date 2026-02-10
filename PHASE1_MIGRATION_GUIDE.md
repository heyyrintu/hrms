# Phase 1 Security Fixes - Migration Guide

## Overview

Phase 1 implemented critical security fixes for the HRMS application. This guide helps you migrate existing deployments to incorporate these security improvements.

**⚠️ IMPORTANT:** These are **breaking changes** that affect authentication, authorization, and API behavior.

---

## Breaking Changes Summary

### 1. Multi-Tenant Login Now Requires Tenant ID
**Impact:** HIGH - Affects all login requests

**What Changed:**
- Login endpoint now requires `tenantId` in the request body (optional, falls back to DEFAULT_TENANT_ID)
- Previously, login searched across all tenants - **this was a security vulnerability**
- Now enforces proper tenant isolation

**Migration Steps:**

#### Backend (No changes needed)
The backend now accepts an optional `tenantId` field in LoginDto.

#### Frontend Migration Required
Update your login form to include tenantId:

**Before:**
```typescript
const loginData = {
  email: email,
  password: password
};
```

**After:**
```typescript
const loginData = {
  email: email,
  password: password,
  tenantId: tenantId // Optional: omit for single-tenant, or get from subdomain/config
};
```

**Options for Tenant ID:**
1. **Single-tenant mode:** Don't send tenantId, uses DEFAULT_TENANT_ID from env
2. **Multi-tenant with selection:** Add tenant dropdown/input to login form
3. **Subdomain-based:** Extract from `window.location.hostname` (e.g., `acme.hrms.com` → `acme`)
4. **Email domain-based:** Extract from email domain and map to tenantId

**Example Implementation:**
```typescript
// Option 1: Single-tenant (no changes)
await api.post('/auth/login', { email, password });

// Option 2: Tenant selection
await api.post('/auth/login', {
  email,
  password,
  tenantId: selectedTenant
});

// Option 3: Subdomain-based
const tenantId = window.location.hostname.split('.')[0];
await api.post('/auth/login', { email, password, tenantId });
```

---

### 2. Registration Endpoint Now Requires Authentication
**Impact:** HIGH - Affects user creation workflows

**What Changed:**
- `/api/auth/register` now requires authentication with SUPER_ADMIN or HR_ADMIN role
- Previously, anyone could create accounts - **this was a security vulnerability**

**Migration Steps:**

1. **Initial Tenant Setup:**
   Create first admin user via database seeding:

   ```typescript
   // prisma/seed.ts
   import { PrismaClient } from '@prisma/client';
   import * as bcrypt from 'bcrypt';

   const prisma = new PrismaClient();

   async function main() {
     const passwordHash = await bcrypt.hash('your-secure-password', 10);

     await prisma.user.create({
       data: {
         tenantId: 'your-tenant-id',
         email: 'admin@example.com',
         passwordHash,
         role: 'SUPER_ADMIN',
         isActive: true,
       },
     });
   }

   main();
   ```

   Run: `npx prisma db seed`

2. **Subsequent User Creation:**
   Frontend must now:
   - Ensure user is logged in as SUPER_ADMIN or HR_ADMIN
   - Include JWT token in Authorization header
   - Handle 401/403 errors for unauthorized attempts

   ```typescript
   // Frontend: Create new user (must be authenticated admin)
   const response = await apiClient.post('/auth/register', {
     email: newUserEmail,
     password: newUserPassword,
     role: 'EMPLOYEE',
     tenantId: currentTenantId,
   });
   ```

---

### 3. Leave Approval Authorization Checks
**Impact:** MEDIUM - Affects manager leave approval workflows

**What Changed:**
- Managers can now **only** approve/reject leave requests from their **direct reports**
- SUPER_ADMIN and HR_ADMIN can still approve/reject any leave
- Previously, any manager could approve any leave - **this was an authorization bug**

**Migration Steps:**

**Database Verification:**
Ensure `employee.managerId` relationships are correctly set:

```sql
-- Check for employees without managers (except top-level)
SELECT id, firstName, lastName, email
FROM "Employee"
WHERE "managerId" IS NULL
  AND "status" = 'ACTIVE';

-- Verify manager-employee relationships
SELECT
  e.id,
  e.firstName || ' ' || e.lastName as employee_name,
  m.firstName || ' ' || m.lastName as manager_name
FROM "Employee" e
LEFT JOIN "Employee" m ON e."managerId" = m.id
WHERE e."status" = 'ACTIVE';
```

**Frontend Updates:**
Handle new `ForbiddenException` (403) errors:

```typescript
try {
  await api.post(`/leave/requests/${requestId}/approve`, {
    approverNote: 'Approved'
  });
} catch (error) {
  if (error.response?.status === 403) {
    // Show user-friendly message
    toast.error('You can only approve leave requests for your direct reports');
  } else {
    toast.error('Failed to approve leave request');
  }
}
```

---

### 4. Attendance Data Access Authorization
**Impact:** MEDIUM - Affects employee attendance viewing

**What Changed:**
- Managers can now **only** view attendance for **themselves** or **direct reports**
- SUPER_ADMIN and HR_ADMIN can view any employee's attendance
- Previously, any manager could view any employee's data - **this was a privacy violation**

**Migration Steps:**

**Frontend Updates:**
1. Update employee selection dropdowns to show only authorized employees
2. Handle 403 errors gracefully

```typescript
// Fetch only employees the manager can view
const fetchAuthorizedEmployees = async () => {
  if (user.role === 'MANAGER') {
    // Fetch direct reports only
    const response = await api.get('/employees', {
      params: { managerId: user.employeeId }
    });
    return response.data;
  } else {
    // SUPER_ADMIN/HR_ADMIN can view all
    const response = await api.get('/employees');
    return response.data;
  }
};

// Handle 403 when trying to access unauthorized attendance
try {
  const attendance = await api.get(`/attendance/${employeeId}`, {
    params: { from, to }
  });
} catch (error) {
  if (error.response?.status === 403) {
    toast.error('You do not have permission to view this employee\'s attendance');
    router.push('/attendance'); // Redirect back
  }
}
```

---

### 5. Error Handling Improvements
**Impact:** LOW - Better error messages

**What Changed:**
- All attendance controller errors now use `BadRequestException` instead of raw `Error`
- No more stack traces exposed to clients
- Consistent error format across all endpoints

**Migration Steps:**

**Frontend:**
No changes required, but error responses are now more consistent:

```typescript
// All errors now follow NestJS format:
{
  "statusCode": 400,
  "message": "User is not linked to an employee",
  "error": "Bad Request"
}

// Previously might have exposed:
{
  "message": "Error: User is not linked to an employee",
  "stack": "Error: User is not linked to...\n at ..."  // REMOVED
}
```

---

## Environment Variable Updates

### Backend `.env` Changes

**CRITICAL:** Update your `.env` file (not `.env.example`):

1. **Remove real credentials** if you accidentally committed them
2. **Verify DEFAULT_TENANT_ID** is set for single-tenant deployments

```bash
# Required for single-tenant login fallback
DEFAULT_TENANT_ID="your-tenant-id"  # Must match actual tenant ID in database
```

### Verification Steps

```bash
# 1. Check if DEFAULT_TENANT_ID matches your database
npx prisma studio
# Navigate to Tenant table, verify ID matches .env

# 2. For multi-tenant, ensure each tenant has unique ID
SELECT id, name FROM "Tenant";
```

---

## Testing Your Migration

### 1. Test Multi-Tenant Login

**Single-Tenant Test:**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Should succeed with DEFAULT_TENANT_ID
```

**Multi-Tenant Test:**
```bash
# Should succeed with correct tenantId
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@tenant1.com",
    "password": "password123",
    "tenantId": "tenant-001"
  }'

# Should fail (401) with wrong tenantId
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@tenant1.com",
    "password": "password123",
    "tenantId": "tenant-002"
  }'
```

### 2. Test Registration Authorization

```bash
# Should fail (401) - no authentication
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "password123",
    "tenantId": "tenant-001"
  }'

# Should succeed with admin token
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "email": "newuser@example.com",
    "password": "password123",
    "role": "EMPLOYEE",
    "tenantId": "tenant-001"
  }'
```

### 3. Test Leave Approval Authorization

```bash
# As a manager, try approving leave for non-direct-report
# Should return 403 Forbidden
curl -X POST http://localhost:3001/api/leave/requests/REQUEST_ID/approve \
  -H "Authorization: Bearer MANAGER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approverNote": "Approved"
  }'
```

### 4. Test Attendance Access Authorization

```bash
# As a manager, try viewing non-direct-report's attendance
# Should return 403 Forbidden
curl -X GET "http://localhost:3001/api/attendance/OTHER_EMPLOYEE_ID?from=2024-01-01&to=2024-01-31" \
  -H "Authorization: Bearer MANAGER_JWT_TOKEN"
```

---

## Rollback Plan

If you need to rollback Phase 1 changes:

### 1. Revert Backend Code

```bash
# Find the commit before Phase 1
git log --oneline | grep "Phase 1"

# Revert to previous commit
git revert <commit-hash>

# Or hard reset (if no important changes after)
git reset --hard <commit-before-phase-1>
```

### 2. Files to Restore

If selectively rolling back:

```bash
git checkout <previous-commit> -- backend/src/modules/auth/auth.service.ts
git checkout <previous-commit> -- backend/src/modules/auth/auth.controller.ts
git checkout <previous-commit> -- backend/src/modules/auth/dto/auth.dto.ts
git checkout <previous-commit> -- backend/src/modules/attendance/attendance.controller.ts
git checkout <previous-commit> -- backend/src/modules/leave/leave.controller.ts
git checkout <previous-commit> -- backend/src/modules/leave/leave.service.ts
git checkout <previous-commit> -- backend/.env.example
```

### 3. Rebuild

```bash
cd backend
npm install
npx prisma generate
npm run build
```

**⚠️ WARNING:** Rolling back removes critical security fixes. Only rollback if absolutely necessary and implement fixes ASAP.

---

## Production Deployment Checklist

- [ ] Update `.env` with secure credentials (not from .env.example)
- [ ] Set `DEFAULT_TENANT_ID` if using single-tenant mode
- [ ] Create initial admin user via database seeding
- [ ] Update frontend to send `tenantId` in login (if multi-tenant)
- [ ] Update frontend to handle 403 errors for unauthorized access
- [ ] Verify `employee.managerId` relationships are correct
- [ ] Test login with correct and incorrect tenantIds
- [ ] Test registration requires admin authentication
- [ ] Test manager can only approve direct reports' leaves
- [ ] Test manager can only view direct reports' attendance
- [ ] Monitor error logs for unexpected authorization failures
- [ ] Update API documentation with new required fields
- [ ] Train users on any workflow changes
- [ ] Rotate database passwords if exposed in git history

---

## Support & Troubleshooting

### Common Issues

**Issue:** "Tenant ID is required" error on login
**Solution:** Set `DEFAULT_TENANT_ID` in backend `.env` file

**Issue:** "Invalid credentials" even with correct password
**Solution:** Verify `tenantId` matches user's actual tenant in database

**Issue:** Can't create new users
**Solution:** Ensure you're logged in as SUPER_ADMIN or HR_ADMIN

**Issue:** Manager can't approve any leaves
**Solution:** Check `employee.managerId` is correctly set in database

**Issue:** Getting 403 errors on attendance access
**Solution:** Verify manager-employee relationships and user roles

---

## Summary

Phase 1 fixes **critical security vulnerabilities**:
- ✅ Multi-tenant authentication isolation
- ✅ Protected registration endpoint
- ✅ Manager authorization scoped to direct reports
- ✅ Row-level security on sensitive data

All changes improve security posture. The breaking changes require frontend updates but are essential for production deployment.

**Next Steps:**
Continue with Phase 2 (Frontend Architectural Fixes) or Phase 3 (Configuration & Dependencies) as per the comprehensive audit plan.
