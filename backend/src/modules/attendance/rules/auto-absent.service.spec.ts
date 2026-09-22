import { Test, TestingModule } from '@nestjs/testing';
import { AutoAbsentService } from './auto-absent.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('AutoAbsentService', () => {
  let service: AutoAbsentService;
  let prisma: any;

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
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAbsentService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(AutoAbsentService);
    prisma = module.get(PrismaService);
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
});
