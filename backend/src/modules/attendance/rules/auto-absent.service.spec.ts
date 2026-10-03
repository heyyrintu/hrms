import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AutoAbsentService } from './auto-absent.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import { ShiftResolverService } from '../../roster/shift-resolver.service';

type DayShift = { startTime: string; endTime: string; isActive: boolean; isOvernight?: boolean };

describe('AutoAbsentService', () => {
  let service: AutoAbsentService;
  let prisma: any;
  let shiftResolver: { daysFor: jest.Mock };

  const tenantId = 'tenant-1';
  // A Monday. Fixtures are UTC noon so the calendar day is unambiguous.
  const workday = new Date('2026-03-16T12:00:00Z');
  const workdayUtcMidnight = new Date('2026-03-16T00:00:00Z');
  const saturday = new Date('2026-03-21T12:00:00Z');
  const sunday = new Date('2026-03-22T12:00:00Z');

  /** Everything empty: nobody is on leave, nothing is a holiday, no records. */
  function emptyDay() {
    prisma.holiday.findFirst.mockResolvedValue(null);
    prisma.employee.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    prisma.compOffRequest.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.createMany.mockResolvedValue({ count: 0 });
    setShifts({});
  }

  /**
   * What the shift resolver says for the swept day: a shift (assignment- or
   * roster-derived, the sweep cannot tell), 'OFF' for a rostered day off, or
   * nothing. Employees not listed have no shift.
   */
  function setShifts(
    byEmployee: Record<string, DayShift | 'OFF'>,
    source: 'ROSTER' | 'ASSIGNMENT' = 'ASSIGNMENT',
  ) {
    shiftResolver.daysFor.mockImplementation(
      async (_tenant: string, ids: string[], from: Date) =>
        ids.map((employeeId) => {
          const v = byEmployee[employeeId];
          return {
            employeeId,
            date: from,
            shift: v && v !== 'OFF' ? v : null,
            isOff: v === 'OFF',
            source: v ? source : 'NONE',
          };
        }),
    );
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAbsentService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: ShiftResolverService, useValue: { daysFor: jest.fn() } },
      ],
    }).compile();

    service = module.get(AutoAbsentService);
    prisma = module.get(PrismaService);
    shiftResolver = module.get(ShiftResolverService);
    emptyDay();
  });

  describe('markAbsentForDate', () => {
    it('marks every eligible employee ABSENT with autoMarked set', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 2 });

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 2,
        skipped: 0,
      });

      expect(prisma.attendanceRecord.createMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId,
            employeeId: 'emp-1',
            date: workdayUtcMidnight,
            status: 'ABSENT',
            source: 'API',
            autoMarked: true,
            standardWorkMinutes: 480,
          },
          {
            tenantId,
            employeeId: 'emp-2',
            date: workdayUtcMidnight,
            status: 'ABSENT',
            source: 'API',
            autoMarked: true,
            standardWorkMinutes: 480,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('only considers active employees who had joined by that day', async () => {
      await service.markAbsentForDate(tenantId, workday);

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          status: 'ACTIVE',
          joinDate: { lte: expect.any(Date) },
          OR: [{ exitDate: null }, { exitDate: { gt: workdayUtcMidnight } }],
        },
        select: { id: true },
      });
      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(where.joinDate.lte.toISOString()).toBe('2026-03-16T23:59:59.999Z');
    });

    it('leaves out anyone who had already exited', async () => {
      // The exit filter is pushed into the query, so the mock honours the
      // `where` it is handed rather than asserting on its shape. That way the
      // test fails if the clause stops excluding a past leaver.
      const roster = [
        { id: 'still-here', exitDate: null },
        { id: 'leaves-later', exitDate: new Date('2026-04-01T00:00:00Z') },
        { id: 'already-gone', exitDate: new Date('2026-03-10T00:00:00Z') },
      ];
      prisma.employee.findMany.mockImplementation(async ({ where }: any) =>
        roster
          .filter((e) =>
            where.OR.some(
              (clause: any) =>
                (clause.exitDate === null && e.exitDate === null) ||
                (clause.exitDate?.gt != null &&
                  e.exitDate != null &&
                  e.exitDate > clause.exitDate.gt),
            ),
          )
          .map((e) => ({ id: e.id })),
      );
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 2 });

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 2,
        skipped: 0,
      });

      const marked = prisma.attendanceRecord.createMany.mock.calls[0][0].data.map(
        (row: any) => row.employeeId,
      );
      expect(marked).toEqual(['still-here', 'leaves-later']);
    });

    it('does nothing on a Saturday', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);

      await expect(service.markAbsentForDate(tenantId, saturday)).resolves.toEqual({
        marked: 0,
        skipped: 0,
      });
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    });

    it('does nothing on a Sunday', async () => {
      await expect(service.markAbsentForDate(tenantId, sunday)).resolves.toEqual({
        marked: 0,
        skipped: 0,
      });
      expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    });

    it('does nothing on a tenant holiday', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'hol-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 0,
        skipped: 0,
      });
      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: { tenantId, date: workdayUtcMidnight, isActive: true },
        select: { id: true },
      });
      expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    });

    it('skips an employee who already has an attendance record', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.attendanceRecord.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 1 });

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 1,
        skipped: 1,
      });
      expect(prisma.attendanceRecord.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ employeeId: 'emp-2' }),
      ]);
    });

    it('skips an employee on approved leave that spans the day', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.leaveRequest.findMany.mockResolvedValue([{ employeeId: 'emp-2' }]);
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 1 });

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 1,
        skipped: 1,
      });
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          status: 'APPROVED',
          startDate: { lte: workdayUtcMidnight },
          endDate: { gte: workdayUtcMidnight },
        },
        select: { employeeId: true },
      });
      expect(prisma.attendanceRecord.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ employeeId: 'emp-1' }),
      ]);
    });

    it('skips an employee with an approved comp-off on the day', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      prisma.compOffRequest.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);

      await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
        marked: 0,
        skipped: 1,
      });
      expect(prisma.compOffRequest.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          workedDate: workdayUtcMidnight,
          status: { in: ['APPROVED', 'AVAILED'] },
        },
        select: { employeeId: true },
      });
      expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    });
  });

  describe('night shifts', () => {
    const tuesday = new Date('2026-03-17T12:00:00Z');

    function primeRoster() {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-day' },
        { id: 'emp-night' },
        { id: 'emp-none' },
      ]);
      setShifts({
        'emp-night': { startTime: '22:00', endTime: '06:00', isActive: true },
        'emp-day': { startTime: '09:00', endTime: '18:00', isActive: true },
      });
      prisma.attendanceRecord.createMany.mockImplementation(async ({ data }: any) => ({
        count: data.length,
      }));
    }

    const markedIds = (call = 0) =>
      prisma.attendanceRecord.createMany.mock.calls[call][0].data.map(
        (row: any) => row.employeeId,
      );

    it('leaves overnight-shift employees out of a day-shift sweep', async () => {
      primeRoster();

      await expect(
        service.markAbsentForDate(tenantId, workday, 'DAY_SHIFTS'),
      ).resolves.toEqual({ marked: 2, skipped: 0 });

      expect(markedIds()).toEqual(['emp-day', 'emp-none']);
      // The same resolver clock-in uses, asked once for the swept day.
      expect(shiftResolver.daysFor).toHaveBeenCalledTimes(1);
      expect(shiftResolver.daysFor).toHaveBeenCalledWith(
        tenantId,
        ['emp-day', 'emp-night', 'emp-none'],
        workdayUtcMidnight,
        workdayUtcMidnight,
      );
    });

    it('treats an employee the resolver gives no shift (e.g. a deactivated night shift) as a day worker', async () => {
      primeRoster();
      setShifts({ 'emp-day': { startTime: '09:00', endTime: '18:00', isActive: true } });

      await service.markAbsentForDate(tenantId, workday, 'DAY_SHIFTS');

      expect(markedIds()).toEqual(['emp-day', 'emp-night', 'emp-none']);
    });

    it('sweeps only overnight-shift employees in a night-shift sweep', async () => {
      primeRoster();

      await expect(
        service.markAbsentForDate(tenantId, workday, 'NIGHT_SHIFTS'),
      ).resolves.toEqual({ marked: 1, skipped: 0 });

      expect(markedIds()).toEqual(['emp-night']);
    });

    it('sweeps everyone, still honouring rostered OFF, when no scope is given', async () => {
      primeRoster();

      await service.markAbsentForDate(tenantId, workday);

      expect(markedIds()).toEqual(['emp-day', 'emp-night', 'emp-none']);
    });

    describe('roster (Keka wave G)', () => {
      it('does not mark an employee on a rostered OFF day absent', async () => {
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-off' }, { id: 'emp-day' }]);
        setShifts({ 'emp-off': 'OFF' }, 'ROSTER');
        prisma.attendanceRecord.createMany.mockImplementation(async ({ data }: any) => ({
          count: data.length,
        }));

        await expect(
          service.markAbsentForDate(tenantId, workday, 'DAY_SHIFTS'),
        ).resolves.toEqual({ marked: 1, skipped: 0 });
        expect(markedIds()).toEqual(['emp-day']);
      });

      it('also skips a rostered OFF day in a night-shift sweep and an all-scope sweep', async () => {
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-off' }]);
        setShifts({ 'emp-off': 'OFF' }, 'ROSTER');

        await expect(
          service.markAbsentForDate(tenantId, workday, 'NIGHT_SHIFTS'),
        ).resolves.toEqual({ marked: 0, skipped: 0 });
        await expect(service.markAbsentForDate(tenantId, workday)).resolves.toEqual({
          marked: 0,
          skipped: 0,
        });
        expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
      });

      it('scopes an employee on a rostered overnight shift as a night worker', async () => {
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-rn' }, { id: 'emp-day' }]);
        setShifts(
          {
            'emp-rn': { startTime: '22:00', endTime: '06:00', isActive: true, isOvernight: true },
            'emp-day': { startTime: '09:00', endTime: '18:00', isActive: true },
          },
          'ROSTER',
        );
        prisma.attendanceRecord.createMany.mockImplementation(async ({ data }: any) => ({
          count: data.length,
        }));

        await service.markAbsentForDate(tenantId, workday, 'DAY_SHIFTS');
        expect(markedIds(0)).toEqual(['emp-day']);

        await service.markAbsentForDate(tenantId, workday, 'NIGHT_SHIFTS');
        expect(markedIds(1)).toEqual(['emp-rn']);
      });

      it('treats a rostered shift flagged isOvernight as a night worker even without crossing times', async () => {
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-rn' }]);
        setShifts(
          { 'emp-rn': { startTime: '', endTime: '', isActive: true, isOvernight: true } },
          'ROSTER',
        );

        await expect(
          service.markAbsentForDate(tenantId, workday, 'DAY_SHIFTS'),
        ).resolves.toEqual({ marked: 0, skipped: 0 });
      });
    });

    it('nightly run closes today for day shifts and yesterday for night shifts', async () => {
      prisma.attendancePolicy.findMany.mockResolvedValue([{ tenantId }]);
      primeRoster();

      const result = await service.runForAllTenants(tuesday);

      const calls = prisma.attendanceRecord.createMany.mock.calls.map(([arg]: any) => ({
        date: arg.data[0].date.toISOString(),
        ids: arg.data.map((row: any) => row.employeeId),
      }));
      expect(calls).toEqual(
        expect.arrayContaining([
          { date: '2026-03-17T00:00:00.000Z', ids: ['emp-day', 'emp-none'] },
          { date: '2026-03-16T00:00:00.000Z', ids: ['emp-night'] },
        ]),
      );
      expect(calls).toHaveLength(2);
      expect(result).toEqual({ tenants: 1, marked: 3, skipped: 0, failed: 0 });
    });
  });

  describe('runForAllTenants', () => {
    it('only sweeps tenants that switched auto-absent on', async () => {
      prisma.attendancePolicy.findMany.mockResolvedValue([
        { tenantId: 'tenant-a' },
        { tenantId: 'tenant-b' },
      ]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 1 });

      const result = await service.runForAllTenants(workday);

      expect(prisma.attendancePolicy.findMany).toHaveBeenCalledWith({
        where: { autoMarkAbsent: true },
        select: { tenantId: true },
      });
      expect(result).toEqual({ tenants: 2, marked: 2, skipped: 0, failed: 0 });
    });

    it('keeps going when one tenant blows up', async () => {
      prisma.attendancePolicy.findMany.mockResolvedValue([
        { tenantId: 'tenant-a' },
        { tenantId: 'tenant-b' },
      ]);
      prisma.employee.findMany
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([{ id: 'emp-1' }]);
      prisma.attendanceRecord.createMany.mockResolvedValue({ count: 1 });

      const result = await service.runForAllTenants(workday);

      expect(result).toEqual({ tenants: 2, marked: 1, skipped: 0, failed: 1 });
    });
  });
  // POST /attendance/mark-absent: the same day/night scoping as the cron.
  describe('markAbsentOnDemand', () => {
    const noonIst16 = new Date('2026-03-16T06:30:00Z');

    function primeRoster() {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-day' }, { id: 'emp-night' }]);
      setShifts({
        'emp-night': { startTime: '22:00', endTime: '06:00', isActive: true },
      });
      prisma.attendanceRecord.createMany.mockImplementation(async ({ data }: any) => ({
        count: data.length,
      }));
    }

    const markedIds = () =>
      prisma.attendanceRecord.createMany.mock.calls[0][0].data.map((r: any) => r.employeeId);

    it("sweeps only day shifts for today, since tonight's shift has not ended", async () => {
      primeRoster();

      await expect(
        service.markAbsentOnDemand(tenantId, new Date('2026-03-16'), noonIst16),
      ).resolves.toEqual({ marked: 1, skipped: 0 });

      expect(markedIds()).toEqual(['emp-day']);
    });

    it('sweeps everyone for a past day', async () => {
      primeRoster();

      await service.markAbsentOnDemand(tenantId, new Date('2026-03-13'), noonIst16);

      expect(markedIds()).toEqual(['emp-day', 'emp-night']);
    });

    it('refuses a day that has not happened yet', async () => {
      primeRoster();

      await expect(
        service.markAbsentOnDemand(tenantId, new Date('2026-03-17'), noonIst16),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    });
  });
});
