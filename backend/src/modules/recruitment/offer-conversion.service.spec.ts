import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';
import { OfferConversionService } from './offer-conversion.service';

const TENANT = 'test-tenant';
const RESPONDED = new Date('2026-03-15T12:00:00Z');

function acceptedOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'off-1',
    status: 'ACCEPTED',
    employeeId: null,
    respondedAt: RESPONDED,
    joiningDate: new Date('2026-04-01T00:00:00Z'),
    designationId: 'des-1',
    departmentId: 'dep-1',
    branchId: null,
    reportingManagerId: 'emp-mgr',
    employmentType: 'PERMANENT',
    monthlyBasePay: new Prisma.Decimal(50000),
    salaryStructureId: 'ss-1',
    applicationId: 'app-1',
    candidate: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+91 90000 00000' },
    application: { id: 'app-1', status: 'ACTIVE', jobOpening: { requisitionId: 'req-1' } },
    ...overrides,
  };
}

describe('OfferConversionService', () => {
  let prisma: any;
  let employees: { create: jest.Mock };
  let onboarding: { createProcess: jest.Mock };
  let applications: { moveToStage: jest.Mock };
  let requisitions: { recordHire: jest.Mock };
  let service: OfferConversionService;
  const dto = { employeeCode: 'EMP-101', onboardingTemplateId: 'onb-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    employees = { create: jest.fn().mockResolvedValue({ id: 'emp-new' }) };
    onboarding = { createProcess: jest.fn().mockResolvedValue({ id: 'proc-1' }) };
    applications = { moveToStage: jest.fn().mockResolvedValue(undefined) };
    requisitions = { recordHire: jest.fn().mockResolvedValue(undefined) };
    service = new OfferConversionService(
      prisma,
      employees as any,
      onboarding as any,
      applications as any,
      requisitions as any,
    );

    prisma.jobOffer.findFirst.mockResolvedValue(acceptedOffer());
    prisma.onboardingTemplate.findFirst.mockResolvedValue({ id: 'onb-1' });
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
    prisma.employeeSalary.create.mockResolvedValue({ id: 'sal-1' });
  });

  it('runs the whole flow: employee, salary, offer + application + requisition, onboarding', async () => {
    const result = await service.convert(mockHrAdmin, 'off-1', dto);

    expect(result).toEqual({ employeeId: 'emp-new', employeeSalaryId: 'sal-1', onboardingProcessId: 'proc-1' });

    // 1. The existing employee-creation path, placement from the offer.
    expect(employees.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        employeeCode: 'EMP-101',
        firstName: 'Asha',
        lastName: 'Rao',
        email: 'asha@example.com',
        phone: '+91 90000 00000',
        designationId: 'des-1',
        departmentId: 'dep-1',
        managerId: 'emp-mgr',
        employmentType: 'PERMANENT',
        joinDate: '2026-04-01',
        createUser: false,
      }),
    );

    // 2 + 4 in one transaction, the offer update guarded against a double convert.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'off-1', tenantId: TENANT, status: 'ACCEPTED', employeeId: null },
      data: { employeeId: 'emp-new', convertedAt: expect.any(Date) },
    });
    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId: TENANT,
          employeeId: 'emp-new',
          salaryStructureId: 'ss-1',
          basePay: new Prisma.Decimal(50000),
          effectiveFrom: new Date('2026-04-01T00:00:00Z'),
          isActive: true,
        },
      }),
    );
    expect(applications.moveToStage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, applicationId: 'app-1', toCategory: 'HIRED', tx: prisma }),
    );
    expect(requisitions.recordHire).toHaveBeenCalledWith(TENANT, 'req-1', prisma);

    // 3. Onboarding from the joining date.
    expect(onboarding.createProcess).toHaveBeenCalledWith(TENANT, {
      employeeId: 'emp-new',
      templateId: 'onb-1',
      startDate: '2026-04-01',
    });
  });

  it('creates a login with the candidate email by default when asked', async () => {
    await service.convert(mockHrAdmin, 'off-1', { employeeCode: 'E1', createUser: true, userPassword: 'secret-123' });
    expect(employees.create.mock.calls[0][1]).toMatchObject({
      createUser: true,
      userEmail: 'asha@example.com',
      userPassword: 'secret-123',
      userRole: 'EMPLOYEE',
    });
  });

  it('requires a password to create a login', async () => {
    await expect(
      service.convert(mockHrAdmin, 'off-1', { employeeCode: 'E1', createUser: true }),
    ).rejects.toThrow(BadRequestException);
    expect(employees.create).not.toHaveBeenCalled();
  });

  it('409s an offer that was already converted — converting twice never makes two employees', async () => {
    prisma.jobOffer.findFirst.mockResolvedValue(acceptedOffer({ employeeId: 'emp-new' }));
    await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow(ConflictException);
    expect(employees.create).not.toHaveBeenCalled();
  });

  it('409s when a concurrent conversion won the guarded update', async () => {
    prisma.jobOffer.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow(ConflictException);
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
    expect(onboarding.createProcess).not.toHaveBeenCalled();
  });

  it('resumes after a failure past step 1 by reusing the employee created after acceptance', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-earlier' });

    const result = await service.convert(mockHrAdmin, 'off-1', dto);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, email: 'asha@example.com', createdAt: { gte: RESPONDED } },
      }),
    );
    expect(employees.create).not.toHaveBeenCalled();
    expect(result.employeeId).toBe('emp-earlier');
    expect(prisma.jobOffer.updateMany.mock.calls[0][0].data.employeeId).toBe('emp-earlier');
  });

  it('only converts ACCEPTED offers of the tenant', async () => {
    prisma.jobOffer.findFirst.mockResolvedValueOnce(null);
    await expect(service.convert(mockHrAdmin, 'off-x', dto)).rejects.toThrow(NotFoundException);
    expect(prisma.jobOffer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'off-x', tenantId: TENANT } }),
    );
    prisma.jobOffer.findFirst.mockResolvedValueOnce(acceptedOffer({ status: 'SENT' }));
    await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow(BadRequestException);
  });

  it('validates the onboarding template before creating anything', async () => {
    prisma.onboardingTemplate.findFirst.mockResolvedValue(null);
    await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow(BadRequestException);
    expect(prisma.onboardingTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'onb-1', tenantId: TENANT, isActive: true } }),
    );
    expect(employees.create).not.toHaveBeenCalled();
  });

  it('propagates EmployeesService conflicts (employee code in use) before any other write', async () => {
    employees.create.mockRejectedValue(new ConflictException('Employee code already exists'));
    await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow('Employee code already exists');
    expect(prisma.jobOffer.updateMany).not.toHaveBeenCalled();
  });

  it('skips the salary without structure + base pay, the requisition without one, and a non-active application', async () => {
    prisma.jobOffer.findFirst.mockResolvedValue(
      acceptedOffer({
        salaryStructureId: null,
        application: { id: 'app-1', status: 'HIRED', jobOpening: { requisitionId: null } },
      }),
    );
    const result = await service.convert(mockHrAdmin, 'off-1', { employeeCode: 'E1' });
    expect(result).toEqual({ employeeId: 'emp-new', employeeSalaryId: null, onboardingProcessId: null });
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
    expect(applications.moveToStage).not.toHaveBeenCalled();
    expect(requisitions.recordHire).not.toHaveBeenCalled();
    expect(onboarding.createProcess).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'WITHDRAWN'])(
    '409s an accepted offer whose application was %s, before creating anything',
    async (status) => {
      prisma.jobOffer.findFirst.mockResolvedValue(
        acceptedOffer({ application: { id: 'app-1', status, jobOpening: { requisitionId: 'req-1' } } }),
      );
      await expect(service.convert(mockHrAdmin, 'off-1', dto)).rejects.toThrow(ConflictException);
      expect(employees.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(requisitions.recordHire).not.toHaveBeenCalled();
    },
  );

  it('keeps the conversion when onboarding fails afterwards', async () => {
    onboarding.createProcess.mockRejectedValue(new Error('boom'));
    const result = await service.convert(mockHrAdmin, 'off-1', dto);
    expect(result.employeeId).toBe('emp-new');
    expect(result.onboardingProcessId).toBeNull();
  });
});
