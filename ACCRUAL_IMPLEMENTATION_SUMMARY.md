# Leave Accrual System - Implementation Summary

## What Was Implemented

A complete leave accrual system that allows automatic monthly leave accrual for employees based on configurable rules.

## Key Features

1. **Accrual Rules**: Configure how many days employees accrue per month for each leave type
2. **Automatic Processing**: Cron job runs on 1st of every month at 2 AM
3. **Manual Calculation**: Admin can manually trigger accrual for any month/year
4. **Balance Management**: Admin can edit all leave balance fields (total, used, pending, carried over)
5. **Accrual History**: Complete audit trail of all accrual runs with detailed entries
6. **Cap Enforcement**: Optional maximum balance caps with configurable timing

## Files Created

### Backend
- `backend/src/modules/leave/dto/accrual.dto.ts` - DTOs for accrual operations
- `backend/src/modules/leave/leave-accrual.service.ts` - Core business logic
- `backend/src/modules/leave/leave-accrual.controller.ts` - REST API endpoints
- `backend/src/modules/leave/leave-accrual-cron.service.ts` - Scheduled job

### Frontend
- `frontend/src/app/(protected)/admin/accrual-rules/page.tsx` - Manage accrual rules
- `frontend/src/app/(protected)/admin/accrual-history/page.tsx` - View history & trigger manual runs

### Documentation
- `docs/LEAVE_ACCRUAL_SYSTEM.md` - Complete system documentation
- `ACCRUAL_IMPLEMENTATION_SUMMARY.md` - This file

## Files Modified

### Backend
- `backend/prisma/schema.prisma` - Added 3 new models:
  - `LeaveAccrualRule` - Accrual configuration
  - `LeaveAccrualRun` - Processing runs
  - `LeaveAccrualEntry` - Individual accruals
  - Added 2 new enums: `AccrualTriggerType`, `AccrualStatus`
  - Updated `NotificationType` enum with `LEAVE_BALANCE_UPDATED`

- `backend/src/modules/leave/leave.module.ts` - Added accrual services and controller
- `backend/src/modules/leave/leave.service.ts` - Updated `updateBalance()` to support all fields
- `backend/src/modules/leave/dto/leave.dto.ts` - Made `usedDays` and `pendingDays` optional

### Frontend
- `frontend/src/lib/api.ts` - Added `accrualApi` with 8 new endpoints
- `frontend/src/app/(protected)/admin/leave-balances/page.tsx` - Updated to edit all 4 balance fields
- `frontend/src/components/layout/Sidebar.tsx` - Added 4 new admin menu items:
  - Leave Types
  - Leave Balances
  - Accrual Rules
  - Accrual History

## Database Changes

Applied via `npx prisma db push`:

```sql
-- New tables
CREATE TABLE LeaveAccrualRule (...)
CREATE TABLE LeaveAccrualRun (...)
CREATE TABLE LeaveAccrualEntry (...)

-- New enums
CREATE TYPE AccrualTriggerType AS ENUM ('CRON_JOB', 'MANUAL_ADMIN', 'MANUAL_SYSTEM')
CREATE TYPE AccrualStatus AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'ROLLED_BACK')

-- Updated enum
ALTER TYPE NotificationType ADD VALUE 'LEAVE_BALANCE_UPDATED'
```

## API Endpoints Added

### Accrual Rules CRUD
- `POST /leave/admin/accrual/rules` - Create rule
- `GET /leave/admin/accrual/rules` - List rules
- `PUT /leave/admin/accrual/rules/:id` - Update rule
- `DELETE /leave/admin/accrual/rules/:id` - Delete rule

### Accrual Processing
- `POST /leave/admin/accrual/calculate` - Manual trigger
- `GET /leave/admin/accrual/runs` - List runs (with pagination)
- `GET /leave/admin/accrual/runs/:id` - Get run details
- `GET /leave/admin/accrual/runs/:id/entries` - Get entries (with pagination)

All endpoints require `SUPER_ADMIN` or `HR_ADMIN` role.

## How to Use

### 1. Setup Accrual Rules
1. Navigate to **Admin → Accrual Rules**
2. Click **Add Rule**
3. Select leave type
4. Set monthly accrual days (e.g., 2 for 2 days/month)
5. Optionally set max balance cap
6. Choose when to apply cap (monthly or year-end)

### 2. Initialize Leave Balances (if not done)
1. Navigate to **Admin → Leave Balances**
2. Click **Initialize Balances**
3. Select year
4. Click **Initialize**

### 3. Run Accrual
**Automatic** (recommended):
- Wait for 1st of month at 2 AM
- System processes automatically

**Manual** (for testing/corrections):
1. Navigate to **Admin → Accrual History**
2. Click **Calculate Accrual**
3. Select month and year
4. Click **Calculate Accrual**
5. View results in history table

### 4. View Accrual History
1. Navigate to **Admin → Accrual History**
2. See all runs with status and statistics
3. Click **View Details** to see individual accrual entries

### 5. Manually Edit Balances (if needed)
1. Navigate to **Admin → Leave Balances**
2. Click edit icon next to employee's leave type
3. Edit any field:
   - Total Days
   - Carried Over
   - Used Days
   - Pending Days
4. See real-time available balance
5. Click **Save Changes**

## Example Workflow

### Scenario: Company gives 2 sick days per month, capped at 24 days

1. **Create Leave Type**:
   - Name: "Sick Leave"
   - Code: "SL"
   - Default Days: 12

2. **Create Accrual Rule**:
   - Leave Type: Sick Leave
   - Monthly Accrual: 2 days
   - Max Cap: 24 days
   - Apply Cap: On accrual ✓

3. **Initialize Balances** (first time):
   - Year: 2025
   - This creates balance records for all active employees

4. **Automatic Processing**:
   - Every 1st of month, each employee gets +2 sick days
   - If employee already has 23 days, they only get +1 (cap enforced)
   - If employee has 24 days, they get +0 (already at cap)

5. **Monitor**:
   - Check **Accrual History** to see monthly runs
   - View details to see which employees received how many days
   - Check if cap was applied to any employees

## Testing Checklist

- [ ] Create accrual rule successfully
- [ ] Edit accrual rule
- [ ] Delete accrual rule
- [ ] Manually trigger accrual for current month
- [ ] Verify idempotency (try to run same month/year twice)
- [ ] Check accrual history shows run
- [ ] View run details/entries
- [ ] Verify employee received correct accrual days
- [ ] Test cap enforcement (create employee with balance near cap)
- [ ] Edit all 4 balance fields manually
- [ ] Verify balance calculations are correct
- [ ] Check notification sent to employee
- [ ] Verify audit log created

## Known Limitations

1. **No prorating**: Mid-month joiners get full month's accrual
2. **No rollback**: Failed runs cannot be automatically rolled back
3. **No tenure-based rates**: All employees get same accrual rate
4. **April fiscal year**: Fixed to April-March, not configurable

## Future Enhancements (Suggested)

1. Prorate accruals based on join date
2. Different accrual rates based on tenure/department
3. Rollback functionality for failed runs
4. Export accrual history to Excel
5. Email notifications to admins
6. Configurable fiscal year start month
7. Bulk import of accrual rules

## Support

For issues or questions:
- Check `docs/LEAVE_ACCRUAL_SYSTEM.md` for detailed documentation
- Review error messages in accrual history
- Check backend logs for detailed errors
- Verify database constraints are satisfied

---

**Implementation Date**: February 2026
**Status**: ✅ Complete
**Backend Tests**: Not yet implemented
**Frontend Tests**: Not yet implemented
