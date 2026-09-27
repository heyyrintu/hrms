import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PayrollAdjustmentsController } from './payroll-adjustments.controller';
import { OneTimePaymentsService } from './one-time-payments.service';
import { SalaryArrearsService } from './salary-arrears.service';
import { SalaryHoldsService } from './salary-holds.service';
import { PayrollReimbursementsService } from './payroll-reimbursements.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollService } from '../payroll.service';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';

describe('PayrollAdjustmentsController', () => {
  let controller: PayrollAdjustmentsController;
  const user = { userId: 'user-hr', tenantId: 'tenant-1', email: 'hr@x.test', role: UserRole.HR_ADMIN };

  const oneTime = { listForRun: jest.fn(), create: jest.fn(), remove: jest.fn() };
  const arrears = { list: jest.fn(), detectForEmployee: jest.fn(), cancel: jest.fn() };
  const holds = {
    listForRun: jest.fn(), list: jest.fn(), hold: jest.fn(), unhold: jest.fn(),
    release: jest.fn(), void: jest.fn(),
  };
  const reimbursements = { getForRun: jest.fn() };
  const settings = { get: jest.fn(), update: jest.fn() };
  const payroll = { listRunSettlements: jest.fn(), attachSettlement: jest.fn(), detachSettlement: jest.fn() };

  beforeEach(async () => {
    for (const mock of [oneTime, arrears, holds, reimbursements, settings, payroll]) {
      Object.values(mock).forEach((fn) => fn.mockReset().mockResolvedValue('ok'));
    }
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollAdjustmentsController],
      providers: [
        { provide: OneTimePaymentsService, useValue: oneTime },
        { provide: SalaryArrearsService, useValue: arrears },
        { provide: SalaryHoldsService, useValue: holds },
        { provide: PayrollReimbursementsService, useValue: reimbursements },
        { provide: PayrollSettingsService, useValue: settings },
        { provide: PayrollService, useValue: payroll },
      ],
    }).compile();
    controller = module.get(PayrollAdjustmentsController);
  });

  it('is HR_ADMIN / SUPER_ADMIN only, behind the JWT and roles guards', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PayrollAdjustmentsController)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.HR_ADMIN,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, PayrollAdjustmentsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it('scopes settings to the caller tenant', async () => {
    await controller.getSettings(user);
    expect(settings.get).toHaveBeenCalledWith('tenant-1');
    await controller.updateSettings(user, { autoArrears: false });
    expect(settings.update).toHaveBeenCalledWith('tenant-1', { autoArrears: false });
  });

  it('delegates one-time payments', async () => {
    await controller.listOneTimePayments(user, 'run-1');
    expect(oneTime.listForRun).toHaveBeenCalledWith('tenant-1', 'run-1');
    const dto = { employeeId: 'emp-1', kind: 'BONUS' as const, name: 'Bonus', amount: 100 };
    await controller.createOneTimePayment(user, 'run-1', dto);
    expect(oneTime.create).toHaveBeenCalledWith(user, 'run-1', dto);
    await expect(controller.deleteOneTimePayment(user, 'otp-1')).resolves.toEqual({
      message: 'One-time payment deleted',
    });
    expect(oneTime.remove).toHaveBeenCalledWith('tenant-1', 'otp-1');
  });

  it('delegates arrears', async () => {
    await controller.listArrears(user, { status: 'PENDING' });
    expect(arrears.list).toHaveBeenCalledWith('tenant-1', { status: 'PENDING' });
    await controller.detectArrears(user, { employeeId: 'emp-1' });
    expect(arrears.detectForEmployee).toHaveBeenCalledWith('tenant-1', 'emp-1');
    await controller.cancelArrear(user, 'ar-1');
    expect(arrears.cancel).toHaveBeenCalledWith('tenant-1', 'ar-1');
  });

  it('delegates holds', async () => {
    await controller.listRunHolds(user, 'run-1');
    expect(holds.listForRun).toHaveBeenCalledWith('tenant-1', 'run-1');
    await controller.listHolds(user, { status: 'HELD' });
    expect(holds.list).toHaveBeenCalledWith('tenant-1', 'HELD');
    await controller.holdSalary(user, 'run-1', { employeeId: 'emp-1', reason: 'x' });
    expect(holds.hold).toHaveBeenCalledWith(user, 'run-1', { employeeId: 'emp-1', reason: 'x' });
    await controller.unhold(user, 'hold-1');
    expect(holds.unhold).toHaveBeenCalledWith('tenant-1', 'hold-1');
    await controller.releaseHold(user, 'hold-1', { targetRunId: 'run-2' });
    expect(holds.release).toHaveBeenCalledWith(user, 'hold-1', 'run-2');
    await controller.voidHold(user, 'hold-1', { reason: 'gone' });
    expect(holds.void).toHaveBeenCalledWith(user, 'hold-1', 'gone');
  });

  it('delegates reimbursements and settlements', async () => {
    await controller.getRunReimbursements(user, 'run-1');
    expect(reimbursements.getForRun).toHaveBeenCalledWith('tenant-1', 'run-1');
    await controller.listRunSettlements(user, 'run-oc');
    expect(payroll.listRunSettlements).toHaveBeenCalledWith('tenant-1', 'run-oc');
    await controller.attachSettlement(user, 'run-oc', { settlementId: 'set-1' });
    expect(payroll.attachSettlement).toHaveBeenCalledWith('tenant-1', 'run-oc', 'set-1');
    await controller.detachSettlement(user, 'run-oc', 'set-1');
    expect(payroll.detachSettlement).toHaveBeenCalledWith('tenant-1', 'run-oc', 'set-1');
  });
});
