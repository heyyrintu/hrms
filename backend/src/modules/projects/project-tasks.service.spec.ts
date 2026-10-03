import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  mockEmployee,
  mockHrAdmin,
  mockManager,
} from '../../test/helpers';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectsService } from './projects.service';

const TENANT = mockHrAdmin.tenantId;

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Dev',
  description: null,
  billable: null,
  status: 'OPEN',
  estimateHours: { toString: () => '12.5' },
  ...over,
});

describe('ProjectTasksService', () => {
  let service: ProjectTasksService;
  let prisma: any;
  let projects: { assertManageable: jest.Mock; assertVisible: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    projects = {
      assertManageable: jest.fn().mockResolvedValue({ id: 'p1', billable: false }),
      assertVisible: jest.fn().mockResolvedValue({ id: 'p1', billable: false }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectTasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projects },
      ],
    }).compile();
    service = module.get(ProjectTasksService);
  });

  describe('list', () => {
    it('maps effectiveBillable (task flag, else project) and numeric estimate', async () => {
      prisma.projectTask.findMany.mockResolvedValue([
        taskRow(),
        taskRow({ id: 't2', billable: true, estimateHours: null }),
      ]);
      const res = await service.list(mockEmployee, 'p1');
      expect(projects.assertVisible).toHaveBeenCalledWith(mockEmployee, 'p1');
      expect(prisma.projectTask.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        projectId: 'p1',
      });
      expect(res[0]).toMatchObject({ id: 't1', effectiveBillable: false, estimateHours: 12.5 });
      expect(res[1]).toMatchObject({
        id: 't2',
        billable: true,
        effectiveBillable: true,
        estimateHours: null,
      });
    });
  });

  describe('create / update', () => {
    beforeEach(() => {
      prisma.projectTask.create.mockResolvedValue(taskRow());
      prisma.projectTask.findFirst.mockResolvedValue(taskRow());
      prisma.projectTask.update.mockResolvedValue(taskRow({ status: 'CLOSED' }));
    });

    it('a manager/admin can create', async () => {
      await service.create(mockManager, 'p1', { name: ' Dev ', billable: null, estimateHours: 8 });
      expect(projects.assertManageable).toHaveBeenCalledWith(mockManager, 'p1');
      expect(prisma.projectTask.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        projectId: 'p1',
        name: 'Dev',
        billable: null,
        estimateHours: 8,
      });
    });

    it('a plain member cannot create (403)', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.create(mockEmployee, 'p1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.projectTask.create).not.toHaveBeenCalled();
    });

    it('a plain member cannot update (403)', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.update(mockEmployee, 'p1', 't1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('update 404 when the task is on another project', async () => {
      prisma.projectTask.findFirst.mockResolvedValue(null);
      await expect(service.update(mockManager, 'p1', 'tX', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.projectTask.findFirst.mock.calls[0][0].where).toEqual({
        id: 'tX',
        projectId: 'p1',
        tenantId: TENANT,
      });
    });

    it.each(['OPEN', 'CLOSED'])('allows setting status %s', async (status) => {
      await service.update(mockManager, 'p1', 't1', { status: status as any });
      expect(prisma.projectTask.update.mock.calls[0][0].data).toEqual({ status });
    });

    it('can set billable back to null (inherit)', async () => {
      await service.update(mockManager, 'p1', 't1', { billable: null });
      expect(prisma.projectTask.update.mock.calls[0][0].data).toEqual({ billable: null });
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.projectTask.findFirst.mockResolvedValue(taskRow());
    });

    it('409 "close it instead" when entries exist', async () => {
      prisma.timesheetEntry.count.mockResolvedValue(2);
      await expect(service.remove(mockManager, 'p1', 't1')).rejects.toThrow(ConflictException);
      await expect(service.remove(mockManager, 'p1', 't1')).rejects.toThrow(/close it instead/i);
      expect(prisma.projectTask.delete).not.toHaveBeenCalled();
      expect(prisma.timesheetEntry.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT, taskId: 't1' },
      });
    });

    it('deletes a task without entries', async () => {
      prisma.timesheetEntry.count.mockResolvedValue(0);
      await service.remove(mockManager, 'p1', 't1');
      expect(prisma.projectTask.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('404 when the task is on another project', async () => {
      prisma.projectTask.findFirst.mockResolvedValue(null);
      await expect(service.remove(mockManager, 'p1', 'tX')).rejects.toThrow(NotFoundException);
    });

    it('403 for a plain member', async () => {
      projects.assertManageable.mockRejectedValue(new ForbiddenException());
      await expect(service.remove(mockEmployee, 'p1', 't1')).rejects.toThrow(ForbiddenException);
    });
  });
});
