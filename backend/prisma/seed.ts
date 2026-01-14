import { PrismaClient, UserRole, EmploymentType, PayType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: 'DEV' },
    update: {},
    create: {
      id: 'dev-tenant-001',
      name: 'Development Company',
      code: 'DEV',
    },
  });

  console.log('✅ Created tenant:', tenant.name);

  // Create departments
  const engineering = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'ENG' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Engineering',
      code: 'ENG',
      description: 'Software Engineering Department',
    },
  });

  const hr = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'HR' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Human Resources',
      code: 'HR',
      description: 'Human Resources Department',
    },
  });

  const operations = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'OPS' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Operations',
      code: 'OPS',
      description: 'Operations Department',
    },
  });

  console.log('✅ Created departments');

  // Create leave types
  const leaveTypes = [
    { code: 'CL', name: 'Casual Leave', defaultDays: 12, isPaid: true },
    { code: 'SL', name: 'Sick Leave', defaultDays: 12, isPaid: true },
    { code: 'PL', name: 'Privilege Leave', defaultDays: 15, isPaid: true, carryForward: true, maxCarryForward: 30 },
    { code: 'LOP', name: 'Loss of Pay', defaultDays: 0, isPaid: false },
    { code: 'WFH', name: 'Work From Home', defaultDays: 24, isPaid: true },
  ];

  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: lt.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        ...lt,
      },
    });
  }

  console.log('✅ Created leave types');

  // Create OT rules
  await prisma.otRule.upsert({
    // We cannot use the composite unique key with a null employmentType in the where clause,
    // so use a stable id-based upsert for the default rule.
    where: { id: `${tenant.id}-default-ot-rule` },
    update: {},
    create: {
      id: `${tenant.id}-default-ot-rule`,
      tenantId: tenant.id,
      name: 'Default OT Rule',
      employmentType: null,
      dailyThresholdMinutes: 480, // 8 hours
      roundingIntervalMinutes: 15,
      requiresManagerApproval: true,
      maxOtPerDayMinutes: 240, // 4 hours max OT per day
      maxOtPerMonthMinutes: 3600, // 60 hours max OT per month
    },
  });

  await prisma.otRule.upsert({
    where: { tenantId_employmentType: { tenantId: tenant.id, employmentType: 'TEMPORARY' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Temporary Employee OT Rule',
      employmentType: 'TEMPORARY',
      dailyThresholdMinutes: 480,
      roundingIntervalMinutes: 15,
      requiresManagerApproval: false, // Auto-approve for temp employees
      maxOtPerDayMinutes: 360, // 6 hours max OT per day
    },
  });

  console.log('✅ Created OT rules');

  // Create employees
  const passwordHash = await bcrypt.hash('password123', 10);

  // Super Admin (System-wide admin who can manage companies)
  const superAdmin = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP000' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeCode: 'EMP000',
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin@example.com',
      phone: '+1234567899',
      employmentType: 'PERMANENT',
      payType: 'MONTHLY',
      departmentId: hr.id,
      designation: 'System Administrator',
      joinDate: new Date('2023-01-01'),
      status: 'ACTIVE',
    },
  });

  // Create Super Admin user
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'superadmin@example.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'superadmin@example.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      employeeId: superAdmin.id,
    },
  });

  // HR Admin
  const hrAdmin = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeCode: 'EMP001',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@example.com',
      phone: '+1234567890',
      employmentType: 'PERMANENT',
      payType: 'MONTHLY',
      departmentId: hr.id,
      designation: 'HR Manager',
      joinDate: new Date('2023-01-01'),
      status: 'ACTIVE',
    },
  });

  // Create HR Admin user
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@example.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@example.com',
      passwordHash,
      role: 'HR_ADMIN',
      employeeId: hrAdmin.id,
    },
  });

  // Engineering Manager
  const engManager = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP002' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeCode: 'EMP002',
      firstName: 'John',
      lastName: 'Manager',
      email: 'manager@example.com',
      phone: '+1234567891',
      employmentType: 'PERMANENT',
      payType: 'MONTHLY',
      departmentId: engineering.id,
      designation: 'Engineering Manager',
      joinDate: new Date('2023-01-15'),
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'manager@example.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'manager@example.com',
      passwordHash,
      role: 'MANAGER',
      employeeId: engManager.id,
    },
  });

  // Regular Employee
  const employee1 = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP003' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeCode: 'EMP003',
      firstName: 'Jane',
      lastName: 'Developer',
      email: 'employee@example.com',
      phone: '+1234567892',
      employmentType: 'PERMANENT',
      payType: 'MONTHLY',
      departmentId: engineering.id,
      designation: 'Software Developer',
      managerId: engManager.id,
      joinDate: new Date('2023-06-01'),
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'employee@example.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'employee@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employeeId: employee1.id,
    },
  });

  // Temporary/Hourly Employee
  const tempEmployee = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP004' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeCode: 'EMP004',
      firstName: 'Bob',
      lastName: 'Contractor',
      email: 'contractor@example.com',
      phone: '+1234567893',
      employmentType: 'TEMPORARY',
      payType: 'HOURLY',
      hourlyRate: 25.00,
      otMultiplier: 1.5,
      departmentId: operations.id,
      designation: 'Operations Assistant',
      joinDate: new Date('2024-01-01'),
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'contractor@example.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'contractor@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employeeId: tempEmployee.id,
    },
  });

  console.log('✅ Created employees and users');

  // Create leave balances for current year
  const currentYear = new Date().getFullYear();
  const allLeaveTypes = await prisma.leaveType.findMany({
    where: { tenantId: tenant.id },
  });

  const employees = [superAdmin, hrAdmin, engManager, employee1, tempEmployee];

  for (const emp of employees) {
    for (const lt of allLeaveTypes) {
      await prisma.leaveBalance.upsert({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId: tenant.id,
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year: currentYear,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          employeeId: emp.id,
          leaveTypeId: lt.id,
          year: currentYear,
          totalDays: lt.defaultDays,
        },
      });
    }
  }

  console.log('✅ Created leave balances');

  console.log('');
  console.log('🎉 Seed completed successfully!');
  console.log('');
  console.log('📧 Test accounts (password: password123):');
  console.log('   - Super Admin: superadmin@example.com (Can manage companies)');
  console.log('   - HR Admin: admin@example.com');
  console.log('   - Manager: manager@example.com');
  console.log('   - Employee: employee@example.com');
  console.log('   - Contractor: contractor@example.com');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
