import { Test, TestingModule } from '@nestjs/testing';
import { AttendancePolicyController } from './attendance-policy.controller';
import { AttendancePolicyService } from './attendance-policy.service';
import { mockHrAdmin } from '../../../test/helpers';

describe('AttendancePolicyController', () => {
  let controller: AttendancePolicyController;
  let policyService: { getOrCreate: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    policyService = { getOrCreate: jest.fn(), update: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendancePolicyController],
      providers: [{ provide: AttendancePolicyService, useValue: policyService }],
    }).compile();

    controller = module.get(AttendancePolicyController);
  });

  it('sits on its own prefix, not under /attendance', () => {
    // `AttendanceController` owns `GET /attendance/:employeeId`. Nesting this
    // controller under that prefix would only resolve while it happened to be
    // registered first, so the path is pinned here.
    expect(Reflect.getMetadata('path', AttendancePolicyController)).toBe(
      'attendance-policy',
    );
  });

  it('reads the policy for the caller tenant, never a tenant from the request', async () => {
    const policy = { id: 'pol-1', tenantId: mockHrAdmin.tenantId };
    policyService.getOrCreate.mockResolvedValue(policy);

    await expect(controller.get(mockHrAdmin)).resolves.toBe(policy);
    expect(policyService.getOrCreate).toHaveBeenCalledWith(mockHrAdmin.tenantId);
  });

  it('updates the policy for the caller tenant', async () => {
    const updated = { id: 'pol-1', autoMarkAbsent: true };
    policyService.update.mockResolvedValue(updated);

    await expect(
      controller.update(mockHrAdmin, { autoMarkAbsent: true }),
    ).resolves.toBe(updated);
    expect(policyService.update).toHaveBeenCalledWith(mockHrAdmin.tenantId, {
      autoMarkAbsent: true,
    });
  });
});
