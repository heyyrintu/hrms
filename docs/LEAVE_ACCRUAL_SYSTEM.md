# Leave Accrual System Documentation

## Overview

The Leave Accrual System provides automated monthly leave accrual functionality for the HRMS application. Admin users can configure accrual rules per leave type, and the system will automatically process monthly accruals for all active employees.

## Features

### 1. Accrual Rules Management
- **Configure monthly accrual rates** per leave type (e.g., 2 sick days per month)
- **Set maximum balance caps** to prevent unlimited accrual
- **Choose cap enforcement timing**: Apply cap during monthly accrual OR at year-end
- **CRUD operations** for managing accrual rules

### 2. Automated Monthly Processing
- **Cron job** runs automatically at 2 AM on the 1st of every month
- Processes all active employees across all tenants
- **Idempotent**: Prevents duplicate processing for the same month/year
- Creates audit trail for every accrual run

### 3. Manual Calculation
- Admin can manually trigger accrual for any month/year
- Useful for:
  - Initial setup
  - Missed runs
  - Testing
  - Retroactive corrections

### 4. Leave Balance Management
- Full editing capabilities for all balance fields:
  - **Total Days**: Annual allocation
  - **Carried Over**: Balance from previous year
  - **Used Days**: Already taken leave
  - **Pending Days**: Approved but not yet taken
- Real-time available balance calculation

### 5. Accrual History
- View all accrual runs with detailed information
- See processed employee count, accruals created, and errors
- Drill down into individual accrual entries
- Track which admin user triggered manual runs

## Database Schema

### LeaveAccrualRule
Defines accrual configuration per leave type:
```prisma
model LeaveAccrualRule {
  id                  String    @id @default(uuid())
  tenantId            String
  leaveTypeId         String
  monthlyAccrualDays  Decimal   @db.Decimal(5, 2)  // e.g., 2.00 days/month
  maxBalanceCap       Decimal?  @db.Decimal(5, 2)  // Optional cap (e.g., 30 days)
  applyCapOnAccrual   Boolean   @default(true)     // When to enforce cap
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  // Relations
  tenant              Tenant       @relation(...)
  leaveType           LeaveType    @relation(...)
  accrualEntries      LeaveAccrualEntry[]

  @@unique([tenantId, leaveTypeId])
}
```

### LeaveAccrualRun
Tracks each accrual processing run:
```prisma
model LeaveAccrualRun {
  id                      String            @id @default(uuid())
  tenantId                String
  month                   Int               // 1-12
  year                    Int
  fiscalYear              Int               // Calculated based on April
  triggerType             AccrualTriggerType
  status                  AccrualStatus
  totalEmployeesProcessed Int               @default(0)
  totalAccrualsCreated    Int               @default(0)
  totalErrors             Int               @default(0)
  runByUserId             String?
  runAt                   DateTime          @default(now())
  completedAt             DateTime?
  errorMessage            String?

  // Relations
  tenant                  Tenant              @relation(...)
  runByUser               User?               @relation(...)
  entries                 LeaveAccrualEntry[]

  @@unique([tenantId, month, year])  // Idempotency constraint
}
```

### LeaveAccrualEntry
Individual accrual record per employee/leave type:
```prisma
model LeaveAccrualEntry {
  id              String    @id @default(uuid())
  runId           String
  tenantId        String
  employeeId      String
  leaveTypeId     String
  balanceId       String
  ruleId          String
  balanceBefore   Decimal   @db.Decimal(5, 2)
  accrualDays     Decimal   @db.Decimal(5, 2)
  balanceAfter    Decimal   @db.Decimal(5, 2)
  capApplied      Boolean   @default(false)
  accrualNote     String?
  createdAt       DateTime  @default(now())

  // Relations
  run             LeaveAccrualRun    @relation(...)
  tenant          Tenant             @relation(...)
  employee        Employee           @relation(...)
  leaveType       LeaveType          @relation(...)
  balance         LeaveBalance       @relation(...)
  rule            LeaveAccrualRule   @relation(...)
}
```

## API Endpoints

### Accrual Rules
- `POST /leave/admin/accrual/rules` - Create accrual rule
- `GET /leave/admin/accrual/rules` - List all rules
- `PUT /leave/admin/accrual/rules/:id` - Update rule
- `DELETE /leave/admin/accrual/rules/:id` - Delete rule

### Accrual Processing
- `POST /leave/admin/accrual/calculate` - Manually trigger accrual
  ```json
  {
    "month": 3,           // 1-12
    "year": 2025,
    "employeeIds": [...], // Optional: specific employees only
    "leaveTypeIds": [...]  // Optional: specific leave types only
  }
  ```

### Accrual History
- `GET /leave/admin/accrual/runs` - List all accrual runs
  - Supports pagination: `?page=1&limit=20`
  - Sort order: `?sortOrder=desc`
- `GET /leave/admin/accrual/runs/:id` - Get run details
- `GET /leave/admin/accrual/runs/:id/entries` - Get run entries

### Leave Balance Management
- `PUT /leave/admin/balances/:employeeId/:leaveTypeId/:year` - Update balance
  ```json
  {
    "totalDays": 20,
    "carriedOver": 5,
    "usedDays": 3,      // Optional
    "pendingDays": 2    // Optional
  }
  ```

## Frontend Pages

### 1. Accrual Rules Page
**Route**: `/admin/accrual-rules`

**Features**:
- Table view of all accrual rules
- Create/Edit modal with form validation
- Delete with confirmation
- Shows: Leave type, monthly accrual, max cap, cap timing

### 2. Accrual History Page
**Route**: `/admin/accrual-history`

**Features**:
- Table of all accrual runs
- Manual calculation button with month/year selector
- Status indicators (COMPLETED, PENDING, FAILED, ROLLED_BACK)
- View details modal showing individual accrual entries
- Summary statistics per run

### 3. Leave Balances Page (Updated)
**Route**: `/admin/leave-balances`

**Features**:
- Edit all balance fields (totalDays, usedDays, pendingDays, carriedOver)
- Real-time available balance calculation
- Search and filter by employee/year
- Initialize balances for new year

### 4. Leave Types Page
**Route**: `/admin/leave-types`

**Features**:
- Manage leave types (Annual, Sick, Casual, etc.)
- Configure default days and carry-forward rules

## Business Logic

### Fiscal Year Calculation
```typescript
const fiscalYear = month >= 4 ? year : year - 1;
```
- April to March fiscal year
- Example: March 2025 → FY 2024, April 2025 → FY 2025

### Cap Enforcement
Two modes controlled by `applyCapOnAccrual`:

1. **During Accrual** (`applyCapOnAccrual = true`)
   - Cap is applied when monthly accrual runs
   - If balance + accrual > cap, accrual is reduced
   - Prevents balance from exceeding cap immediately

2. **Year-End** (`applyCapOnAccrual = false`)
   - Accrual is added without checking cap
   - Cap is enforced at fiscal year-end
   - Allows temporary excess during the year

### Idempotency
- Unique constraint on `(tenantId, month, year)` in LeaveAccrualRun
- If accrual already processed for a month, subsequent attempts are skipped
- Prevents accidental duplicate accruals

### Employee Eligibility
Only **ACTIVE** employees are processed:
```typescript
status: EmployeeStatus.ACTIVE
```

### Notifications
After successful accrual:
- Notification sent to each employee
- Type: `LEAVE_BALANCE_UPDATED`
- Message includes accrued days and updated balance

## Cron Job Configuration

**Schedule**: `@Cron('0 2 1 * *')`
- Runs at 2:00 AM on the 1st of every month
- Processes all tenants sequentially
- Continues with remaining tenants if one fails

**Implementation**:
```typescript
@Cron('0 2 1 * *')
async processMonthlyAccrual() {
  const tenants = await this.prisma.tenant.findMany({
    where: { status: TenantStatus.ACTIVE }
  });

  for (const tenant of tenants) {
    try {
      await this.leaveAccrualService.triggerAccrual(tenant.id, {
        month: currentMonth,
        year: currentYear,
        triggerType: AccrualTriggerType.CRON_JOB
      });
    } catch (error) {
      // Log error but continue with next tenant
    }
  }
}
```

## Authorization

All accrual endpoints require **SUPER_ADMIN** or **HR_ADMIN** role:
```typescript
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
```

## Testing Recommendations

### Backend Tests
1. **Accrual Service**:
   - Test cap enforcement logic
   - Test idempotency (duplicate month/year)
   - Test fiscal year calculation
   - Test employee filtering (ACTIVE only)
   - Test notification sending

2. **Accrual Controller**:
   - Test role-based access control
   - Test CRUD operations for rules
   - Test manual trigger validation
   - Test pagination for history

3. **Cron Service**:
   - Mock cron execution
   - Test multi-tenant processing
   - Test error handling

### Frontend Tests
1. **Accrual Rules Page**:
   - Test CRUD operations
   - Test form validation
   - Test modal open/close

2. **Accrual History Page**:
   - Test manual calculation
   - Test details modal
   - Test pagination

3. **Leave Balances Page**:
   - Test all field editing
   - Test balance calculation
   - Test search/filter

## Configuration Example

### Step 1: Create Leave Type
```json
{
  "name": "Sick Leave",
  "code": "SL",
  "defaultDays": 12,
  "isPaid": true
}
```

### Step 2: Create Accrual Rule
```json
{
  "leaveTypeId": "uuid-of-sick-leave",
  "monthlyAccrualDays": 1,           // 1 day per month
  "maxBalanceCap": 24,                // Cap at 24 days
  "applyCapOnAccrual": true           // Enforce cap monthly
}
```

### Step 3: Initialize Balances
```json
{
  "year": 2025
}
```

### Step 4: Run Accrual (Auto or Manual)
- Auto: Wait for 1st of month at 2 AM
- Manual: Click "Calculate Accrual" button

## Troubleshooting

### Issue: Accrual not processing
**Checklist**:
- ✅ Accrual rule exists for leave type
- ✅ Employee status is ACTIVE
- ✅ Balance record exists for employee/leave type/year
- ✅ No previous run for same month/year (check idempotency)

### Issue: Cap not being applied
**Check**:
- `applyCapOnAccrual` setting in rule
- If false, cap is applied at year-end, not monthly

### Issue: Duplicate accruals
**Not Possible**: Idempotency constraint prevents duplicates
- Unique constraint on `(tenantId, month, year)`
- Database will reject duplicate runs

## Migration from Manual Management

1. **Create accrual rules** for all leave types
2. **Calculate current fiscal year accruals** manually if mid-year
3. **Let cron job handle future months** automatically
4. **Adjust balances manually** if needed using Leave Balances page

## Future Enhancements

1. **Prorating for mid-month joiners**
2. **Different accrual rates based on tenure**
3. **Rollback functionality** for failed runs
4. **Export accrual history** to Excel
5. **Email notifications** to admins on accrual completion
6. **Department-specific accrual rules**
7. **Carry-forward limits** integration with accrual caps

---

**Last Updated**: February 2026
**Version**: 1.0
**Author**: HRMS Development Team
