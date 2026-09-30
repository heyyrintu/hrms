import { Prisma } from '@prisma/client';
import { createMockPrismaService } from '../../../test/helpers';
import { FeedService } from './feed.service';
import { PostFeedItemInput } from './feed.types';

describe('FeedService (write side)', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: FeedService;

  const input: PostFeedItemInput = {
    tenantId: 'tenant-1',
    type: 'RECOGNITION',
    sourceType: 'Recognition',
    sourceId: 'rec-1',
    actorEmployeeId: 'emp-giver',
    title: 'Asha recognised Ravi',
    dedupeKey: 'recognition:rec-1',
  };

  const dedupeWhere = {
    where: { tenantId_dedupeKey: { tenantId: 'tenant-1', dedupeKey: 'recognition:rec-1' } },
    select: { id: true },
  };

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new FeedService(prisma as any);
  });

  describe('post', () => {
    it('throws on an unknown type without touching the database', async () => {
      await expect(
        service.post({ ...input, type: 'GOAL_COMPLETED' as any }),
      ).rejects.toThrow('Unknown feed item type: GOAL_COMPLETED');
      expect(prisma.feedItem.findUnique).not.toHaveBeenCalled();
      expect(prisma.feedItem.create).not.toHaveBeenCalled();
    });

    it('returns the existing id for a known dedupe key and creates nothing', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue({ id: 'feed-1' });

      await expect(service.post(input)).resolves.toEqual({ id: 'feed-1', created: false });
      expect(prisma.feedItem.findUnique).toHaveBeenCalledWith(dedupeWhere);
      expect(prisma.feedItem.create).not.toHaveBeenCalled();
    });

    it('creates a new item with defaults for the optional fields', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.feedItem.create as jest.Mock).mockResolvedValue({ id: 'feed-2' });
      const before = Date.now();

      const result = await service.post({
        tenantId: 'tenant-1',
        type: 'BIRTHDAY',
        sourceType: 'Employee',
        title: 'Happy birthday',
        dedupeKey: 'birthday:emp-1:2026',
      });

      expect(result).toEqual({ id: 'feed-2', created: true });
      const { data, select } = (prisma.feedItem.create as jest.Mock).mock.calls[0][0];
      expect(select).toEqual({ id: true });
      expect(data).toEqual({
        tenantId: 'tenant-1',
        type: 'BIRTHDAY',
        sourceType: 'Employee',
        sourceId: null,
        actorEmployeeId: null,
        subjectEmployeeId: null,
        title: 'Happy birthday',
        body: null,
        payload: {},
        dedupeKey: 'birthday:emp-1:2026',
        occurredAt: expect.any(Date),
        expiresAt: null,
      });
      expect(data.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('keeps the given occurredAt, payload and ids', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.feedItem.create as jest.Mock).mockResolvedValue({ id: 'feed-3' });
      const occurredAt = new Date('2026-03-15T12:00:00Z');

      await service.post({ ...input, body: 'Great work', payload: { badgeId: 'b-1' }, occurredAt });

      const { data } = (prisma.feedItem.create as jest.Mock).mock.calls[0][0];
      expect(data).toEqual(
        expect.objectContaining({
          sourceId: 'rec-1',
          actorEmployeeId: 'emp-giver',
          body: 'Great work',
          payload: { badgeId: 'b-1' },
          occurredAt,
        }),
      );
    });

    it('stores expiresAt when given', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.feedItem.create as jest.Mock).mockResolvedValue({ id: 'feed-exp' });
      const expiresAt = new Date('2026-04-01T12:00:00Z');

      await service.post({ ...input, expiresAt });

      const { data } = (prisma.feedItem.create as jest.Mock).mock.calls[0][0];
      expect(data.expiresAt).toEqual(expiresAt);
    });

    it('uses the transaction client when one is given', async () => {
      const tx = createMockPrismaService();
      (tx.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      (tx.feedItem.create as jest.Mock).mockResolvedValue({ id: 'feed-4' });

      await expect(service.post(input, tx as any)).resolves.toEqual({
        id: 'feed-4',
        created: true,
      });
      expect(tx.feedItem.create).toHaveBeenCalled();
      expect(prisma.feedItem.findUnique).not.toHaveBeenCalled();
      expect(prisma.feedItem.create).not.toHaveBeenCalled();
    });

    it('resolves a create race (P2002) to the winning row', async () => {
      (prisma.feedItem.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'feed-winner' });
      (prisma.feedItem.create as jest.Mock).mockRejectedValue(p2002());

      await expect(service.post(input)).resolves.toEqual({ id: 'feed-winner', created: false });
      expect(prisma.feedItem.findUnique).toHaveBeenCalledTimes(2);
    });

    it('rethrows a P2002 when the row still cannot be found', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      const err = p2002();
      (prisma.feedItem.create as jest.Mock).mockRejectedValue(err);

      await expect(service.post(input)).rejects.toBe(err);
    });

    it('rethrows other errors', async () => {
      (prisma.feedItem.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.feedItem.create as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(service.post(input)).rejects.toThrow('db down');
    });
  });

  describe('removeBySource', () => {
    it('deletes the tenant items for the source and returns the count', async () => {
      (prisma.feedItem.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      await expect(service.removeBySource('tenant-1', 'Announcement', 'ann-1')).resolves.toBe(2);
      expect(prisma.feedItem.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', sourceType: 'Announcement', sourceId: 'ann-1' },
      });
    });

    it('uses the transaction client when one is given', async () => {
      const tx = createMockPrismaService();
      (tx.feedItem.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.removeBySource('tenant-1', 'Announcement', 'ann-1', tx as any)).resolves.toBe(0);
      expect(prisma.feedItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const upsertWhere = {
      tenantId_dedupeKey: { tenantId: 'tenant-1', dedupeKey: 'recognition:rec-1' },
    };

    it('throws on an unknown type without touching the database', async () => {
      await expect(service.refresh({ ...input, type: 'GOAL_COMPLETED' as any })).rejects.toThrow(
        'Unknown feed item type: GOAL_COMPLETED',
      );
      expect(prisma.feedItem.upsert).not.toHaveBeenCalled();
    });

    it('updates the mutable fields of an existing item but never occurredAt, type or source', async () => {
      (prisma.feedItem.upsert as jest.Mock).mockResolvedValue({ id: 'feed-1' });
      const expiresAt = new Date('2026-04-01T12:00:00Z');

      const result = await service.refresh({
        ...input,
        title: 'Edited title',
        body: 'Edited body',
        payload: { priority: 'HIGH' },
        expiresAt,
        subjectEmployeeId: 'emp-subject',
      });

      expect(result).toEqual({ id: 'feed-1' });
      const args = (prisma.feedItem.upsert as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual(upsertWhere);
      expect(args.update).toEqual({
        title: 'Edited title',
        body: 'Edited body',
        payload: { priority: 'HIGH' },
        expiresAt,
        actorEmployeeId: 'emp-giver',
        subjectEmployeeId: 'emp-subject',
      });
      expect(args.update).not.toHaveProperty('occurredAt');
      expect(args.update).not.toHaveProperty('type');
      expect(args.update).not.toHaveProperty('sourceType');
    });

    it('creates the item when it is missing, with the full row', async () => {
      (prisma.feedItem.upsert as jest.Mock).mockResolvedValue({ id: 'feed-new' });
      const occurredAt = new Date('2026-03-15T12:00:00Z');

      await service.refresh({ ...input, occurredAt });

      const args = (prisma.feedItem.upsert as jest.Mock).mock.calls[0][0];
      expect(args.create).toEqual({
        tenantId: 'tenant-1',
        type: 'RECOGNITION',
        sourceType: 'Recognition',
        sourceId: 'rec-1',
        dedupeKey: 'recognition:rec-1',
        occurredAt,
        title: 'Asha recognised Ravi',
        body: null,
        payload: {},
        expiresAt: null,
        actorEmployeeId: 'emp-giver',
        subjectEmployeeId: null,
      });
    });

    it('clears expiresAt on an existing item when none is given', async () => {
      (prisma.feedItem.upsert as jest.Mock).mockResolvedValue({ id: 'feed-1' });

      await service.refresh(input);

      const args = (prisma.feedItem.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.expiresAt).toBeNull();
    });

    it('uses the transaction client when one is given', async () => {
      const tx = createMockPrismaService();
      (tx.feedItem.upsert as jest.Mock).mockResolvedValue({ id: 'feed-tx' });

      await expect(service.refresh(input, tx as any)).resolves.toEqual({ id: 'feed-tx' });
      expect(prisma.feedItem.upsert).not.toHaveBeenCalled();
    });
  });
});
