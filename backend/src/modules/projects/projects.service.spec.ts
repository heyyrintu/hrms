import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  mockEmployee,
  mockHrAdmin,
  mockManager,
} from '../../test/helpers';
import { ProjectsService } from './projects.service';

const TENANT = mockHrAdmin.tenantId;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  tenantId: TENANT,
  code: 'ACME',
  name: 'Acme rollout',
  clientName: 'Acme',
  description: null,
  billable: true,
  status: 'ACTIVE',
  startDate: day('2026-03-02'),
  endDate: null,
  managerEmployeeId: 'emp-manager',
  manager: { id: 'emp-manager', firstName: 'Mia', lastName: 'Lead' },
  _count: { members: 3, tasks: 2 },
  ...over,
});

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProjectsService);
  });

  describe('create', () => {
    const dto = { code: 'acme-1', name: 'Acme' };

    beforeEach(() => {
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-manager' });
      prisma.project.create.mockImplementation(({ data }: any) =>
        Promise.resolve(
          row({ ...data, id: 'new', manager: null, _count: { members: 0, tasks: 0 } }),
        ),
      );
    });

    it('uppercases the code', async () => {
      await service.create(mockHrAdmin, dto);
      const data = prisma.project.create.mock.calls[0][0].data;
      expect(data.code).toBe('ACME-1');
      expect(data.tenantId).toBe(TENANT);
      expect(data.createdById).toBe(mockHrAdmin.userId);
    });

    it.each(['A', 'has space', 'bad_code', 'X'.repeat(21)])(
      'rejects code %p with 400',
      async (code) => {
        await expect(service.create(mockHrAdmin, { ...dto, code })).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it('409 when the code exists', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'x' });
      await expect(service.create(mockHrAdmin, dto)).rejects.toThrow(ConflictException);
    });

    it('409 on a P2002 race', async () => {
      prisma.project.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.create(mockHrAdmin, dto)).rejects.toThrow(ConflictException);
    });

    it('400 when endDate < startDate', async () => {
      await expect(
        service.create(mockHrAdmin, { ...dto, startDate: '2026-03-10', endDate: '2026-03-09' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 when the manager is not an ACTIVE employee of the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.create(mockHrAdmin, { ...dto, managerEmployeeId: 'ghost' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ghost', tenantId: TENANT, status: 'ACTIVE' },
        }),
      );
    });

    it('403 for a non-admin', async () => {
      await expect(service.create(mockManager, dto)).rejects.toThrow(ForbiddenException);
    });

    it('allows a custom-role holder of projects.manage', async () => {
      await expect(
        service.create({ ...mockEmployee, permissions: ['projects.manage'] }, dto),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.project.findFirst.mockResolvedValue(row());
      prisma.project.update.mockResolvedValue(row({ name: 'New' }));
    });

    it('403 for a non-admin', async () => {
      await expect(service.update(mockManager, 'p1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404 when the project is missing', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.update(mockHrAdmin, 'p1', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates the merged date range', async () => {
      // existing startDate is 2026-03-02
      await expect(service.update(mockHrAdmin, 'p1', { endDate: '2026-03-01' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('409 when the new code belongs to another project', async () => {
      prisma.project.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce({ id: 'other' });
      await expect(service.update(mockHrAdmin, 'p1', { code: 'taken' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('updates fields and returns the mapped project', async () => {
      const res = await service.update(mockHrAdmin, 'p1', {
        name: 'New',
        status: 'ON_HOLD' as any,
      });
      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        name: 'New',
        status: 'ON_HOLD',
      });
      expect(res.canManage).toBe(true);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.project.findMany.mockResolvedValue([row()]);
      prisma.project.count.mockResolvedValue(1);
    });

    it('admin sees the whole tenant', async () => {
      const res = await service.list(mockHrAdmin, {});
      expect(prisma.project.findMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT });
      expect(res.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(res.data[0]).toMatchObject({
        id: 'p1',
        manager: { id: 'emp-manager', name: 'Mia Lead' },
        startDate: '2026-03-02',
        endDate: null,
        memberCount: 3,
        taskCount: 2,
      });
    });

    it('non-admin is scoped to managed or member projects', async () => {
      await service.list(mockEmployee, {});
      expect(prisma.project.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        OR: [
          { managerEmployeeId: mockEmployee.employeeId },
          { members: { some: { employeeId: mockEmployee.employeeId } } },
        ],
      });
    });

    it('non-admin without an employeeId gets an empty page and no query', async () => {
      const res = await service.list({ ...mockEmployee, employeeId: undefined }, {});
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });

    it('search matches name, code and clientName case-insensitively', async () => {
      await service.list(mockHrAdmin, { search: 'acme', status: 'ACTIVE' as any });
      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
      expect(where.AND[0].OR).toEqual([
        { name: { contains: 'acme', mode: 'insensitive' } },
        { code: { contains: 'acme', mode: 'insensitive' } },
        { clientName: { contains: 'acme', mode: 'insensitive' } },
      ]);
    });

    it('clamps limit to 100 and paginates', async () => {
      prisma.project.count.mockResolvedValue(250);
      const res = await service.list(mockHrAdmin, { page: 2, limit: 500 });
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.skip).toBe(100);
      expect(res.meta.totalPages).toBe(3);
    });
  });

  describe('get / assertVisible', () => {
    it('404 for a project the actor cannot see', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.get(mockEmployee, 'p1')).rejects.toThrow(NotFoundException);
      expect(prisma.project.findFirst.mock.calls[0][0].where).toEqual({
        id: 'p1',
        tenantId: TENANT,
        OR: [
          { managerEmployeeId: mockEmployee.employeeId },
          { members: { some: { employeeId: mockEmployee.employeeId } } },
        ],
      });
    });

    it('404 for a non-admin with no employeeId, without querying', async () => {
      await expect(
        service.assertVisible({ ...mockEmployee, employeeId: undefined }, 'p1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('returns manager, counts and canManage', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      const res = await service.get(mockManager, 'p1');
      expect(res.manager).toEqual({ id: 'emp-manager', name: 'Mia Lead' });
      expect(res.memberCount).toBe(3);
      expect(res.taskCount).toBe(2);
      expect(res.canManage).toBe(true);
    });

    it('canManage is false for a plain member', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      const res = await service.get(mockEmployee, 'p1');
      expect(res.canManage).toBe(false);
    });

    it('admin is not scoped by membership', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      await service.get(mockHrAdmin, 'p1');
      expect(prisma.project.findFirst.mock.calls[0][0].where).toEqual({
        id: 'p1',
        tenantId: TENANT,
      });
    });
  });

  describe('assertManageable', () => {
    it('visible but not manageable -> 403', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      await expect(service.assertManageable(mockEmployee, 'p1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('project manager passes', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      await expect(service.assertManageable(mockManager, 'p1')).resolves.toMatchObject({
        id: 'p1',
      });
    });

    it('not visible -> 404', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.assertManageable(mockEmployee, 'p1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('loggable', () => {
    it('400 when weekStart is not a Monday', async () => {
      await expect(service.loggable(mockEmployee, '2026-03-17')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400 on an invalid date', async () => {
      await expect(service.loggable(mockEmployee, '2026-13-45')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400 when the caller has no employee record', async () => {
      await expect(
        service.loggable({ ...mockEmployee, employeeId: undefined }, '2026-03-16'),
      ).rejects.toThrow(BadRequestException);
    });

    it('queries ACTIVE projects with an overlapping membership window', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      await service.loggable(mockEmployee, '2026-03-16');
      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        tenantId: TENANT,
        status: 'ACTIVE',
        members: {
          some: {
            employeeId: mockEmployee.employeeId,
            startDate: { lte: day('2026-03-22') },
            OR: [{ endDate: null }, { endDate: { gte: day('2026-03-16') } }],
          },
        },
      });
    });

    it('maps OPEN tasks to effectiveBillable (task flag wins, else project)', async () => {
      prisma.project.findMany.mockResolvedValue([
        {
          id: 'p1',
          code: 'ACME',
          name: 'Acme',
          billable: true,
          members: [{ startDate: day('2026-03-01'), endDate: null }],
          tasks: [
            { id: 't1', name: 'Dev', billable: null },
            { id: 't2', name: 'Internal', billable: false },
          ],
        },
        {
          id: 'p2',
          code: 'INT',
          name: 'Internal',
          billable: false,
          members: [{ startDate: day('2026-03-01'), endDate: day('2026-03-20') }],
          tasks: [{ id: 't3', name: 'Billable bit', billable: true }],
        },
      ]);
      const res = await service.loggable(mockEmployee, '2026-03-16');
      expect(res[0].tasks).toEqual([
        { id: 't1', name: 'Dev', billable: null, effectiveBillable: true },
        { id: 't2', name: 'Internal', billable: false, effectiveBillable: false },
      ]);
      expect(res[0].member).toEqual({ startDate: '2026-03-01', endDate: null });
      expect(res[1].tasks[0].effectiveBillable).toBe(true);
      expect(res[1].member.endDate).toBe('2026-03-20');
      const include = prisma.project.findMany.mock.calls[0][0].include;
      expect(include.tasks.where).toEqual({ status: 'OPEN' });
    });
  });
});
