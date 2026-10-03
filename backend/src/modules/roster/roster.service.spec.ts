import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  mockEmployee,
  mockHrAdmin,
  mockManager,
} from '../../test/helpers';
import { RosterService } from './roster.service';
import { ShiftResolverService } from './shift-resolver.service';

const TENANT = mockHrAdmin.tenantId;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const night = {
  id: 's-night',
  code: 'NGT',
  name: 'Night',
  isActive: true,
  isOvernight: true,
  startTime: '22:00',
  endTime: '06:00',
};
const general = {
  id: 's-gen',
  code: 'GEN',
  name: 'General',
  isActive: true,
  isOvernight: false,
  startTime: '09:00',
  endTime: '18:00',
};

describe('RosterService', () => {
  let service: RosterService;
  let prisma: any;
  let resolver: { daysFor: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RosterService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: ShiftResolverService, useValue: { daysFor: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = module.get(RosterService);
    prisma = module.get(PrismaService);
    resolver = module.get(ShiftResolverService);
  });

  describe('apply', () => {
    const base = {
      patternId: 'p1',
      employeeIds: ['e1'],
      startDate: '2026-03-16',
      endDate: '2026-03-19',
    };

    function prime(opts: { existing?: any[]; days?: (string | null)[] } = {}) {
      const days = opts.days ?? ['S1', null];
      prisma.shiftRotationPattern.findFirst.mockResolvedValue({
        id: 'p1',
        cycleLength: days.length,
        days: days.map((shiftId, dayIndex) => ({ dayIndex, shiftId })),
      });
      prisma.employee.findMany.mockResolvedValue(base.employeeIds.map((id) => ({ id })));
      prisma.rosterEntry.findMany.mockResolvedValue(opts.existing ?? []);
      prisma.rosterEntry.createMany.mockImplementation(async ({ data }: any) => ({
        count: data.length,
      }));
      prisma.rosterEntry.updateMany.mockResolvedValue({ count: 0 });
    }

    it('rejects a range over 366 days', async () => {
      await expect(
        service.apply(mockHrAdmin, { ...base, startDate: '2026-01-01', endDate: '2027-01-02' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts exactly 366 days', async () => {
      prime();
      await expect(
        service.apply(mockHrAdmin, { ...base, startDate: '2028-01-01', endDate: '2028-12-31' }),
      ).resolves.toMatchObject({ created: 366 });
    });

    it('rejects end before start', async () => {
      await expect(
        service.apply(mockHrAdmin, { ...base, startDate: '2026-03-19', endDate: '2026-03-16' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an employee that is not ACTIVE in the tenant, listing the ids', async () => {
      prime();
      prisma.employee.findMany.mockResolvedValue([{ id: 'e1' }]);
      const err = await service
        .apply(mockHrAdmin, { ...base, employeeIds: ['e1', 'e2', 'e3'] })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('e2');
      expect(err.message).toContain('e3');
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, status: 'ACTIVE', id: { in: ['e1', 'e2', 'e3'] } },
        select: { id: true },
      });
    });

    it('404s for an inactive (or foreign) pattern', async () => {
      prime();
      prisma.shiftRotationPattern.findFirst.mockResolvedValue(null);
      await expect(service.apply(mockHrAdmin, base)).rejects.toThrow(NotFoundException);
      expect(prisma.shiftRotationPattern.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT, isActive: true },
        include: { days: { orderBy: { dayIndex: 'asc' } } },
      });
    });

    it('creates PATTERN rows alternating shift and OFF, in one long transaction', async () => {
      prime();

      await expect(service.apply(mockHrAdmin, base)).resolves.toEqual({
        created: 4,
        updated: 0,
        skippedManual: 0,
      });

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
      const data = prisma.rosterEntry.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(4);
      expect(data.map((r: any) => [iso(r.date), r.shiftId, r.isOff])).toEqual([
        ['2026-03-16', 'S1', false],
        ['2026-03-17', null, true],
        ['2026-03-18', 'S1', false],
        ['2026-03-19', null, true],
      ]);
      expect(data.every((r: any) => r.source === 'PATTERN' && r.patternId === 'p1')).toBe(true);
      expect(data[0]).toMatchObject({
        tenantId: TENANT,
        employeeId: 'e1',
        createdById: mockHrAdmin.userId,
      });
      expect(prisma.rosterEntry.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          employeeId: { in: ['e1'] },
          date: { gte: day('2026-03-16'), lte: day('2026-03-19') },
        },
        select: { id: true, employeeId: true, date: true, source: true },
      });
    });

    it('applies the cycle offset', async () => {
      prime();
      await service.apply(mockHrAdmin, { ...base, cycleOffset: 1, endDate: '2026-03-17' });
      const data = prisma.rosterEntry.createMany.mock.calls[0][0].data;
      expect(data.map((r: any) => r.isOff)).toEqual([true, false]);
    });

    it('keeps an existing MANUAL entry unless overwriteManual', async () => {
      prime({
        existing: [{ id: 'r-manual', employeeId: 'e1', date: day('2026-03-17'), source: 'MANUAL' }],
      });

      await expect(service.apply(mockHrAdmin, base)).resolves.toEqual({
        created: 3,
        updated: 0,
        skippedManual: 1,
      });
      expect(prisma.rosterEntry.updateMany).not.toHaveBeenCalled();
      expect(prisma.rosterEntry.createMany.mock.calls[0][0].data).toHaveLength(3);
    });

    it('overwrites a MANUAL entry with overwriteManual', async () => {
      prime({
        existing: [{ id: 'r-manual', employeeId: 'e1', date: day('2026-03-17'), source: 'MANUAL' }],
      });

      await expect(
        service.apply(mockHrAdmin, { ...base, overwriteManual: true }),
      ).resolves.toEqual({ created: 3, updated: 1, skippedManual: 0 });
      expect(prisma.rosterEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-manual'] } },
        data: { shiftId: null, isOff: true, source: 'PATTERN', patternId: 'p1' },
      });
    });

    it('updates an existing PATTERN entry, grouped by target', async () => {
      prime({
        existing: [
          { id: 'r1', employeeId: 'e1', date: day('2026-03-16'), source: 'PATTERN' },
          { id: 'r2', employeeId: 'e1', date: day('2026-03-17'), source: 'PATTERN' },
          { id: 'r3', employeeId: 'e1', date: day('2026-03-18'), source: 'PATTERN' },
        ],
      });

      await expect(service.apply(mockHrAdmin, base)).resolves.toEqual({
        created: 1,
        updated: 3,
        skippedManual: 0,
      });
      const calls = prisma.rosterEntry.updateMany.mock.calls.map(([a]: any) => a);
      expect(calls).toHaveLength(2);
      expect(calls).toEqual(
        expect.arrayContaining([
          {
            where: { id: { in: ['r1', 'r3'] } },
            data: { shiftId: 'S1', isOff: false, source: 'PATTERN', patternId: 'p1' },
          },
          {
            where: { id: { in: ['r2'] } },
            data: { shiftId: null, isOff: true, source: 'PATTERN', patternId: 'p1' },
          },
        ]),
      );
    });

    it('chunks updates by 500 ids and creates by 1000 rows', async () => {
      prime({ days: ['S1'] });
      const ids = Array.from({ length: 3 }, (_, i) => `e${i}`);
      prisma.employee.findMany.mockResolvedValue(ids.map((id) => ({ id })));
      // 3 employees x 366 days = 1098 rows, all new -> 2 createMany calls.
      await service.apply(mockHrAdmin, {
        ...base,
        employeeIds: ids,
        startDate: '2028-01-01',
        endDate: '2028-12-31',
      });
      expect(prisma.rosterEntry.createMany).toHaveBeenCalledTimes(2);
      expect(prisma.rosterEntry.createMany.mock.calls[0][0].data).toHaveLength(1000);
      expect(prisma.rosterEntry.createMany.mock.calls[1][0].data).toHaveLength(98);

      // 2 employees x 366 existing PATTERN rows, all to update -> 500 + 232.
      prisma.rosterEntry.createMany.mockClear();
      prisma.employee.findMany.mockResolvedValue([{ id: 'e0' }, { id: 'e1' }]);
      prisma.rosterEntry.findMany.mockResolvedValue(
        ['e0', 'e1'].flatMap((employeeId) =>
          Array.from({ length: 366 }, (_, i) => ({
            id: `${employeeId}-r${i}`,
            employeeId,
            date: new Date(Date.UTC(2028, 0, 1 + i)),
            source: 'PATTERN',
          })),
        ),
      );
      await service.apply(mockHrAdmin, {
        ...base,
        employeeIds: ['e0', 'e1'],
        startDate: '2028-01-01',
        endDate: '2028-12-31',
      });
      const sizes = prisma.rosterEntry.updateMany.mock.calls.map(([a]: any) => a.where.id.in.length);
      expect(sizes).toEqual([500, 232]);
      expect(prisma.rosterEntry.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getGrid', () => {
    const q = { from: '2026-03-16', to: '2026-03-17' };
    const emp = (id: string, first: string) => ({
      id,
      firstName: first,
      lastName: 'X',
      employeeCode: `C-${id}`,
      department: { name: 'Ops' },
    });

    it('rejects a range over 42 days and a reversed range', async () => {
      await expect(
        service.getGrid(mockHrAdmin, { from: '2026-03-01', to: '2026-04-12' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getGrid(mockHrAdmin, { from: '2026-03-17', to: '2026-03-16' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts exactly 42 days', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await expect(
        service.getGrid(mockHrAdmin, { from: '2026-03-01', to: '2026-04-11' }),
      ).resolves.toMatchObject({ rows: [] });
    });

    it('HR sees every active employee, optionally by department', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await service.getGrid(mockHrAdmin, { ...q, departmentId: 'd1' });
      expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        status: 'ACTIVE',
        departmentId: 'd1',
      });
    });

    it('a manager without the permission is limited to direct reports', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await service.getGrid(mockManager, q);
      expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        status: 'ACTIVE',
        managerId: mockManager.employeeId,
      });
    });

    it('a manager with attendance.roster.manage sees everyone', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await service.getGrid({ ...mockManager, permissions: ['attendance.roster.manage'] }, q);
      expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        status: 'ACTIVE',
      });
    });

    it('a manager with no employee record is refused rather than matching every row', async () => {
      await expect(
        service.getGrid({ ...mockManager, employeeId: undefined }, q),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });

    it('narrows to the requested employeeIds', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await service.getGrid(mockHrAdmin, { ...q, employeeIds: 'e1, e2' });
      expect(prisma.employee.findMany.mock.calls[0][0].where.id).toEqual({ in: ['e1', 'e2'] });
    });

    it('maps resolver days into rows and cells', async () => {
      prisma.employee.findMany.mockResolvedValue([emp('e1', 'Asha'), emp('e2', 'Ben')]);
      resolver.daysFor.mockResolvedValue([
        { employeeId: 'e1', date: day('2026-03-16'), shift: night, isOff: false, source: 'ROSTER' },
        { employeeId: 'e1', date: day('2026-03-17'), shift: null, isOff: true, source: 'ROSTER' },
        { employeeId: 'e2', date: day('2026-03-16'), shift: general, isOff: false, source: 'ASSIGNMENT' },
        { employeeId: 'e2', date: day('2026-03-17'), shift: null, isOff: false, source: 'NONE' },
      ]);

      const grid = await service.getGrid(mockHrAdmin, q);

      expect(resolver.daysFor).toHaveBeenCalledWith(TENANT, ['e1', 'e2'], day('2026-03-16'), day('2026-03-17'));
      expect(grid.days).toEqual(['2026-03-16', '2026-03-17']);
      expect(grid.rows).toHaveLength(2);
      expect(grid.rows[0].employee).toEqual({
        id: 'e1',
        name: 'Asha X',
        code: 'C-e1',
        department: 'Ops',
      });
      expect(grid.rows[0].cells).toEqual([
        {
          date: '2026-03-16',
          shiftId: 's-night',
          shiftCode: 'NGT',
          shiftName: 'Night',
          isOvernight: true,
          isOff: false,
          source: 'ROSTER',
        },
        {
          date: '2026-03-17',
          shiftId: null,
          shiftCode: null,
          shiftName: null,
          isOvernight: false,
          isOff: true,
          source: 'ROSTER',
        },
      ]);
      expect(grid.rows[1].cells[0]).toMatchObject({ shiftCode: 'GEN', source: 'ASSIGNMENT' });
      expect(grid.rows[1].cells[1]).toMatchObject({ shiftId: null, source: 'NONE', isOff: false });
    });
  });

  describe('updateCells', () => {
    const cell = (over: any = {}) => ({ employeeId: 'e1', date: '2026-03-16', ...over });

    function prime() {
      // Like the database, only return rows the where clause names.
      const only = (rows: { id: string }[]) => async ({ where }: any) =>
        rows.filter((r) => where.id.in.includes(r.id));
      prisma.employee.findMany.mockImplementation(
        only([{ id: 'e1', firstName: 'Asha', lastName: 'X', employeeCode: 'C1', department: null } as any]),
      );
      prisma.shift.findMany.mockImplementation(only([{ id: 's-gen' }]));
      prisma.rosterEntry.upsert.mockResolvedValue({});
      prisma.rosterEntry.deleteMany.mockResolvedValue({ count: 1 });
      resolver.daysFor.mockResolvedValue([
        { employeeId: 'e1', date: day('2026-03-16'), shift: general, isOff: false, source: 'ROSTER' },
      ]);
    }

    it('rejects more than 1000 cells', async () => {
      await expect(
        service.updateCells(mockHrAdmin, new Array(1001).fill(cell({ isOff: true }))),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty list', async () => {
      await expect(service.updateCells(mockHrAdmin, [])).rejects.toThrow(BadRequestException);
    });

    it('rejects a cell with no action', async () => {
      await expect(service.updateCells(mockHrAdmin, [cell()])).rejects.toThrow(BadRequestException);
      await expect(service.updateCells(mockHrAdmin, [cell({ shiftId: null })])).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.updateCells(mockHrAdmin, [cell({ isOff: false })]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects both shiftId and isOff, and clear with anything else', async () => {
      await expect(
        service.updateCells(mockHrAdmin, [cell({ shiftId: 's-gen', isOff: true })]),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateCells(mockHrAdmin, [cell({ clear: true, isOff: true })]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a malformed date', async () => {
      prime();
      await expect(
        service.updateCells(mockHrAdmin, [cell({ date: '2026-13-45', isOff: true })]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown employee or shift', async () => {
      prime();
      await expect(
        service.updateCells(mockHrAdmin, [cell({ employeeId: 'ghost', isOff: true })]),
      ).rejects.toThrow(BadRequestException);

      prime();
      await expect(
        service.updateCells(mockHrAdmin, [cell({ shiftId: 'ghost-shift' })]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.rosterEntry.upsert).not.toHaveBeenCalled();
    });

    it('clear deletes the entry so the day falls back to the assignment', async () => {
      prime();
      await service.updateCells(mockHrAdmin, [cell({ clear: true })]);
      expect(prisma.rosterEntry.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, employeeId: 'e1', date: day('2026-03-16') },
      });
      expect(prisma.rosterEntry.upsert).not.toHaveBeenCalled();
    });

    it('upserts a MANUAL shift cell and a MANUAL OFF cell with no pattern', async () => {
      prime();
      await service.updateCells(mockHrAdmin, [
        cell({ shiftId: 's-gen' }),
        cell({ date: '2026-03-17', isOff: true }),
      ]);

      expect(prisma.$transaction).toHaveBeenCalled();
      const [a, b] = prisma.rosterEntry.upsert.mock.calls.map(([x]: any) => x);
      expect(a.where).toEqual({
        tenantId_employeeId_date: { tenantId: TENANT, employeeId: 'e1', date: day('2026-03-16') },
      });
      expect(a.create).toMatchObject({
        tenantId: TENANT,
        employeeId: 'e1',
        date: day('2026-03-16'),
        shiftId: 's-gen',
        isOff: false,
        source: 'MANUAL',
        patternId: null,
        createdById: mockHrAdmin.userId,
      });
      expect(a.update).toEqual({ shiftId: 's-gen', isOff: false, source: 'MANUAL', patternId: null });
      expect(b.create).toMatchObject({ shiftId: null, isOff: true, source: 'MANUAL' });
      expect(b.update).toEqual({ shiftId: null, isOff: true, source: 'MANUAL', patternId: null });
    });

    it('returns the updated cells grouped by employee', async () => {
      prime();
      const rows = await service.updateCells(mockHrAdmin, [cell({ shiftId: 's-gen' })]);
      expect(rows).toEqual([
        {
          employee: { id: 'e1', name: 'Asha X', code: 'C1', department: null },
          cells: [expect.objectContaining({ date: '2026-03-16', shiftCode: 'GEN', source: 'ROSTER' })],
        },
      ]);
    });
  });

  describe('getMine', () => {
    it('requires an employee record', async () => {
      await expect(
        service.getMine({ ...mockEmployee, employeeId: undefined }, { from: '2026-03-16', to: '2026-03-17' }),
      ).rejects.toThrow(BadRequestException);
      expect(resolver.daysFor).not.toHaveBeenCalled();
    });

    it('rejects a range over 42 days', async () => {
      await expect(
        service.getMine(mockEmployee, { from: '2026-03-01', to: '2026-04-12' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns only the caller own cells', async () => {
      resolver.daysFor.mockResolvedValue([
        { employeeId: mockEmployee.employeeId, date: day('2026-03-16'), shift: general, isOff: false, source: 'ASSIGNMENT' },
      ]);
      const cells = await service.getMine(mockEmployee, { from: '2026-03-16', to: '2026-03-16' });
      expect(resolver.daysFor).toHaveBeenCalledWith(
        TENANT,
        [mockEmployee.employeeId],
        day('2026-03-16'),
        day('2026-03-16'),
      );
      expect(cells).toEqual([
        {
          date: '2026-03-16',
          shiftId: 's-gen',
          shiftCode: 'GEN',
          shiftName: 'General',
          isOvernight: false,
          isOff: false,
          source: 'ASSIGNMENT',
        },
      ]);
    });
  });
});
