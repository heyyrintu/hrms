import { Prisma } from '@prisma/client';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';
import { OfferWorkflowHandler } from './offer-workflow.handler';

describe('OfferWorkflowHandler', () => {
  let prisma: any;
  let registry: { register: jest.Mock };
  let offers: { getWorkflowContext: jest.Mock; approve: jest.Mock; reject: jest.Mock };
  let handler: OfferWorkflowHandler;

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    offers = {
      getWorkflowContext: jest.fn().mockResolvedValue(null),
      approve: jest.fn().mockResolvedValue({ id: 'off-1' }),
      reject: jest.fn().mockResolvedValue({ id: 'off-1' }),
    };
    handler = new OfferWorkflowHandler(prisma, registry as any, offers as any);
  });

  it('registers itself for OFFER', () => {
    handler.onModuleInit();
    expect(handler.entityType).toBe('OFFER');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates context, approve and reject to OffersService', async () => {
    await handler.getContext('t1', 'off-1');
    expect(offers.getWorkflowContext).toHaveBeenCalledWith('t1', 'off-1');
    await handler.approve(mockHrAdmin, 'off-1', 'ok');
    expect(offers.approve).toHaveBeenCalledWith(mockHrAdmin, 'off-1', 'ok');
    await handler.reject(mockHrAdmin, 'off-1', 'no');
    expect(offers.reject).toHaveBeenCalledWith(mockHrAdmin, 'off-1', 'no');
  });

  it('describes offers for the inbox, tenant-scoped', async () => {
    prisma.jobOffer.findMany.mockResolvedValue([
      {
        id: 'off-1',
        annualCtc: new Prisma.Decimal(1200000),
        createdById: 'u-hr',
        createdAt: new Date('2026-03-14T12:00:00Z'),
        updatedAt: new Date('2026-03-15T12:00:00Z'),
        status: 'PENDING_APPROVAL',
        candidate: { firstName: 'Asha', lastName: 'Rao' },
        application: { jobOpening: { title: 'Backend Engineer' } },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-hr', email: 'hr@x.com', employee: { firstName: 'Hema', lastName: 'R' } },
    ]);

    const [summary] = await handler.describe('t1', ['off-1']);

    expect(prisma.jobOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', id: { in: ['off-1'] } } }),
    );
    expect(summary).toEqual({
      entityId: 'off-1',
      title: 'Offer · Asha Rao · Backend Engineer',
      subtitle: '₹12,00,000 annual CTC',
      requesterName: 'Hema R',
      link: '/recruitment/offers',
      submittedAt: '2026-03-15T12:00:00.000Z',
    });
  });

  it('names the submitter, not the creator, as the requester', async () => {
    prisma.jobOffer.findMany.mockResolvedValue([
      {
        id: 'off-1',
        annualCtc: new Prisma.Decimal(1200000),
        createdById: 'u-hr-a',
        submittedById: 'u-hr-b',
        createdAt: new Date('2026-03-14T12:00:00Z'),
        updatedAt: new Date('2026-03-15T12:00:00Z'),
        status: 'PENDING_APPROVAL',
        candidate: { firstName: 'Asha', lastName: 'Rao' },
        application: { jobOpening: { title: 'Backend Engineer' } },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-hr-a', email: 'a@x.com', employee: { firstName: 'Anil', lastName: 'A' } },
      { id: 'u-hr-b', email: 'b@x.com', employee: { firstName: 'Bina', lastName: 'B' } },
    ]);

    const [summary] = await handler.describe('t1', ['off-1']);

    expect(summary.requesterName).toBe('Bina B');
  });

  it('describes nothing for no ids', async () => {
    await expect(handler.describe('t1', [])).resolves.toEqual([]);
    expect(prisma.jobOffer.findMany).not.toHaveBeenCalled();
  });
});
