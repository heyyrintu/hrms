import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockPrismaService, createMockNotificationsService } from '../../../test/helpers';
import { FEED_SOURCE } from '../feed/feed.types';
import { RecognitionService } from './recognition.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RecognitionService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let settings: { get: jest.Mock };
  let feed: { post: jest.Mock; removeBySource: jest.Mock };
  let service: RecognitionService;

  const tenantId = 'tenant-1';
  const giverId = 'giver-1';

  const recipientRows = [
    { id: 'r-1', firstName: 'Alice', lastName: 'A' },
    { id: 'r-2', firstName: 'Bob', lastName: 'B' },
  ];

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    settings = { get: jest.fn().mockResolvedValue({ pointsEnabled: false, monthlyPointsAllowance: 100 }) };
    feed = { post: jest.fn().mockResolvedValue({ id: 'feed-1', created: true }), removeBySource: jest.fn().mockResolvedValue(1) };
    service = new RecognitionService(prisma as any, notifications as any, settings as any, feed as any);

    (prisma.employee.findFirst as jest.Mock).mockResolvedValue({ firstName: 'Giver', lastName: 'Person' });
    (prisma.recognitionRecipient.aggregate as jest.Mock).mockResolvedValue({ _sum: { points: 0 } });
    (prisma.recognition.create as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      message: 'Great job',
    });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
  });

  describe('give', () => {
    it('rejects recognising yourself', async () => {
      await expect(
        service.give(tenantId, giverId, { recipientIds: [giverId], message: 'Nice' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when a recipient is not an active employee of the tenant', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue([recipientRows[0]]); // only 1 of 2

      await expect(
        service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ignores points and skips the advisory lock when points are disabled', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      settings.get.mockResolvedValue({ pointsEnabled: false, monthlyPointsAllowance: 100 });

      await service.give(tenantId, giverId, {
        recipientIds: ['r-1', 'r-2'],
        message: 'Nice',
        points: 50,
      });

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.recognition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pointsPerRecipient: 0 }),
        }),
      );
    });

    it('uses the badge points when dto.points is absent and points are enabled', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'badge-1', name: 'Team Player', icon: '🤝', points: 20 });
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 1000 });

      await service.give(tenantId, giverId, {
        recipientIds: ['r-1', 'r-2'],
        message: 'Nice',
        badgeId: 'badge-1',
      });

      expect(prisma.recognition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pointsPerRecipient: 20, badgeId: 'badge-1' }),
        }),
      );
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('rejects a badgeId that is not an active tenant badge', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', badgeId: 'missing' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when the monthly allowance would be exceeded, naming the remaining amount', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 });
      (prisma.recognitionRecipient.aggregate as jest.Mock).mockResolvedValue({ _sum: { points: 90 } });

      await expect(
        service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', points: 10 }),
      ).rejects.toThrow('Not enough points left this month (10 remaining)');
    });

    it('issues the advisory lock only when cost > 0', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 1000 });

      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', points: 0 });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();

      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', points: 5 });
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('filters the month spend by the IST calendar month, not UTC', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 1000 });

      jest.useFakeTimers().setSystemTime(new Date('2026-03-31T18:00:00Z')); // 23:30 IST, still March
      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', points: 5 });
      let call = (prisma.recognitionRecipient.aggregate as jest.Mock).mock.calls.at(-1)[0];
      expect(call.where.createdAt.lt.toISOString()).toBe('2026-03-31T18:30:00.000Z'); // April 1 IST midnight

      jest.setSystemTime(new Date('2026-03-31T19:00:00Z')); // 00:30 IST, now April
      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice', points: 5 });
      call = (prisma.recognitionRecipient.aggregate as jest.Mock).mock.calls.at(-1)[0];
      expect(call.where.createdAt.gte.toISOString()).toBe('2026-03-31T18:30:00.000Z'); // April 1 IST midnight

      jest.useRealTimers();
    });

    it('posts the recognition to the feed inside the transaction', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);

      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' });

      expect(feed.post).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          type: 'RECOGNITION',
          sourceType: FEED_SOURCE.RECOGNITION,
          sourceId: 'rec-1',
          dedupeKey: 'recognition:rec-1',
        }),
        prisma,
      );
    });

    it('notifies recipients after the transaction commits', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]);

      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' });
      await flush();

      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ tenantId, userId: 'u-1', type: 'RECOGNITION_RECEIVED' }),
        expect.objectContaining({ tenantId, userId: 'u-2', type: 'RECOGNITION_RECEIVED' }),
      ]);
    });

    it('notifies only active users', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);

      await service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' });
      await flush();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId: { in: ['r-1', 'r-2'] }, isActive: true },
        select: { id: true },
      });
    });

    describe('when notifications fail', () => {
      let unhandled: jest.Mock;
      beforeEach(() => {
        unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
      });
      afterEach(() => {
        process.off('unhandledRejection', unhandled);
      });

      it('does not reject give and leaves no unhandled rejection when createMany rejects', async () => {
        (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u-1' }]);
        (notifications.createMany as jest.Mock).mockRejectedValue(new Error('enum missing'));

        await expect(
          service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' }),
        ).resolves.toBeDefined();
        await flush();
        await new Promise((resolve) => setImmediate(resolve));

        expect(notifications.createMany).toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      });

      it('does not reject give and leaves no unhandled rejection when the user lookup rejects', async () => {
        (prisma.employee.findMany as jest.Mock).mockResolvedValue(recipientRows);
        (prisma.user.findMany as jest.Mock).mockRejectedValue(new Error('db blip'));

        await expect(
          service.give(tenantId, giverId, { recipientIds: ['r-1', 'r-2'], message: 'Nice' }),
        ).resolves.toBeDefined();
        await flush();
        await new Promise((resolve) => setImmediate(resolve));

        expect(unhandled).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove', () => {
    it('404s when the recognition is missing', async () => {
      (prisma.recognition.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.remove(tenantId, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes the feed item then deletes the recognition in one transaction', async () => {
      (prisma.recognition.findFirst as jest.Mock).mockResolvedValue({ id: 'rec-1' });

      await service.remove(tenantId, 'rec-1');

      expect(feed.removeBySource).toHaveBeenCalledWith(tenantId, FEED_SOURCE.RECOGNITION, 'rec-1', prisma);
      expect(prisma.recognition.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
    });
  });

  describe('wall', () => {
    it('lists newest first, paginated', async () => {
      (prisma.recognition.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.recognition.count as jest.Mock).mockResolvedValue(0);

      await service.wall(tenantId, { page: 2, limit: 10 });

      expect(prisma.recognition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 10, take: 10 }),
      );
    });

    it('filters by employeeId when given', async () => {
      (prisma.recognition.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.recognition.count as jest.Mock).mockResolvedValue(0);

      await service.wall(tenantId, { page: 1, limit: 20, employeeId: 'r-1' });

      const call = (prisma.recognition.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual(
        expect.objectContaining({ recipients: { some: { employeeId: 'r-1' } } }),
      );
    });
  });

  describe('me', () => {
    it('returns the summary with remaining computed from spent and allowance', async () => {
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 });
      (prisma.recognitionRecipient.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { points: 40 } }) // spentThisMonth
        .mockResolvedValueOnce({ _sum: { points: 200 }, _count: { _all: 8 } }); // received totals

      const result = await service.me(tenantId, 'emp-1');

      expect(result).toEqual({
        pointsEnabled: true,
        allowance: 100,
        spentThisMonth: 40,
        remainingThisMonth: 60,
        receivedPointsTotal: 200,
        receivedCountTotal: 8,
      });
    });

    it('never goes negative when spend exceeds the (now lowered) allowance', async () => {
      settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 10 });
      (prisma.recognitionRecipient.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { points: 40 } })
        .mockResolvedValueOnce({ _sum: { points: 0 }, _count: { _all: 0 } });

      const result = await service.me(tenantId, 'emp-1');

      expect(result.remainingThisMonth).toBe(0);
    });
  });
});
