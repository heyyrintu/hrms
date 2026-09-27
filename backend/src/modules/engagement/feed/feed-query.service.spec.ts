import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FeedQueryService } from './feed-query.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('FeedQueryService', () => {
  let service: FeedQueryService;
  let prisma: any;
  let settings: { get: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';

  beforeEach(async () => {
    settings = { get: jest.fn().mockResolvedValue({
      pointsEnabled: false,
      monthlyPointsAllowance: 100,
      showBirthdays: true,
      showAnniversaries: true,
    }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedQueryService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EngagementSettingsService, useValue: settings },
      ],
    }).compile();

    service = module.get(FeedQueryService);
    prisma = module.get(PrismaService);
  });

  describe('list', () => {
    const baseRow = (over: Partial<any> = {}) => ({
      id: 'item-1',
      tenantId,
      type: 'ANNOUNCEMENT',
      sourceType: 'Announcement',
      sourceId: 'ann-1',
      actorEmployeeId: 'emp-actor',
      subjectEmployeeId: null,
      title: 'Hello',
      body: 'World',
      payload: {},
      occurredAt: new Date('2026-03-15T12:00:00Z'),
      isHidden: false,
      createdAt: new Date('2026-03-15T12:00:00Z'),
      ...over,
    });

    it('filters hidden types by settings', async () => {
      settings.get.mockResolvedValue({
        pointsEnabled: false,
        monthlyPointsAllowance: 100,
        showBirthdays: false,
        showAnniversaries: false,
      });
      prisma.feedItem.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      await service.list(tenantId, employeeId, { limit: 20 });

      expect(prisma.feedItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            isHidden: false,
            type: { notIn: ['BIRTHDAY', 'WORK_ANNIVERSARY'] },
          }),
        }),
      );
    });

    it('does not add a type filter when both toggles are on', async () => {
      prisma.feedItem.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      await service.list(tenantId, employeeId, { limit: 20 });

      const args = prisma.feedItem.findMany.mock.calls[0][0];
      expect(args.where.type).toBeUndefined();
    });

    it('applies the keyset cursor condition and 404s when the cursor item is missing', async () => {
      prisma.feedItem.findFirst.mockResolvedValue(null);

      await expect(
        service.list(tenantId, employeeId, { cursor: 'missing', limit: 20 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('builds the OR condition from the cursor item', async () => {
      const cursorItem = { id: 'cursor-1', occurredAt: new Date('2026-03-10T00:00:00Z') };
      prisma.feedItem.findFirst.mockResolvedValue(cursorItem);
      prisma.feedItem.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      await service.list(tenantId, employeeId, { cursor: 'cursor-1', limit: 20 });

      const args = prisma.feedItem.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { occurredAt: { lt: cursorItem.occurredAt } },
        { occurredAt: cursorItem.occurredAt, id: { lt: cursorItem.id } },
      ]);
    });

    it('returns nextCursor null on the last page', async () => {
      prisma.feedItem.findMany.mockResolvedValue([baseRow()]);
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page.nextCursor).toBeNull();
      expect(page.items).toHaveLength(1);
    });

    it('returns a nextCursor when there are more rows than the limit', async () => {
      const rows = [baseRow({ id: 'a' }), baseRow({ id: 'b' })];
      prisma.feedItem.findMany.mockResolvedValue(rows);
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe('a');
    });

    it('sets actor to null when the actor employee is missing', async () => {
      prisma.feedItem.findMany.mockResolvedValue([baseRow({ actorEmployeeId: 'ghost' })]);
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page.items[0].actor).toBeNull();
    });

    it('joins actor and subject names', async () => {
      prisma.feedItem.findMany.mockResolvedValue([
        baseRow({ actorEmployeeId: 'emp-actor', subjectEmployeeId: 'emp-subject' }),
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-actor', firstName: 'Ann', lastName: 'Actor' },
        { id: 'emp-subject', firstName: 'Sam', lastName: 'Subject' },
      ]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page.items[0].actor).toEqual({ id: 'emp-actor', firstName: 'Ann', lastName: 'Actor' });
      expect(page.items[0].subject).toEqual({ id: 'emp-subject', firstName: 'Sam', lastName: 'Subject' });
    });

    it('defaults reaction counts to 0 and myReactions to empty', async () => {
      prisma.feedItem.findMany.mockResolvedValue([baseRow()]);
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page.items[0].reactionCounts).toEqual({ LIKE: 0, CELEBRATE: 0 });
      expect(page.items[0].myReactions).toEqual([]);
    });

    it('maps groupBy counts and my reactions onto the right item', async () => {
      prisma.feedItem.findMany.mockResolvedValue([baseRow({ id: 'item-1' })]);
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.feedReaction.groupBy.mockResolvedValue([
        { feedItemId: 'item-1', kind: 'LIKE', _count: 3 },
        { feedItemId: 'item-1', kind: 'CELEBRATE', _count: 1 },
      ]);
      prisma.feedReaction.findMany.mockResolvedValue([
        { feedItemId: 'item-1', kind: 'LIKE' },
      ]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page.items[0].reactionCounts).toEqual({ LIKE: 3, CELEBRATE: 1 });
      expect(page.items[0].myReactions).toEqual(['LIKE']);
    });

    it('returns an empty page without querying employees or reactions', async () => {
      prisma.feedItem.findMany.mockResolvedValue([]);

      const page = await service.list(tenantId, employeeId, { limit: 20 });

      expect(page).toEqual({ items: [], nextCursor: null });
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
      expect(prisma.feedReaction.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('toggleReaction', () => {
    it('404s when the item does not exist in the tenant', async () => {
      prisma.feedItem.findFirst.mockResolvedValue(null);

      await expect(
        service.toggleReaction(tenantId, employeeId, 'missing', 'LIKE' as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the item is hidden', async () => {
      prisma.feedItem.findFirst.mockResolvedValue(null);

      await expect(
        service.toggleReaction(tenantId, employeeId, 'hidden-item', 'LIKE' as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.feedItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'hidden-item', tenantId, isHidden: false } }),
      );
    });

    it('creates a reaction when absent', async () => {
      prisma.feedItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.feedReaction.findFirst.mockResolvedValue(null);
      prisma.feedReaction.create.mockResolvedValue({ id: 'reaction-1' });
      prisma.feedReaction.groupBy.mockResolvedValue([{ kind: 'LIKE', _count: 1 }]);
      prisma.feedReaction.findMany.mockResolvedValue([{ kind: 'LIKE' }]);

      const result = await service.toggleReaction(tenantId, employeeId, 'item-1', 'LIKE' as any);

      expect(prisma.feedReaction.create).toHaveBeenCalledWith({
        data: { tenantId, feedItemId: 'item-1', employeeId, kind: 'LIKE' },
      });
      expect(result).toEqual({ reactionCounts: { LIKE: 1, CELEBRATE: 0 }, myReactions: ['LIKE'] });
    });

    it('deletes the reaction when present (toggle off)', async () => {
      prisma.feedItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.feedReaction.findFirst.mockResolvedValue({ id: 'reaction-1' });
      prisma.feedReaction.groupBy.mockResolvedValue([]);
      prisma.feedReaction.findMany.mockResolvedValue([]);

      const result = await service.toggleReaction(tenantId, employeeId, 'item-1', 'LIKE' as any);

      expect(prisma.feedReaction.delete).toHaveBeenCalledWith({ where: { id: 'reaction-1' } });
      expect(result).toEqual({ reactionCounts: { LIKE: 0, CELEBRATE: 0 }, myReactions: [] });
    });

    it('treats a P2002 on create as already-reacted and still returns counts', async () => {
      const { Prisma } = require('@prisma/client');
      prisma.feedItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.feedReaction.findFirst.mockResolvedValue(null);
      prisma.feedReaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
      );
      prisma.feedReaction.groupBy.mockResolvedValue([{ kind: 'LIKE', _count: 1 }]);
      prisma.feedReaction.findMany.mockResolvedValue([{ kind: 'LIKE' }]);

      const result = await service.toggleReaction(tenantId, employeeId, 'item-1', 'LIKE' as any);

      expect(result).toEqual({ reactionCounts: { LIKE: 1, CELEBRATE: 0 }, myReactions: ['LIKE'] });
    });
  });

  describe('hide', () => {
    it('hides the item', async () => {
      prisma.feedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.hide(tenantId, 'item-1');

      expect(prisma.feedItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1', tenantId },
        data: { isHidden: true },
      });
    });

    it('404s when nothing matched', async () => {
      prisma.feedItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.hide(tenantId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
