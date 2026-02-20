import { PrismaService } from '../../prisma/prisma.service';

const prismaModelMethods = [
  'findUnique',
  'findFirst',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
];

const prismaModels = [
  'tenant',
  'user',
  'employee',
  'department',
  'attendanceRecord',
  'attendanceSession',
  'leaveType',
  'leaveBalance',
  'leaveRequest',
  'holiday',
  'shift',
  'shiftAssignment',
  'otRule',
  'employeeDocument',
  'upload',
  'notification',
  'announcement',
  'employeeChangeRequest',
  'salaryStructure',
  'salaryComponent',
  'employeeSalary',
  'payrollRun',
  'payslip',
  'payslipLineItem',
  'expenseCategory',
  'expenseClaim',
  'expenseItem',
  'onboardingTemplate',
  'onboardingTaskDefinition',
  'onboardingProcess',
  'onboardingTask',
  'auditLog',
  'reviewCycle',
  'performanceReview',
  'goal',
  'designation',
  'branch',
  'letterTemplate',
  'letterGenerated',
  'separation',
  'leaveAccrualRule',
  'leaveAccrualEntry',
  'attendanceRegularization',
  'compOffRequest',
  'feedback',
  'improvementPlan',
];

function createModelMock() {
  const mock: Record<string, jest.Mock> = {};
  for (const method of prismaModelMethods) {
    mock[method] = jest.fn();
  }
  return mock;
}

export function createMockPrismaService(): jest.Mocked<PrismaService> {
  const mock: Record<string, unknown> = {};

  for (const model of prismaModels) {
    mock[model] = createModelMock();
  }

  // Mock $transaction to execute callback with the mock itself
  mock.$transaction = jest.fn().mockImplementation(async (cb: unknown) => {
    if (typeof cb === 'function') {
      return cb(mock);
    }
    // If array of promises, resolve them
    if (Array.isArray(cb)) {
      return Promise.all(cb);
    }
    return cb;
  });

  mock.$connect = jest.fn();
  mock.$disconnect = jest.fn();

  return mock as unknown as jest.Mocked<PrismaService>;
}
