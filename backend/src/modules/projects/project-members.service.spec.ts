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
import { zonedDateOnlyUtc } from '../attendance/rules/late-mark';
import { ProjectMembersService } from './project-members.service';
import { ProjectsService } from './projects.service';

const TENANT = mockHrAdmin.tenantId;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('ProjectMembersService', () => {
  let service: ProjectMembersService;
  let prisma: any;
  let projects: { assertManageable: jest.Mock; assertVisible: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    projects = {
      assertManageable: jest.fn().mockResolvedValue({ id: 'p1', managerEmployeeId: 'emp-manager' }),
      assertVisible: jest.fn().mockResolvedValue({ id: 'p1', managerEmployeeId: 'emp-manager' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectMembersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projects },
      ],
    }).compile();
    service = module.get(ProjectMembersService);
  });

  describe('list', () => {
    it('requires visibility and maps employee name/code and dates', async () => {
      prisma.projectMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          employeeId: 'e1',
          role: 'Dev',
          startDate: day('2026-03-02'),
          endDate: null,
          employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E001' },
        },
      ]);
      const res = await service.list(mockEmployee, 'p1');
      expect(projects.assertVisible).toHaveBeenCalledWith(mockEmployee, 'p1');
      expect(prisma.projectMember.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        projectId: 'p1',
      });
      expect(res).toEqual([
        {
          id: 'm1',
          employeeId: 'e1',
          role: 'Dev',
          startDate: '2026-03-02',
          endDate: null,
          employee: { id: 'e1', name: 'Ann Lee', code: 'E001' },
        },
      ]);
    });
  });

  describe('add', () => {
    const memberRow = {
      id: 'm1',
      employeeId: 'e1',
      role: null,
      startDate: day('2026-03-02'),
      endDate: null,
      employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E001' },
    };
    beforeEach(() => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.projectMember.create.mockResolvedValue(memberRow);
    });

    it('403 for a non-manager non-admin (propagated from assertManageable)', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.add(mockEmployee, 'p1', { employeeId: 'e1' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.projectMember.create).not.toHaveBeenCalled();
    });

    it('400 when the employee is not ACTIVE in the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.add(mockHrAdmin, 'p1', { employeeId: 'e9' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e9', tenantId: TENANT, status: 'ACTIVE' } }),
      );
    });

    it('409 on a duplicate (P2002)', async () => {
      prisma.projectMember.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.add(mockHrAdmin, 'p1', { employeeId: 'e1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('400 when endDate < startDate', async () => {
      await expect(
        service.add(mockHrAdmin, 'p1', {
          employeeId: 'e1',
          startDate: '2026-03-10',
          endDate: '2026-03-09',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('startDate defaults to today', async () => {
      await service.add(mockHrAdmin, 'p1', { employeeId: 'e1', role: 'Dev' });
      const data = prisma.projectMember.create.mock.calls[0][0].data;
      expect(data.startDate).toEqual(zonedDateOnlyUtc(new Date()));
      expect(data).toMatchObject({ tenantId: TENANT, projectId: 'p1', employeeId: 'e1', role: 'Dev' });
    });

    it('uses the supplied dates', async () => {
      await service.add(mockManager, 'p1', {
        employeeId: 'e1',
        startDate: '2026-03-02',
        endDate: '2026-06-30',
      });
      const data = prisma.projectMember.create.mock.calls[0][0].data;
      expect(data.startDate).toEqual(day('2026-03-02'));
      expect(data.endDate).toEqual(day('2026-06-30'));
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.projectMember.findFirst.mockResolvedValue({
        id: 'm1',
        startDate: day('2026-03-02'),
        endDate: null,
      });
      prisma.projectMember.update.mockResolvedValue({
        id: 'm1',
        employeeId: 'e1',
        role: 'Lead',
        startDate: day('2026-03-02'),
        endDate: null,
        employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E001' },
      });
    });

    it('404 when the member belongs to another project', async () => {
      prisma.projectMember.findFirst.mockResolvedValue(null);
      await expect(service.update(mockHrAdmin, 'p1', 'mX', { role: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.projectMember.findFirst.mock.calls[0][0].where).toEqual({
        id: 'mX',
        projectId: 'p1',
        tenantId: TENANT,
      });
    });

    it('400 when the merged window is inverted', async () => {
      await expect(
        service.update(mockHrAdmin, 'p1', 'm1', { endDate: '2026-03-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates role and window', async () => {
      await service.update(mockHrAdmin, 'p1', 'm1', { role: 'Lead', endDate: '2026-04-01' });
      expect(prisma.projectMember.update.mock.calls[0][0].data).toEqual({
        role: 'Lead',
        endDate: day('2026-04-01'),
      });
    });

    it('403 for a plain member', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.update(mockEmployee, 'p1', 'm1', {})).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.projectMember.findFirst.mockResolvedValue({ id: 'm1', employeeId: 'e1' });
    });

    it('404 when the member belongs to another project', async () => {
      prisma.projectMember.findFirst.mockResolvedValue(null);
      await expect(service.remove(mockHrAdmin, 'p1', 'mX')).rejects.toThrow(NotFoundException);
    });

    it('ends the membership when hours were logged', async () => {
      prisma.timesheetEntry.count.mockResolvedValue(4);
      const res = await service.remove(mockHrAdmin, 'p1', 'm1');
      expect(res).toEqual({ ended: true });
      expect(prisma.timesheetEntry.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT, projectId: 'p1', timesheet: { employeeId: 'e1' } },
      });
      expect(prisma.projectMember.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { endDate: zonedDateOnlyUtc(new Date()) },
      });
      expect(prisma.projectMember.delete).not.toHaveBeenCalled();
    });

    it('deletes the membership when no hours were logged', async () => {
      prisma.timesheetEntry.count.mockResolvedValue(0);
      const res = await service.remove(mockManager, 'p1', 'm1');
      expect(res).toEqual({ ended: false });
      expect(prisma.projectMember.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
      expect(prisma.projectMember.update).not.toHaveBeenCalled();
    });

    it('403 for a non-manager non-admin', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.remove(mockEmployee, 'p1', 'm1')).rejects.toThrow(ForbiddenException);
    });
  });
});
