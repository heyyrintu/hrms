import { Test, TestingModule } from '@nestjs/testing';
import { RequisitionWorkflowHandler } from './requisition-workflow.handler';
import { RequisitionsService, REQUISITIONS_LINK } from './requisitions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';

describe('RequisitionWorkflowHandler', () => {
  let handler: RequisitionWorkflowHandler;
  let prisma: any;
  let requisitions: { approve: jest.Mock; reject: jest.Mock; getWorkflowContext: jest.Mock };

  beforeEach(async () => {
    requisitions = { approve: jest.fn(), reject: jest.fn(), getWorkflowContext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequisitionWorkflowHandler,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: WorkflowRegistry, useValue: { register: jest.fn(), find: jest.fn() } },
        { provide: RequisitionsService, useValue: requisitions },
      ],
    }).compile();

    handler = module.get(RequisitionWorkflowHandler);
    prisma = module.get(PrismaService);
  });

  it('registers with the registry on module init', () => {
    const registry = { register: jest.fn(), find: jest.fn() };
    const h = new RequisitionWorkflowHandler(prisma, registry as any, requisitions as any);
    h.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(h);
  });

  it('delegates getContext to the requisitions service', async () => {
    requisitions.getWorkflowContext.mockResolvedValue(null);
    await handler.getContext('tenant-1', 'req-1');
    expect(requisitions.getWorkflowContext).toHaveBeenCalledWith('tenant-1', 'req-1');
  });

  it('describes an entity with the title format "Requisition · <title> × <headcount>"', async () => {
    prisma.jobRequisition.findMany.mockResolvedValue([
      {
        id: 'req-1',
        title: 'Backend Engineer',
        headcount: 2,
        submittedAt: new Date('2026-01-02T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        requestedById: mockHrAdmin.userId,
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: mockHrAdmin.userId, email: mockHrAdmin.email, employee: { firstName: 'HR', lastName: 'Person' } },
    ]);

    const result = await handler.describe('tenant-1', ['req-1']);

    expect(result).toEqual([
      {
        entityId: 'req-1',
        title: 'Requisition · Backend Engineer × 2',
        subtitle: null,
        requesterName: 'HR Person',
        link: REQUISITIONS_LINK,
        submittedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('returns [] when given no ids', async () => {
    await expect(handler.describe('tenant-1', [])).resolves.toEqual([]);
    expect(prisma.jobRequisition.findMany).not.toHaveBeenCalled();
  });

  it('delegates approve/reject to the requisitions service', async () => {
    await handler.approve(mockHrAdmin, 'req-1', 'ok');
    expect(requisitions.approve).toHaveBeenCalledWith(mockHrAdmin, 'req-1', 'ok');

    await handler.reject(mockHrAdmin, 'req-1', 'no');
    expect(requisitions.reject).toHaveBeenCalledWith(mockHrAdmin, 'req-1', 'no');
  });
});
