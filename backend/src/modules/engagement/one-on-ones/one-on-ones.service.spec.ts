import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OneOnOneStatus } from '@prisma/client';
import { OneOnOnesService } from './one-on-ones.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { createMockPrismaService, createMockNotificationsService } from '../../../test/helpers';

describe('OneOnOnesService', () => {
  let service: OneOnOnesService;
  let prisma: any;
  let notifications: any;

  const tenantId = 'tenant-1';
  const managerId = 'emp-manager';
  const employeeId = 'emp-employee';
  const meetingId = 'meeting-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OneOnOnesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get(OneOnOnesService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  const meeting = (overrides: Record<string, unknown> = {}) => ({
    id: meetingId,
    tenantId,
    managerId,
    employeeId,
    scheduledAt: new Date('2026-03-15T12:00:00Z'),
    status: OneOnOneStatus.SCHEDULED,
    agenda: null,
    sharedNotes: null,
    createdById: managerId,
    completedAt: null,
    createdAt: new Date('2026-03-01T12:00:00Z'),
    updatedAt: new Date('2026-03-01T12:00:00Z'),
    ...overrides,
  });

  // ---- create ----
  describe('create', () => {
    it('creates a meeting when the caller is the counterpart manager', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({
          id: managerId,
          managerId: null,
          firstName: 'Mona',
          lastName: 'Manager',
        })
        .mockResolvedValueOnce({
          id: employeeId,
          managerId,
          firstName: 'Eve',
          lastName: 'Employee',
        });
      prisma.oneOnOneMeeting.create.mockResolvedValue(meeting());

      const result = await service.create(tenantId, managerId, {
        counterpartId: employeeId,
        scheduledAt: '2026-03-15T12:00:00Z',
      });

      expect(prisma.oneOnOneMeeting.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          managerId,
          employeeId,
          scheduledAt: new Date('2026-03-15T12:00:00Z'),
          agenda: undefined,
          createdById: managerId,
        },
      });
      expect(result).toEqual(meeting());
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.ONE_ON_ONE_SCHEDULED,
        'One-on-one scheduled',
        expect.stringContaining('Mona Manager scheduled a one-on-one for'),
        `/one-on-ones/${meetingId}`,
      );
    });

    it('creates a meeting when the caller is a direct report', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({
          id: employeeId,
          managerId,
          firstName: 'Eve',
          lastName: 'Employee',
        })
        .mockResolvedValueOnce({
          id: managerId,
          managerId: null,
          firstName: 'Mona',
          lastName: 'Manager',
        });
      prisma.oneOnOneMeeting.create.mockResolvedValue(meeting());

      await service.create(tenantId, employeeId, {
        counterpartId: managerId,
        scheduledAt: '2026-03-15T12:00:00Z',
      });

      expect(prisma.oneOnOneMeeting.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          managerId,
          employeeId,
          scheduledAt: new Date('2026-03-15T12:00:00Z'),
          agenda: undefined,
          createdById: employeeId,
        },
      });
    });

    it('403s when the caller and counterpart are unrelated', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: employeeId, managerId: 'someone-else', firstName: 'Eve', lastName: 'Employee' })
        .mockResolvedValueOnce({ id: 'emp-other', managerId: 'nobody', firstName: 'Otto', lastName: 'Other' });

      await expect(
        service.create(tenantId, employeeId, {
          counterpartId: 'emp-other',
          scheduledAt: '2026-03-15T12:00:00Z',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.oneOnOneMeeting.create).not.toHaveBeenCalled();
    });

    it('400s when scheduling with yourself', async () => {
      await expect(
        service.create(tenantId, employeeId, {
          counterpartId: employeeId,
          scheduledAt: '2026-03-15T12:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('404s when the counterpart is not an active tenant employee', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: employeeId, managerId: null, firstName: 'Eve', lastName: 'Employee' })
        .mockResolvedValueOnce(null);

      await expect(
        service.create(tenantId, employeeId, {
          counterpartId: 'emp-inactive',
          scheduledAt: '2026-03-15T12:00:00Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not fail creation when the notification throws', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: managerId, managerId: null, firstName: 'Mona', lastName: 'Manager' })
        .mockResolvedValueOnce({ id: employeeId, managerId, firstName: 'Eve', lastName: 'Employee' });
      prisma.oneOnOneMeeting.create.mockResolvedValue(meeting());
      notifications.notifyEmployee.mockRejectedValueOnce(new Error('notify down'));

      await expect(
        service.create(tenantId, managerId, {
          counterpartId: employeeId,
          scheduledAt: '2026-03-15T12:00:00Z',
        }),
      ).resolves.toEqual(meeting());
    });
  });

  // ---- access guard, shared by get/update/action items/private note ----
  describe('participant access guard', () => {
    it('404s when the caller is not a participant (including HR_ADMIN)', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(null);

      await expect(service.get(tenantId, 'emp-hr-not-participant', meetingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.oneOnOneMeeting.findFirst).toHaveBeenCalledWith({
        where: {
          id: meetingId,
          tenantId,
          OR: [{ managerId: 'emp-hr-not-participant' }, { employeeId: 'emp-hr-not-participant' }],
        },
      });
    });
  });

  // ---- get ----
  describe('get', () => {
    it('returns the meeting with counterpart, myRole, action items and my own private note', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.employee.findFirst.mockResolvedValue({
        id: employeeId,
        firstName: 'Eve',
        lastName: 'Employee',
        employeeCode: 'E-1',
      });
      prisma.oneOnOneActionItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.oneOnOnePrivateNote.findUnique.mockResolvedValue({ content: 'only mine' });

      const result = await service.get(tenantId, managerId, meetingId);

      expect(prisma.oneOnOnePrivateNote.findUnique).toHaveBeenCalledWith({
        where: { meetingId_authorId: { meetingId, authorId: managerId } },
      });
      expect(result.myRole).toBe('MANAGER');
      expect(result.myPrivateNote).toBe('only mine');
      expect(result.actionItems).toEqual([{ id: 'item-1' }]);
    });

    it('never returns another participant\'s private note', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.employee.findFirst.mockResolvedValue({ id: managerId, firstName: 'Mona', lastName: 'Manager' });
      prisma.oneOnOneActionItem.findMany.mockResolvedValue([]);
      // The caller's own note lookup always resolves null here — the point
      // is the query is always scoped by the caller's own authorId.
      prisma.oneOnOnePrivateNote.findUnique.mockResolvedValue(null);

      const result = await service.get(tenantId, employeeId, meetingId);

      expect(prisma.oneOnOnePrivateNote.findUnique).toHaveBeenCalledWith({
        where: { meetingId_authorId: { meetingId, authorId: employeeId } },
      });
      expect(result.myPrivateNote).toBeNull();
    });
  });

  // ---- update ----
  describe('update', () => {
    it('sets completedAt when status moves to COMPLETED', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneMeeting.update.mockResolvedValue(meeting({ status: OneOnOneStatus.COMPLETED }));

      await service.update(tenantId, managerId, meetingId, { status: OneOnOneStatus.COMPLETED });

      expect(prisma.oneOnOneMeeting.update).toHaveBeenCalledWith({
        where: { id: meetingId },
        data: { status: OneOnOneStatus.COMPLETED, completedAt: expect.any(Date) },
      });
    });

    it('400s moving a CANCELLED meeting back to SCHEDULED', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting({ status: OneOnOneStatus.CANCELLED }));

      await expect(
        service.update(tenantId, managerId, meetingId, { status: OneOnOneStatus.SCHEDULED }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.oneOnOneMeeting.update).not.toHaveBeenCalled();
    });

    it('allows notes on a CANCELLED meeting', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting({ status: OneOnOneStatus.CANCELLED }));
      prisma.oneOnOneMeeting.update.mockResolvedValue(meeting({ status: OneOnOneStatus.CANCELLED }));

      await service.update(tenantId, managerId, meetingId, { sharedNotes: 'notes after cancel' });

      expect(prisma.oneOnOneMeeting.update).toHaveBeenCalledWith({
        where: { id: meetingId },
        data: { sharedNotes: 'notes after cancel' },
      });
    });
  });

  // ---- action items ----
  describe('action items', () => {
    it('adds an item when the assignee is a participant', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneActionItem.create.mockResolvedValue({ id: 'item-1' });

      await service.addItem(tenantId, managerId, meetingId, {
        text: 'Follow up on X',
        assigneeId: employeeId,
      });

      expect(prisma.oneOnOneActionItem.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          meetingId,
          text: 'Follow up on X',
          assigneeId: employeeId,
          dueDate: undefined,
        },
      });
    });

    it('400s when the assignee is not a participant', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());

      await expect(
        service.addItem(tenantId, managerId, meetingId, {
          text: 'Follow up on X',
          assigneeId: 'someone-else',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.oneOnOneActionItem.create).not.toHaveBeenCalled();
    });

    it('404s updating an item that does not belong to the meeting', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneActionItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem(tenantId, managerId, meetingId, 'item-x', { isDone: true }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.oneOnOneActionItem.update).not.toHaveBeenCalled();
    });

    it('updates an item that belongs to the meeting', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneActionItem.findFirst.mockResolvedValue({ id: 'item-1', meetingId, tenantId });
      prisma.oneOnOneActionItem.update.mockResolvedValue({ id: 'item-1', isDone: true });

      await service.updateItem(tenantId, managerId, meetingId, 'item-1', { isDone: true });

      expect(prisma.oneOnOneActionItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { isDone: true },
      });
    });

    it('404s removing an item that does not belong to the meeting', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneActionItem.findFirst.mockResolvedValue(null);

      await expect(service.removeItem(tenantId, managerId, meetingId, 'item-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.oneOnOneActionItem.delete).not.toHaveBeenCalled();
    });

    it('removes an item that belongs to the meeting', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOneActionItem.findFirst.mockResolvedValue({ id: 'item-1', meetingId, tenantId });
      prisma.oneOnOneActionItem.delete.mockResolvedValue({ id: 'item-1' });

      await service.removeItem(tenantId, managerId, meetingId, 'item-1');

      expect(prisma.oneOnOneActionItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
    });
  });

  // ---- private note ----
  describe('upsertPrivateNote', () => {
    it('upserts on the compound (meetingId, authorId) unique', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());
      prisma.oneOnOnePrivateNote.upsert.mockResolvedValue({ content: 'note text' });

      await service.upsertPrivateNote(tenantId, managerId, meetingId, { content: 'note text' });

      expect(prisma.oneOnOnePrivateNote.upsert).toHaveBeenCalledWith({
        where: { meetingId_authorId: { meetingId, authorId: managerId } },
        create: { tenantId, meetingId, authorId: managerId, content: 'note text' },
        update: { content: 'note text' },
      });
    });

    it('deletes the note when content trims to empty', async () => {
      prisma.oneOnOneMeeting.findFirst.mockResolvedValue(meeting());

      const result = await service.upsertPrivateNote(tenantId, managerId, meetingId, {
        content: '   ',
      });

      expect(prisma.oneOnOnePrivateNote.deleteMany).toHaveBeenCalledWith({
        where: { meetingId, authorId: managerId },
      });
      expect(prisma.oneOnOnePrivateNote.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ content: null });
    });
  });

  // ---- list, openItems, counterparts ----
  describe('list', () => {
    it('returns meetings newest scheduledAt first with counterpart and myRole', async () => {
      prisma.oneOnOneMeeting.findMany.mockResolvedValue([meeting()]);
      prisma.employee.findMany.mockResolvedValue([
        { id: employeeId, firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1' },
      ]);

      const result = await service.list(tenantId, managerId, {});

      expect(prisma.oneOnOneMeeting.findMany).toHaveBeenCalledWith({
        where: { tenantId, OR: [{ managerId }, { employeeId: managerId }] },
        orderBy: { scheduledAt: 'desc' },
      });
      expect(result[0].myRole).toBe('MANAGER');
      expect(result[0].counterpart).toEqual({
        id: employeeId,
        firstName: 'Eve',
        lastName: 'Employee',
        employeeCode: 'E-1',
      });
    });

    it('filters by counterpartId when given', async () => {
      prisma.oneOnOneMeeting.findMany.mockResolvedValue([]);

      await service.list(tenantId, managerId, { counterpartId: employeeId });

      expect(prisma.oneOnOneMeeting.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          AND: [
            { OR: [{ managerId }, { employeeId: managerId }] },
            { OR: [{ managerId: employeeId }, { employeeId }] },
          ],
        },
        orderBy: { scheduledAt: 'desc' },
      });
    });
  });

  describe('openItems', () => {
    it('returns undone items across meetings in either direction', async () => {
      prisma.oneOnOneMeeting.findMany.mockResolvedValue([{ id: meetingId }]);
      prisma.oneOnOneActionItem.findMany.mockResolvedValue([{ id: 'item-1', isDone: false }]);

      const result = await service.openItems(tenantId, managerId, employeeId);

      expect(prisma.oneOnOneMeeting.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          OR: [
            { managerId, employeeId },
            { managerId: employeeId, employeeId: managerId },
          ],
        },
        select: { id: true },
      });
      expect(prisma.oneOnOneActionItem.findMany).toHaveBeenCalledWith({
        where: { tenantId, meetingId: { in: [meetingId] }, isDone: false },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([{ id: 'item-1', isDone: false }]);
    });

    it('short-circuits with no meetings', async () => {
      prisma.oneOnOneMeeting.findMany.mockResolvedValue([]);

      const result = await service.openItems(tenantId, managerId, employeeId);

      expect(result).toEqual([]);
      expect(prisma.oneOnOneActionItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('counterparts', () => {
    it('returns the active manager and active direct reports', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ managerId: 'emp-boss' }) // me
        .mockResolvedValueOnce({
          id: 'emp-boss',
          firstName: 'Boss',
          lastName: 'Person',
          employeeCode: 'E-0',
        }); // active manager
      prisma.employee.findMany.mockResolvedValue([
        { id: employeeId, firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1' },
      ]);

      const result = await service.counterparts(tenantId, managerId);

      expect(prisma.employee.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: 'emp-boss', tenantId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { managerId, tenantId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
        orderBy: { firstName: 'asc' },
      });
      expect(result).toEqual([
        { id: 'emp-boss', firstName: 'Boss', lastName: 'Person', employeeCode: 'E-0', relation: 'MANAGER' },
        { id: employeeId, firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1', relation: 'REPORT' },
      ]);
    });

    it('omits the manager slot when there is none', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce({ managerId: null });
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.counterparts(tenantId, managerId);

      expect(result).toEqual([]);
    });
  });
});
