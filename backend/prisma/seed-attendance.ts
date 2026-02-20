/**
 * Seed attendance records for January and February 2026
 * for all active employees in the dev tenant.
 *
 * Run: npx tsx prisma/seed-attendance.ts
 */

import { PrismaClient, AttendanceStatus } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = 'dev-tenant-001';

/** Returns true if the date falls on a weekday (Mon–Fri) */
function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/** Generate all weekdays in a given year/month (1-indexed month) */
function weekdaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (isWeekday(date)) days.push(date);
  }
  return days;
}

/**
 * Build a realistic attendance record for a given date.
 * ~92% PRESENT, ~5% LEAVE, ~3% ABSENT
 */
function buildRecord(
  tenantId: string,
  employeeId: string,
  date: Date,
  index: number,
): {
  tenantId: string;
  employeeId: string;
  date: Date;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  workedMinutes: number;
  standardWorkMinutes: number;
  otMinutesCalculated: number;
  status: AttendanceStatus;
  remarks: string | null;
} {
  // Deterministic variation based on index to spread leave/absent evenly
  const roll = index % 20; // 0-19 cycle
  const isLeave = roll === 18; // 1 in 20 = 5%
  const isAbsent = roll === 19; // 1 in 20 = 5%

  if (isLeave) {
    return {
      tenantId,
      employeeId,
      date,
      clockInTime: null,
      clockOutTime: null,
      workedMinutes: 0,
      standardWorkMinutes: 480,
      otMinutesCalculated: 0,
      status: AttendanceStatus.LEAVE,
      remarks: 'Approved leave',
    };
  }

  if (isAbsent) {
    return {
      tenantId,
      employeeId,
      date,
      clockInTime: null,
      clockOutTime: null,
      workedMinutes: 0,
      standardWorkMinutes: 480,
      otMinutesCalculated: 0,
      status: AttendanceStatus.ABSENT,
      remarks: null,
    };
  }

  // PRESENT — clock in at 9:00 AM UTC, clock out at 6:30 PM UTC (9.5 hours total - 1h break = 8.5h worked)
  // Slight variation: some days have OT
  const hasOt = index % 5 === 0; // every 5th day has OT
  const clockInHour = 9;
  const clockOutHour = hasOt ? 19 : 18; // 7 PM vs 6 PM
  const clockOutMinute = hasOt ? 30 : 0;

  const clockIn = new Date(date);
  clockIn.setUTCHours(clockInHour, 0, 0, 0);

  const clockOut = new Date(date);
  clockOut.setUTCHours(clockOutHour, clockOutMinute, 0, 0);

  const totalMinutes = (clockOut.getTime() - clockIn.getTime()) / 60000;
  const breakMinutes = 60;
  const workedMinutes = totalMinutes - breakMinutes;
  const standardWorkMinutes = 480;
  const otMinutesCalculated = Math.max(0, workedMinutes - standardWorkMinutes);

  return {
    tenantId,
    employeeId,
    date,
    clockInTime: clockIn,
    clockOutTime: clockOut,
    workedMinutes,
    standardWorkMinutes,
    otMinutesCalculated,
    status: AttendanceStatus.PRESENT,
    remarks: null,
  };
}

async function main() {
  console.log('🌱 Seeding attendance records for Jan & Feb 2026...\n');

  const employees = await prisma.employee.findMany({
    where: { tenantId: TENANT_ID, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  });

  if (employees.length === 0) {
    console.error('❌ No active employees found. Run the main seed first.');
    process.exit(1);
  }

  console.log(`Found ${employees.length} employees: ${employees.map(e => e.employeeCode).join(', ')}\n`);

  const months = [
    { year: 2026, month: 1, label: 'January 2026' },
    { year: 2026, month: 2, label: 'February 2026' },
  ];

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const emp of employees) {
    let empCreated = 0;
    let dayIndex = 0;

    for (const { year, month, label } of months) {
      const days = weekdaysInMonth(year, month);

      for (const date of days) {
        const record = buildRecord(TENANT_ID, emp.id, date, dayIndex++);

        try {
          await prisma.attendanceRecord.upsert({
            where: {
              tenantId_employeeId_date: {
                tenantId: TENANT_ID,
                employeeId: emp.id,
                date,
              },
            },
            update: {}, // Don't overwrite existing records
            create: record,
          });
          empCreated++;
          totalCreated++;
        } catch {
          totalSkipped++;
        }
      }

      console.log(`  ✅ ${emp.firstName} ${emp.lastName} — ${label}: ${days.length} days`);
    }

    console.log(`     Total created: ${empCreated} records\n`);
  }

  console.log('─'.repeat(50));
  console.log(`✅ Done! Created ${totalCreated} records, skipped ${totalSkipped} (already existed)`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
