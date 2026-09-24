import { BadRequestException } from '@nestjs/common';
import { createMockPrismaService } from '../../test/helpers';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { UpsertWorkflowDto } from './dto/upsert-workflow.dto';

const TENANT = 'tenant-1';

describe('WorkflowDefinitionsService', () => {
  let db: any;
  let service: WorkflowDefinitionsService;

  beforeEach(() => {
    db = createMockPrismaService();
    service = new WorkflowDefinitionsService(db);
    db.user.findMany.mockResolvedValue([]);
  });

  describe('list / get', () => {
    it('returns all six types, the default view where there is no row', async () => {
      db.workflowDefinition.findMany.mockResolvedValue([
        {
          id: 'def-1',
          entityType: 'EXPENSE',
          name: 'Expenses',
          adminOverride: false,
          allowSelfApproval: true,
          steps: [
            { stepOrder: 1, name: 'Manager', approverType: 'REPORTING_MANAGER', approverUserId: null, approverRole: null, minAmount: null, minDays: null },
            { stepOrder: 2, name: 'Finance', approverType: 'SPECIFIC_USER', approverUserId: 'u-fin', approverRole: null, minAmount: '50000.00', minDays: null },
          ],
        },
      ]);
      db.user.findMany.mockResolvedValue([
        { id: 'u-fin', email: 'fin@x.com', employee: { firstName: 'Fatima', lastName: 'Fin' } },
      ]);

      const views = await service.list(TENANT);

      expect(views.map((v) => v.entityType).sort()).toEqual(
        ['COMP_OFF', 'EXPENSE', 'LEAVE', 'LOAN', 'PAYROLL_RUN', 'REGULARIZATION'],
      );
      const expense = views.find((v) => v.entityType === 'EXPENSE')!;
      expect(expense.isCustom).toBe(true);
      expect(expense.steps[1]).toEqual({
        order: 2,
        name: 'Finance',
        approverType: 'SPECIFIC_USER',
        approverUserId: 'u-fin',
        approverUserName: 'Fatima Fin',
        approverRole: null,
        minAmount: 50000,
        minDays: null,
      });
      const payroll = views.find((v) => v.entityType === 'PAYROLL_RUN')!;
      expect(payroll).toEqual(
        expect.objectContaining({ isCustom: false, allowSelfApproval: false, adminOverride: true }),
      );
      expect(payroll.steps).toEqual([
        expect.objectContaining({ order: 1, approverType: 'HR_ADMIN' }),
      ]);
    });

    it('returns the default view of one type without a row', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      const view = await service.get(TENANT, 'LEAVE');
      expect(view).toEqual(
        expect.objectContaining({ entityType: 'LEAVE', isCustom: false, name: 'Leave approval' }),
      );
      expect(view.steps).toEqual([
        expect.objectContaining({ order: 1, approverType: 'REPORTING_MANAGER' }),
      ]);
    });
  });

  describe('upsert', () => {
    const valid = (): UpsertWorkflowDto => ({
      name: 'Leave chain',
      adminOverride: false,
      steps: [
        { name: 'Manager', approverType: 'REPORTING_MANAGER' },
        { name: 'HR for long leave', approverType: 'HR_ADMIN', minDays: 5 },
        { name: 'CFO', approverType: 'SPECIFIC_USER', approverUserId: 'u-cfo', minDays: 10 },
        { name: 'Any manager', approverType: 'ROLE', approverRole: 'MANAGER' as any },
      ],
    });

    beforeEach(() => {
      db.workflowDefinition.upsert.mockResolvedValue({ id: 'def-1' });
      db.workflowStep.deleteMany.mockResolvedValue({ count: 1 });
      db.workflowStep.createMany.mockResolvedValue({ count: 4 });
      db.workflowDefinition.findUnique.mockResolvedValue(null);
    });

    it('replaces the steps in one transaction', async () => {
      db.user.findMany.mockResolvedValue([{ id: 'u-cfo' }]);

      await service.upsert(TENANT, 'LEAVE', valid());

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.workflowDefinition.upsert).toHaveBeenCalledWith({
        where: { tenantId_entityType: { tenantId: TENANT, entityType: 'LEAVE' } },
        create: { tenantId: TENANT, entityType: 'LEAVE', name: 'Leave chain', adminOverride: false, allowSelfApproval: true },
        update: { name: 'Leave chain', adminOverride: false, allowSelfApproval: true },
      });
      expect(db.workflowStep.deleteMany).toHaveBeenCalledWith({ where: { definitionId: 'def-1' } });
      expect(db.workflowStep.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ stepOrder: 1, approverType: 'REPORTING_MANAGER', approverUserId: null, approverRole: null, minDays: null }),
        expect.objectContaining({ stepOrder: 2, approverType: 'HR_ADMIN', minDays: 5 }),
        expect.objectContaining({ stepOrder: 3, approverType: 'SPECIFIC_USER', approverUserId: 'u-cfo' }),
        expect.objectContaining({ stepOrder: 4, approverType: 'ROLE', approverRole: 'MANAGER' }),
      ]);
    });

    it('uses the built-in name and flags when omitted', async () => {
      await service.upsert(TENANT, 'PAYROLL_RUN', {
        steps: [{ name: 'HR', approverType: 'HR_ADMIN' }],
      });
      expect(db.workflowDefinition.upsert.mock.calls[0][0].update).toEqual({
        name: 'Payroll run approval',
        adminOverride: true,
        allowSelfApproval: false,
      });
    });

    it.each([
      ['no steps', { steps: [] }, 'between 1 and 10'],
      [
        'more than ten steps',
        { steps: Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, approverType: 'HR_ADMIN' })) },
        'between 1 and 10',
      ],
      ['SPECIFIC_USER without a user', { steps: [{ name: 'X', approverType: 'SPECIFIC_USER' }] }, 'needs an approver user'],
      ['ROLE without a role', { steps: [{ name: 'X', approverType: 'ROLE' }] }, 'needs an approver role'],
      ['a condition on step 1', { steps: [{ name: 'X', approverType: 'HR_ADMIN', minAmount: 100 }] }, 'Step 1 cannot have a condition'],
      [
        'a negative condition',
        { steps: [{ name: 'X', approverType: 'HR_ADMIN' }, { name: 'Y', approverType: 'HR_ADMIN', minDays: -1 }] },
        'must be 0 or more',
      ],
    ])('rejects %s', async (_label, dto, message) => {
      await expect(service.upsert(TENANT, 'EXPENSE', dto as any)).rejects.toThrow(message);
      expect(db.workflowDefinition.upsert).not.toHaveBeenCalled();
    });

    it('rejects a specific approver who is not an active tenant user', async () => {
      db.user.findMany.mockResolvedValue([]);
      await expect(service.upsert(TENANT, 'LEAVE', valid())).rejects.toThrow(BadRequestException);
      expect(db.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, isActive: true, id: { in: ['u-cfo'] } },
        select: { id: true },
      });
    });
  });

  describe('reset', () => {
    it('deletes the tenant row and returns the default view', async () => {
      db.workflowDefinition.deleteMany.mockResolvedValue({ count: 1 });
      const view = await service.reset(TENANT, 'LOAN');
      expect(db.workflowDefinition.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, entityType: 'LOAN' },
      });
      expect(view).toEqual(expect.objectContaining({ entityType: 'LOAN', isCustom: false }));
      expect(view.steps[0].approverType).toBe('HR_ADMIN');
    });
  });
});
