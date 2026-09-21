import { Test, TestingModule } from '@nestjs/testing';
import { AccrualTriggerType, UserRole } from '@prisma/client';
import { LeaveCarryForwardController } from './leave-carry-forward.controller';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const mockService = {
  runCarryForward: jest.fn(),
  getRuns: jest.fn(),
};

describe('LeaveCarryForwardController', () => {
  let controller: LeaveCarryForwardController;

  const hrAdmin: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveCarryForwardController],
      providers: [
        { provide: LeaveCarryForwardService, useValue: mockService },
      ],
    }).compile();

    controller = module.get(LeaveCarryForwardController);
  });

  it('runs the carry-forward for the caller tenant as a manual admin trigger', async () => {
    mockService.runCarryForward.mockResolvedValue({
      runId: 'run-1',
      processedCount: 3,
      failedCount: 0,
      alreadyRan: false,
    });

    const result = await controller.run(hrAdmin, { fromYear: 2025 });

    expect(mockService.runCarryForward).toHaveBeenCalledWith(
      'tenant-1',
      2025,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-hr',
    );
    expect(result).toEqual({
      runId: 'run-1',
      processedCount: 3,
      failedCount: 0,
      alreadyRan: false,
    });
  });

  it('never takes the tenant from the request body', async () => {
    mockService.runCarryForward.mockResolvedValue({
      runId: 'run-1',
      processedCount: 0,
      failedCount: 0,
      alreadyRan: false,
    });

    await controller.run(hrAdmin, {
      fromYear: 2025,
      tenantId: 'other-tenant',
    } as any);

    expect(mockService.runCarryForward).toHaveBeenCalledWith(
      'tenant-1',
      2025,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-hr',
    );
  });

  it('lists the runs for the caller tenant', async () => {
    mockService.getRuns.mockResolvedValue([{ id: 'run-1' }]);

    const result = await controller.getRuns(hrAdmin);

    expect(mockService.getRuns).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual([{ id: 'run-1' }]);
  });
});
