import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { TimesheetsService } from './timesheets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { createMockNotificationsService, createMockPrismaService } from '../../test/helpers';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (n: number | string) => new Prisma.Decimal(n);

const tenantId = 'test-tenant';
const WEEK = '2026-03-16'; // Monday
const NOW = new Date('2026-03-18T06:00:00Z'); // 18 Mar 11:30 IST

const owner: AuthenticatedUser = {
  userId: 'user-1',
  email: 'e@test.com',
  tenantId,
  role: UserRole.EMPLOYEE,
  employeeId: 'emp-1',
};

describe('TimesheetsService (save, submit, recall, my week)', () => {
  let service: TimesheetsService;
  let prisma: any;
  let engine: Record<string, jest.Mock>;
  let notifications: ReturnType<typeof createMockNotificationsService>;

  beforeAll(() => {
    // Fake only the clock so promises and timers behave normally.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'clearImmediate',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
  });
  afterAll(() => jest.useRealTimers());

  /** Prisma fixtures for one ACTIVE project the owner is a member of. */
  const project = { id: 'p1', code: 'ALPHA', name: 'Alpha', status: 'ACTIVE', billable: true };
  const member = { projectId: 'p1', startDate: d('2026-01-01'), endDate: null };

  const stubProjectWorld = (
    over: {
      projects?: any[];
      tasks?: any[];
      openCounts?: Array<{ projectId: string; _count: { _all: number } }>;
      members?: any[];
    } = {},
  ) => {
    prisma.project.findMany.mockResolvedValue(over.projects ?? [project]);
    prisma.projectTask.findMany.mockResolvedValue(over.tasks ?? []);
    prisma.projectTask.groupBy.mockResolvedValue(over.openCounts ?? []);
    prisma.projectMember.findMany.mockResolvedValue(over.members ?? [member]);
  };

  const entry = (over: Record<string, unknown> = {}) => ({
    date: '2026-03-16',
    projectId: 'p1',
    hours: 4,
    ...over,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimesheetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalEngineService, useValue: engine },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(TimesheetsService);

    prisma.attendanceRecord.findMany.mockResolvedValue([]);
    prisma.timesheet.findUnique.mockResolvedValue(null);
    prisma.timesheet.upsert.mockResolvedValue({ id: 'ts-1' });
    prisma.timesheetEntry.deleteMany.mockResolvedValue({ count: 0 });
    prisma.timesheetEntry.createMany.mockResolvedValue({ count: 1 });
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    stubProjectWorld();
  });

  describe('saveEntries', () => {
    const save = (entries: any[], week = WEEK) =>
      service.saveEntries(owner, d(week), { entries });

    it('requires an employee record', async () => {
      await expect(
        service.saveEntries({ ...owner, employeeId: undefined }, d(WEEK), { entries: [] }),
      ).rejects.toThrow('No employee record linked to this user');
    });

    it('rejects a weekStart that is not a Monday', async () => {
      await expect(save([entry()], '2026-03-17')).rejects.toThrow(/Monday/);
    });

    it('rejects a week more than one week in the future', async () => {
      await expect(save([entry({ date: '2026-03-30' })], '2026-03-30')).rejects.toThrow(
        /future/,
      );
    });

    it('allows next week as a draft', async () => {
      await expect(save([entry({ date: '2026-03-23' })], '2026-03-23')).resolves.toBeDefined();
    });

    it.each(['SUBMITTED', 'APPROVED'])('refuses to edit a %s timesheet', async (status) => {
      prisma.timesheet.findUnique.mockResolvedValue({ id: 'ts-1', status });
      await expect(save([entry()])).rejects.toThrow(BadRequestException);
      expect(prisma.timesheetEntry.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an entry dated outside the week', async () => {
      await expect(save([entry({ date: '2026-03-23' })])).rejects.toThrow(/outside the week/);
    });

    it.each([0, 24.5, 1.234, -1])('rejects hours of %p', async (hours) => {
      await expect(save([entry({ hours })])).rejects.toThrow(BadRequestException);
    });

    it('rejects more than 200 entries', async () => {
      const many = Array.from({ length: 201 }, () => entry({ hours: 0.01 }));
      await expect(save(many)).rejects.toThrow(/200/);
    });

    it('rejects a project that is not ACTIVE', async () => {
      stubProjectWorld({ projects: [{ ...project, status: 'ON_HOLD' }] });
      await expect(save([entry()])).rejects.toThrow(/not active/);
    });

    it('rejects an unknown project', async () => {
      stubProjectWorld({ projects: [] });
      await expect(save([entry()])).rejects.toThrow(/Project not found/);
    });

    it('rejects a date no membership window covers, naming the date', async () => {
      stubProjectWorld({ members: [{ ...member, startDate: d('2026-03-17') }] });
      await expect(save([entry({ date: '2026-03-16' })])).rejects.toThrow(/2026-03-16/);
    });

    it('rejects a task of another project', async () => {
      stubProjectWorld({
        tasks: [{ id: 't1', projectId: 'other', status: 'OPEN', billable: null }],
      });
      await expect(save([entry({ taskId: 't1' })])).rejects.toThrow(/task/i);
    });

    it('rejects a CLOSED task', async () => {
      stubProjectWorld({
        tasks: [{ id: 't1', projectId: 'p1', status: 'CLOSED', billable: null }],
      });
      await expect(save([entry({ taskId: 't1' })])).rejects.toThrow(/closed/i);
    });

    it('requires a task when the project has OPEN tasks', async () => {
      stubProjectWorld({ openCounts: [{ projectId: 'p1', _count: { _all: 2 } }] });
      await expect(save([entry()])).rejects.toThrow('Select a task');
    });

    it('rejects a day totalling more than 24 hours', async () => {
      await expect(save([entry({ hours: 12 }), entry({ hours: 12.5 })])).rejects.toThrow(
        /2026-03-16/,
      );
    });

    it('accepts a day that totals exactly 24 hours', async () => {
      await expect(save([entry({ hours: 12 }), entry({ hours: 12 })])).resolves.toBeDefined();
    });

    it('replaces the week inside one transaction with billable captured', async () => {
      stubProjectWorld({
        projects: [{ ...project, billable: true }],
        tasks: [
          { id: 't1', projectId: 'p1', status: 'OPEN', billable: false },
          { id: 't2', projectId: 'p1', status: 'OPEN', billable: null },
        ],
        openCounts: [{ projectId: 'p1', _count: { _all: 2 } }],
      });
      await save([
        entry({ taskId: 't1', hours: 3.5, note: 'a' }),
        entry({ taskId: 't2', hours: 4, date: '2026-03-17' }),
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.timesheet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_employeeId_weekStart: {
              tenantId,
              employeeId: 'emp-1',
              weekStart: d(WEEK),
            },
          },
          create: expect.objectContaining({ status: 'DRAFT', weekStart: d(WEEK) }),
        }),
      );
      expect(prisma.timesheet.upsert.mock.calls[0][0].update).not.toHaveProperty('status');
      expect(prisma.timesheet.upsert.mock.calls[0][0].update.totalHours.toString()).toBe('7.5');
      expect(prisma.timesheetEntry.deleteMany).toHaveBeenCalledWith({
        where: { timesheetId: 'ts-1' },
      });
      const rows = prisma.timesheetEntry.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        tenantId,
        timesheetId: 'ts-1',
        date: d('2026-03-16'),
        projectId: 'p1',
        taskId: 't1',
        billable: false,
        note: 'a',
      });
      expect(rows[1]).toMatchObject({ taskId: 't2', billable: true, note: null });
    });

    it('uses the project flag when there is no task', async () => {
      stubProjectWorld({ projects: [{ ...project, billable: false }] });
      await save([entry()]);
      expect(prisma.timesheetEntry.createMany.mock.calls[0][0].data[0].billable).toBe(false);
    });

    it('keeps a REJECTED timesheet REJECTED', async () => {
      prisma.timesheet.findUnique.mockResolvedValue({
        id: 'ts-1',
        status: 'REJECTED',
        employeeId: 'emp-1',
        weekStart: d(WEEK),
        totalHours: dec(0),
        entries: [],
      });
      await save([entry()]);
      expect(prisma.timesheet.upsert.mock.calls[0][0].update).not.toHaveProperty('status');
    });

    it('saves an empty week as a draft with zero hours', async () => {
      await save([]);
      expect(prisma.timesheetEntry.createMany).not.toHaveBeenCalled();
      expect(prisma.timesheet.upsert.mock.calls[0][0].update.totalHours.toString()).toBe('0');
    });
  });

  describe('submit', () => {
    const tsRow = (over: Record<string, unknown> = {}) => ({
      id: 'ts-1',
      tenantId,
      employeeId: 'emp-1',
      weekStart: d(WEEK),
      status: 'DRAFT',
      totalHours: dec(8),
      entries: [
        {
          id: 'e1',
          date: d('2026-03-16'),
          projectId: 'p1',
          taskId: null,
          hours: dec(8),
        },
      ],
      ...over,
    });

    beforeEach(() => {
      prisma.timesheet.findFirst.mockResolvedValue(tsRow());
      prisma.timesheet.update.mockResolvedValue({ ...tsRow(), status: 'SUBMITTED', entries: [] });
    });

    it("404s for a timesheet that is not the caller's", async () => {
      prisma.timesheet.findFirst.mockResolvedValue(null);
      await expect(service.submit(owner, 'ts-1')).rejects.toThrow(NotFoundException);
      expect(prisma.timesheet.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ts-1', tenantId, employeeId: 'emp-1' },
        }),
      );
    });

    it('refuses a SUBMITTED timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(tsRow({ status: 'SUBMITTED' }));
      await expect(service.submit(owner, 'ts-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses a week that has not started', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(tsRow({ weekStart: d('2026-03-23') }));
      await expect(service.submit(owner, 'ts-1')).rejects.toThrow(/not started|future/i);
    });

    it('refuses a timesheet with no entries', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(tsRow({ entries: [] }));
      await expect(service.submit(owner, 'ts-1')).rejects.toThrow(/no entries/i);
    });

    it('re-validates: membership ended after saving names the offending date', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(
        tsRow({
          entries: [
            { id: 'e1', date: d('2026-03-16'), projectId: 'p1', taskId: null, hours: dec(4) },
            { id: 'e2', date: d('2026-03-18'), projectId: 'p1', taskId: null, hours: dec(4) },
          ],
        }),
      );
      stubProjectWorld({ members: [{ ...member, endDate: d('2026-03-17') }] });

      const err = await service.submit(owner, 'ts-1').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('2026-03-18');
      expect(err.message).not.toContain('2026-03-16');
      expect(prisma.timesheet.update).not.toHaveBeenCalled();
      expect(engine.start).not.toHaveBeenCalled();
    });

    it('submits, starts the workflow in the transaction, then notifies', async () => {
      await service.submit(owner, 'ts-1');

      expect(prisma.timesheet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ts-1', status: { in: ['DRAFT', 'REJECTED'] } },
          data: expect.objectContaining({
            status: 'SUBMITTED',
            submittedAt: expect.any(Date),
          }),
        }),
      );
      expect(engine.start).toHaveBeenCalledWith({
        tenantId,
        entityType: 'TIMESHEET',
        entityId: 'ts-1',
        context: { requesterEmployeeId: 'emp-1', requesterUserId: 'user-1', days: null },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'TIMESHEET', 'ts-1');
    });

    it('resubmits a REJECTED timesheet and clears the old decision', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(tsRow({ status: 'REJECTED' }));
      await service.submit(owner, 'ts-1');
      expect(prisma.timesheet.update.mock.calls[0][0].data).toMatchObject({
        status: 'SUBMITTED',
        decidedAt: null,
        approverId: null,
        approverNote: null,
      });
    });

    it('409s when a concurrent change already moved the timesheet', async () => {
      prisma.timesheet.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: 't' }),
      );
      await expect(service.submit(owner, 'ts-1')).rejects.toThrow(/already/i);
      expect(engine.notifyPending).not.toHaveBeenCalled();
    });
  });

  describe('recall', () => {
    it('moves SUBMITTED back to DRAFT and cancels the approval', async () => {
      prisma.timesheet.findFirst.mockResolvedValue({
        id: 'ts-1',
        employeeId: 'emp-1',
        status: 'SUBMITTED',
      });
      prisma.timesheet.update.mockResolvedValue({
        id: 'ts-1',
        status: 'DRAFT',
        weekStart: d(WEEK),
        totalHours: dec(8),
      });

      await service.recall(owner, 'ts-1');

      expect(prisma.timesheet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ts-1', status: 'SUBMITTED' },
          data: expect.objectContaining({ status: 'DRAFT', submittedAt: null }),
        }),
      );
      expect(engine.cancel).toHaveBeenCalledWith(tenantId, 'TIMESHEET', 'ts-1', prisma);
    });

    it.each(['DRAFT', 'APPROVED', 'REJECTED'])('refuses a %s timesheet', async (status) => {
      prisma.timesheet.findFirst.mockResolvedValue({ id: 'ts-1', employeeId: 'emp-1', status });
      await expect(service.recall(owner, 'ts-1')).rejects.toThrow(BadRequestException);
      expect(engine.cancel).not.toHaveBeenCalled();
    });

    it("404s for someone else's timesheet", async () => {
      prisma.timesheet.findFirst.mockResolvedValue(null);
      await expect(service.recall(owner, 'ts-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMyWeek', () => {
    it('returns an empty week when there is no row, with attended minutes', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { date: d('2026-03-16'), workedMinutes: 480 },
        { date: d('2026-03-17'), workedMinutes: null },
      ]);

      const result = await service.getMyWeek(owner, d(WEEK));

      expect(result).toEqual({
        timesheet: null,
        entries: [],
        attendedMinutesByDate: { '2026-03-16': 480, '2026-03-17': 0 },
      });
      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          date: { gte: d('2026-03-16'), lte: d('2026-03-22') },
        },
        select: { date: true, workedMinutes: true },
      });
    });

    it('serialises a saved week with entries', async () => {
      prisma.timesheet.findUnique.mockResolvedValue({
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStart: d(WEEK),
        status: 'DRAFT',
        totalHours: dec('7.5'),
        submittedAt: null,
        decidedAt: null,
        approverNote: null,
        entries: [
          {
            id: 'e1',
            date: d('2026-03-16'),
            projectId: 'p1',
            taskId: 't1',
            hours: dec('7.5'),
            billable: true,
            note: null,
            project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
            task: { id: 't1', name: 'Build' },
          },
        ],
      });

      const result = await service.getMyWeek(owner, d(WEEK));

      expect(result.timesheet).toMatchObject({
        id: 'ts-1',
        weekStart: '2026-03-16',
        status: 'DRAFT',
        totalHours: 7.5,
      });
      expect(result.entries).toEqual([
        expect.objectContaining({
          date: '2026-03-16',
          hours: 7.5,
          project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
          task: { id: 't1', name: 'Build' },
        }),
      ]);
    });

    it('rejects a non-Monday weekStart', async () => {
      await expect(service.getMyWeek(owner, d('2026-03-17'))).rejects.toThrow(/Monday/);
    });
  });
});
