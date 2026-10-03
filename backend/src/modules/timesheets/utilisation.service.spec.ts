import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { UtilisationService } from './utilisation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShiftResolverService } from '../roster/shift-resolver.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { createMockPrismaService } from '../../test/helpers';
import type { UtilisationQueryDto } from './dto/utilisation.dto';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (n: number | string) => new Prisma.Decimal(n);
const tenantId = 'test-tenant';

const actor = (
  role: UserRole,
  employeeId?: string,
  permissions: string[] = [],
): AuthenticatedUser => ({
  userId: `user-${role}`,
  email: 'x@test.com',
  tenantId,
  role,
  employeeId,
  permissions,
});

const hr = actor(UserRole.HR_ADMIN, 'emp-hr');
const reportsViewer = actor(UserRole.EMPLOYEE, 'emp-v', ['projects.reports.view']);
const manager = actor(UserRole.MANAGER, 'emp-mgr');
const projectLead = actor(UserRole.EMPLOYEE, 'emp-lead');

const query = (over: Partial<UtilisationQueryDto> = {}): UtilisationQueryDto => ({
  from: '2026-03-16',
  to: '2026-03-22',
  groupBy: 'employee',
  ...over,
});

const employeeRow = (id: string, first: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: first,
  lastName: 'Rao',
  employeeCode: `C-${id}`,
  joinDate: d('2020-01-01'),
  exitDate: null,
  department: { name: 'Eng' },
  ...over,
});

const entry = (employeeId: string, projectId: string, hours: number, billable: boolean) => ({
  hours: dec(hours),
  billable,
  projectId,
  timesheet: { employeeId },
});

describe('UtilisationService', () => {
  let service: UtilisationService;
  let prisma: any;
  let resolver: { daysFor: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    resolver = { daysFor: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UtilisationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShiftResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get(UtilisationService);

    prisma.employee.findMany.mockResolvedValue([employeeRow('e1', 'Asha')]);
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.timesheetEntry.findMany.mockResolvedValue([]);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.project.count.mockResolvedValue(0);
  });

  describe('range validation', () => {
    it('refuses a range over 92 days', async () => {
      // 93 days inclusive
      await expect(
        service.build(hr, query({ from: '2026-01-01', to: '2026-04-03' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts exactly 92 days', async () => {
      await expect(
        service.build(hr, query({ from: '2026-01-01', to: '2026-04-02' })),
      ).resolves.toBeDefined();
    });

    it('refuses to before from', async () => {
      await expect(
        service.build(hr, query({ from: '2026-03-20', to: '2026-03-19' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses malformed dates', async () => {
      await expect(service.build(hr, query({ from: '16/03/2026' }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('scope', () => {
    it('HR sees all active employees, filtered by department', async () => {
      await service.build(hr, query({ departmentId: 'dep-1' }));
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'ACTIVE', departmentId: 'dep-1' },
        }),
      );
    });

    it('a projects.reports.view holder sees everyone', async () => {
      await service.build(reportsViewer, query());
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'ACTIVE' } }),
      );
    });

    it('a MANAGER sees direct reports for the employee grouping', async () => {
      await service.build(manager, query());
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'ACTIVE', managerId: 'emp-mgr' },
        }),
      );
    });

    it('a MANAGER project grouping is limited to projects they manage', async () => {
      prisma.timesheetEntry.findMany.mockResolvedValue([entry('e1', 'p1', 8, true)]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p1', code: 'ALPHA', name: 'Alpha' }]);

      await service.build(manager, query({ groupBy: 'project' }));

      expect(prisma.timesheetEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            project: { managerEmployeeId: 'emp-mgr' },
          }),
        }),
      );
    });

    it('a non-manager project manager cannot group by employee', async () => {
      prisma.project.count.mockResolvedValue(2);
      await expect(service.build(projectLead, query())).rejects.toThrow(ForbiddenException);
    });

    it('a project manager (any role) can group by project, on their projects only', async () => {
      prisma.project.count.mockResolvedValue(1);
      await service.build(projectLead, query({ groupBy: 'project' }));
      expect(prisma.timesheetEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ project: { managerEmployeeId: 'emp-lead' } }),
        }),
      );
    });

    it('a plain employee who manages no project is refused (both groupings)', async () => {
      prisma.project.count.mockResolvedValue(0);
      await expect(service.build(projectLead, query())).rejects.toThrow(ForbiddenException);
      await expect(service.build(projectLead, query({ groupBy: 'project' }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('a caller with no employee record and no admin scope is refused', async () => {
      const ghost = actor(UserRole.MANAGER);
      await expect(service.build(ghost, query())).rejects.toThrow(ForbiddenException);
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });

    it("404s a projectId outside a project manager's scope", async () => {
      prisma.project.count.mockResolvedValue(1);
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(
        service.build(projectLead, query({ groupBy: 'project', projectId: 'p-other' })),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-other', tenantId, managerEmployeeId: 'emp-lead' },
        }),
      );
    });

    it('404s a projectId that does not exist in the tenant', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.build(hr, query({ projectId: 'nope' }))).rejects.toThrow(
        NotFoundException,
      );
    });

    it("404s an employeeId outside a manager's direct reports", async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await expect(service.build(manager, query({ employeeId: 'e-other' }))).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'ACTIVE', managerId: 'emp-mgr', id: 'e-other' },
        }),
      );
    });

    it('404s an unknown employeeId in the project grouping', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.build(hr, query({ groupBy: 'project', employeeId: 'nope' })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('hours', () => {
    it('sums only APPROVED timesheets by default', async () => {
      await service.build(hr, query());
      const where = prisma.timesheetEntry.findMany.mock.calls[0][0].where;
      expect(where.timesheet.status).toEqual({ in: ['APPROVED'] });
      expect(where.date).toEqual({ gte: d('2026-03-16'), lte: d('2026-03-22') });
      expect(where.timesheet.employeeId).toEqual({ in: ['e1'] });
    });

    it('includeSubmitted adds SUBMITTED', async () => {
      await service.build(hr, query({ includeSubmitted: true }));
      const where = prisma.timesheetEntry.findMany.mock.calls[0][0].where;
      expect(where.timesheet.status).toEqual({ in: ['APPROVED', 'SUBMITTED'] });
    });

    it('filters by projectId', async () => {
      await service.build(hr, query({ projectId: 'p1' }));
      expect(prisma.timesheetEntry.findMany.mock.calls[0][0].where.projectId).toBe('p1');
    });
  });

  describe('employee rows', () => {
    it('computes capacity, utilisation and billable percentages', async () => {
      prisma.timesheetEntry.findMany.mockResolvedValue([
        entry('e1', 'p1', 10, true),
        entry('e1', 'p1', 10, true),
        entry('e1', 'p2', 10, false),
      ]);

      const report = await service.build(hr, query());

      expect(report.rows).toEqual([
        {
          employeeId: 'e1',
          name: 'Asha Rao',
          code: 'C-e1',
          department: 'Eng',
          capacityHours: 40,
          loggedHours: 30,
          billableHours: 20,
          utilisationPct: 75,
          billablePct: 50,
        },
      ]);
      expect(report.totals).toEqual({
        capacityHours: 40,
        loggedHours: 30,
        billableHours: 20,
        utilisationPct: 75,
        billablePct: 50,
      });
      expect(report.query).toMatchObject({
        from: '2026-03-16',
        to: '2026-03-22',
        groupBy: 'employee',
      });
      expect(typeof report.generatedAt).toBe('string');
    });

    it('expands approved leave (half days count 0.5) and removes holidays', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([
        // Starts before the range to test clipping; 16 and 17 Mar full days.
        {
          employeeId: 'e1',
          startDate: d('2026-03-10'),
          endDate: d('2026-03-17'),
          isHalfDay: false,
        },
        {
          employeeId: 'e1',
          startDate: d('2026-03-18'),
          endDate: d('2026-03-18'),
          isHalfDay: true,
        },
      ]);
      prisma.holiday.findMany.mockResolvedValue([{ date: d('2026-03-20') }]);

      const report = await service.build(hr, query());

      // Mon and Tue on leave, half Wed, Thu worked, Fri holiday = 1.5 days.
      expect((report.rows as any[])[0].capacityHours).toBe(12);
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            status: 'APPROVED',
            employeeId: { in: ['e1'] },
            startDate: { lte: d('2026-03-22') },
            endDate: { gte: d('2026-03-16') },
          },
        }),
      );
      expect(prisma.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            isActive: true,
            isOptional: false,
            date: { gte: d('2026-03-16'), lte: d('2026-03-22') },
          },
        }),
      );
    });

    it("uses the resolver's standard minutes and gives a rostered OFF day no capacity", async () => {
      resolver.daysFor.mockResolvedValue([
        {
          employeeId: 'e1',
          date: d('2026-03-16'),
          shift: { standardWorkMinutes: 540 },
          isOff: false,
        },
        { employeeId: 'e1', date: d('2026-03-17'), shift: null, isOff: true },
      ]);

      const report = await service.build(hr, query());

      // Mon 9h, Tue off, Wed to Fri 3 x 8h.
      expect((report.rows as any[])[0].capacityHours).toBe(33);
      expect(resolver.daysFor).toHaveBeenCalledWith(
        tenantId,
        ['e1'],
        d('2026-03-16'),
        d('2026-03-22'),
      );
    });

    it('leaves percentages null when capacity is 0', async () => {
      prisma.employee.findMany.mockResolvedValue([
        employeeRow('e1', 'Asha', { joinDate: d('2030-01-01') }),
      ]);
      const report = await service.build(hr, query());
      expect((report.rows as any[])[0]).toMatchObject({
        capacityHours: 0,
        utilisationPct: null,
        billablePct: null,
      });
    });

    it('totals sum the rows and recompute the percentages from the sums', async () => {
      prisma.employee.findMany.mockResolvedValue([
        employeeRow('e1', 'Asha'),
        employeeRow('e2', 'Bina', { department: null }),
      ]);
      prisma.timesheetEntry.findMany.mockResolvedValue([
        entry('e1', 'p1', 40, true),
        entry('e2', 'p1', 20, false),
      ]);

      const report: any = await service.build(hr, query());

      expect(report.rows.map((r: any) => r.department)).toEqual(['Eng', null]);
      expect(report.totals).toEqual({
        capacityHours: 80,
        loggedHours: 60,
        billableHours: 40,
        utilisationPct: 75,
        billablePct: 50,
      });
    });
  });

  describe('project rows', () => {
    it('computes billable share and distinct contributors', async () => {
      prisma.timesheetEntry.findMany.mockResolvedValue([
        entry('e1', 'p1', 8, true),
        entry('e1', 'p1', 2, false),
        entry('e2', 'p1', 10, true),
        entry('e2', 'p2', 5, true),
      ]);
      prisma.project.findMany.mockResolvedValue([
        { id: 'p1', code: 'ALPHA', name: 'Alpha' },
        { id: 'p2', code: 'BETA', name: 'Beta' },
      ]);

      const report: any = await service.build(hr, query({ groupBy: 'project' }));

      expect(report.rows).toEqual([
        {
          projectId: 'p1',
          code: 'ALPHA',
          name: 'Alpha',
          loggedHours: 20,
          billableHours: 18,
          billableSharePct: 90,
          contributors: 2,
        },
        {
          projectId: 'p2',
          code: 'BETA',
          name: 'Beta',
          loggedHours: 5,
          billableHours: 5,
          billableSharePct: 100,
          contributors: 1,
        },
      ]);
      expect(report.totals).toEqual({
        loggedHours: 25,
        billableHours: 23,
        billableSharePct: 92,
        contributors: 3,
      });
      expect(resolver.daysFor).not.toHaveBeenCalled();
    });

    it('applies the department and employee filters to the timesheet owner', async () => {
      await service.build(
        hr,
        query({ groupBy: 'project', departmentId: 'dep-1', employeeId: 'e1' }),
      );
      const where = prisma.timesheetEntry.findMany.mock.calls[0][0].where;
      expect(where.timesheet.employeeId).toBe('e1');
      expect(where.timesheet.employee).toEqual({ departmentId: 'dep-1' });
    });

    it('returns no rows (not an error) when nothing was logged', async () => {
      const report: any = await service.build(hr, query({ groupBy: 'project' }));
      expect(report.rows).toEqual([]);
      expect(report.totals).toEqual({
        loggedHours: 0,
        billableHours: 0,
        billableSharePct: null,
        contributors: 0,
      });
    });
  });

  describe('exportCsv', () => {
    it('writes the employee header and rows', async () => {
      prisma.timesheetEntry.findMany.mockResolvedValue([entry('e1', 'p1', 30, true)]);
      const csv = await service.exportCsv(hr, query());
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        'Employee Code,Employee,Department,Capacity (h),Logged (h),Billable (h),Utilisation %,Billable %',
      );
      expect(lines[1]).toBe('C-e1,Asha Rao,Eng,40,30,30,75,75');
    });

    it('writes the project header and rows', async () => {
      prisma.timesheetEntry.findMany.mockResolvedValue([entry('e1', 'p1', 8, true)]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p1', code: 'ALPHA', name: 'Alpha' }]);
      const csv = await service.exportCsv(hr, query({ groupBy: 'project' }));
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        'Project Code,Project,Logged (h),Billable (h),Billable share %,Contributors',
      );
      expect(lines[1]).toBe('ALPHA,Alpha,8,8,100,1');
    });

    it('escapes commas, quotes and newlines, and empties null percentages', async () => {
      prisma.employee.findMany.mockResolvedValue([
        employeeRow('e1', 'Asha', {
          lastName: 'O"Neil, Jr',
          department: { name: 'R&D\nLab' },
          joinDate: d('2030-01-01'),
        }),
      ]);
      const csv = await service.exportCsv(hr, query());
      const [, row] = csv.split('\r\n');
      expect(row).toBe('C-e1,"Asha O""Neil, Jr","R&D\nLab",0,0,0,,');
    });

    it('neutralises spreadsheet formulas in text cells', async () => {
      prisma.employee.findMany.mockResolvedValue([
        employeeRow('e1', '=SUM(1)', { lastName: 'Z' }),
      ]);
      const csv = await service.exportCsv(hr, query());
      const [, row] = csv.split('\r\n');
      expect(row.startsWith("C-e1,'=SUM(1) Z,")).toBe(true);
    });

    it('applies the same scope and validation as the report', async () => {
      await expect(service.exportCsv(projectLead, query())).rejects.toThrow(ForbiddenException);
    });
  });
});
