import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: any;
  let notifications: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Templates
  // ============================================

  describe('getTemplates', () => {
    it('should return templates for tenant', async () => {
      const templates = [{ id: 'tpl-1', name: 'New Hire' }];
      prisma.onboardingTemplate.findMany.mockResolvedValue(templates);

      const result = await service.getTemplates('tenant-1');

      expect(prisma.onboardingTemplate.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { _count: { select: { processes: true } } },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(templates);
    });
  });

  describe('getTemplate', () => {
    it('should return a template by id', async () => {
      const template = { id: 'tpl-1', tenantId: 'tenant-1', name: 'New Hire' };
      prisma.onboardingTemplate.findFirst.mockResolvedValue(template);

      const result = await service.getTemplate('tenant-1', 'tpl-1');
      expect(result).toEqual(template);
    });

    it('should throw NotFoundException when template not found', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTemplate('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createTemplate', () => {
    it('should create a template', async () => {
      prisma.onboardingTemplate.findUnique.mockResolvedValue(null);
      const created = { id: 'tpl-1', name: 'New Hire', tenantId: 'tenant-1' };
      prisma.onboardingTemplate.create.mockResolvedValue(created);

      const result = await service.createTemplate('tenant-1', {
        name: 'New Hire',
        type: 'ONBOARDING' as any,
        tasks: [{ title: 'Setup laptop', category: 'IT', sortOrder: 1 }],
      });

      expect(prisma.onboardingTemplate.findUnique).toHaveBeenCalledWith({
        where: { tenantId_name: { tenantId: 'tenant-1', name: 'New Hire' } },
      });
      expect(prisma.onboardingTemplate.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: 'New Hire',
          type: 'ONBOARDING',
          description: undefined,
          tasks: [{ title: 'Setup laptop', category: 'IT', sortOrder: 1 }],
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw ConflictException when name exists', async () => {
      prisma.onboardingTemplate.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createTemplate('tenant-1', {
          name: 'New Hire',
          type: 'ONBOARDING' as any,
          tasks: [],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateTemplate', () => {
    it('should update a template', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue({
        id: 'tpl-1',
        tenantId: 'tenant-1',
        name: 'Old Name',
      });
      const updated = { id: 'tpl-1', name: 'New Name' };
      prisma.onboardingTemplate.update.mockResolvedValue(updated);

      const result = await service.updateTemplate('tenant-1', 'tpl-1', { name: 'New Name' });

      expect(prisma.onboardingTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: { name: 'New Name' },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when template not found', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTemplate('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when renaming to existing name', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue({
        id: 'tpl-1',
        tenantId: 'tenant-1',
        name: 'Old',
      });
      prisma.onboardingTemplate.findUnique.mockResolvedValue({ id: 'tpl-2', name: 'Exists' });

      await expect(
        service.updateTemplate('tenant-1', 'tpl-1', { name: 'Exists' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a template with no processes', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', tenantId: 'tenant-1' });
      prisma.onboardingProcess.count.mockResolvedValue(0);
      prisma.onboardingTemplate.delete.mockResolvedValue({});

      await service.deleteTemplate('tenant-1', 'tpl-1');

      expect(prisma.onboardingTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
    });

    it('should throw NotFoundException when template not found', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue(null);

      await expect(service.deleteTemplate('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when template has processes', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', tenantId: 'tenant-1' });
      prisma.onboardingProcess.count.mockResolvedValue(3);

      await expect(service.deleteTemplate('tenant-1', 'tpl-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // Processes
  // ============================================

  describe('getProcesses', () => {
    it('should return paginated processes', async () => {
      const processes = [{ id: 'proc-1' }];
      prisma.onboardingProcess.findMany.mockResolvedValue(processes);
      prisma.onboardingProcess.count.mockResolvedValue(1);
      prisma.onboardingTask.groupBy.mockResolvedValue([]);

      const result = await service.getProcesses('tenant-1', {});

      expect(prisma.onboardingProcess.findMany).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe('getProcess', () => {
    it('should return a process with tasks', async () => {
      const process = {
        id: 'proc-1',
        tenantId: 'tenant-1',
        tasks: [],
        employee: {},
        template: {},
      };
      prisma.onboardingProcess.findFirst.mockResolvedValue(process);

      const result = await service.getProcess('tenant-1', 'proc-1');
      expect(result).toEqual(process);
    });

    it('should throw NotFoundException when process not found', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue(null);

      await expect(service.getProcess('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createProcess', () => {
    it('should create process with tasks in a transaction', async () => {
      const template = {
        id: 'tpl-1',
        tenantId: 'tenant-1',
        isActive: true,
        type: 'ONBOARDING',
        tasks: [
          { title: 'Setup laptop', description: 'Setup', defaultAssigneeRole: 'EMPLOYEE', daysAfterStart: 1, sortOrder: 1, category: 'IT' },
        ],
      };
      prisma.onboardingTemplate.findFirst.mockResolvedValue(template);

      const employee = { id: 'emp-1', managerId: 'emp-mgr' };
      prisma.employee.findFirst.mockResolvedValue(employee);

      // The $transaction mock calls the callback with the prisma mock itself
      // Inside the callback, onboardingProcess.create and onboardingTask.createMany are called
      prisma.onboardingProcess.create.mockResolvedValue({ id: 'proc-1' });
      prisma.onboardingTask.createMany.mockResolvedValue({ count: 1 });

      // getProcess is called at the end
      const fullProcess = {
        id: 'proc-1',
        tenantId: 'tenant-1',
        employee: { id: 'emp-1' },
        template: { id: 'tpl-1' },
        tasks: [{ id: 'task-1', title: 'Setup laptop' }],
      };
      // getProcess calls findFirst on onboardingProcess
      prisma.onboardingProcess.findFirst.mockResolvedValue(fullProcess);

      const result = await service.createProcess('tenant-1', {
        templateId: 'tpl-1',
        employeeId: 'emp-1',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual(fullProcess);
    });

    it('should throw NotFoundException when template not found or inactive', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.createProcess('tenant-1', { templateId: 'missing', employeeId: 'emp-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when employee not found or inactive', async () => {
      prisma.onboardingTemplate.findFirst.mockResolvedValue({
        id: 'tpl-1',
        isActive: true,
        type: 'ONBOARDING',
        tasks: [],
      });
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createProcess('tenant-1', { templateId: 'tpl-1', employeeId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelProcess', () => {
    it('should cancel an in-progress process', async () => {
      prisma.onboardingProcess.findFirst
        .mockResolvedValueOnce({ id: 'proc-1', tenantId: 'tenant-1', status: 'IN_PROGRESS' })
        // Second call is from getProcess at the end
        .mockResolvedValueOnce({
          id: 'proc-1',
          status: 'CANCELLED',
          tasks: [],
          employee: {},
          template: {},
        });

      prisma.onboardingProcess.update.mockResolvedValue({});
      prisma.onboardingTask.updateMany.mockResolvedValue({});

      const result = await service.cancelProcess('tenant-1', 'proc-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.status).toBe('CANCELLED');
    });

    it('should throw NotFoundException when process not found', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue(null);

      await expect(service.cancelProcess('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when process already completed', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue({
        id: 'proc-1',
        status: 'COMPLETED',
      });

      await expect(service.cancelProcess('tenant-1', 'proc-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when process already cancelled', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue({
        id: 'proc-1',
        status: 'CANCELLED',
      });

      await expect(service.cancelProcess('tenant-1', 'proc-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deleteProcess', () => {
    it('should delete a NOT_STARTED process', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue({
        id: 'proc-1',
        tenantId: 'tenant-1',
        status: 'NOT_STARTED',
      });
      prisma.onboardingProcess.delete.mockResolvedValue({});

      await service.deleteProcess('tenant-1', 'proc-1');

      expect(prisma.onboardingProcess.delete).toHaveBeenCalledWith({
        where: { id: 'proc-1' },
      });
    });

    it('should throw NotFoundException when process not found', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue(null);

      await expect(service.deleteProcess('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when process is not NOT_STARTED', async () => {
      prisma.onboardingProcess.findFirst.mockResolvedValue({
        id: 'proc-1',
        status: 'IN_PROGRESS',
      });

      await expect(service.deleteProcess('tenant-1', 'proc-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // Tasks
  // ============================================

  describe('getMyTasks', () => {
    it('should return paginated tasks for employee', async () => {
      prisma.onboardingTask.findMany.mockResolvedValue([{ id: 'task-1' }]);
      prisma.onboardingTask.count.mockResolvedValue(1);

      const result = await service.getMyTasks('tenant-1', 'emp-1', {});

      expect(prisma.onboardingTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', assigneeId: 'emp-1' },
        }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe('updateTask', () => {
    const task = {
      id: 'task-1',
      tenantId: 'tenant-1',
      assigneeId: 'emp-1',
      processId: 'proc-1',
      title: 'Setup laptop',
      process: { status: 'IN_PROGRESS' },
    };

    it('should update a task assigned to the user', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue(task);
      const updated = { ...task, notes: 'Done' };
      prisma.onboardingTask.update.mockResolvedValue(updated);
      // checkProcessStatus calls
      prisma.onboardingProcess.findFirst.mockResolvedValue({ id: 'proc-1', status: 'IN_PROGRESS' });
      prisma.onboardingTask.count.mockResolvedValue(1); // 1 pending task remaining

      const result = await service.updateTask('tenant-1', 'task-1', 'emp-1', 'EMPLOYEE', {
        notes: 'Done',
      });

      expect(prisma.onboardingTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { notes: 'Done' },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when task not found', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTask('tenant-1', 'missing', 'emp-1', 'EMPLOYEE', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when non-admin tries to update others task', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue({
        ...task,
        assigneeId: 'other-emp',
      });

      await expect(
        service.updateTask('tenant-1', 'task-1', 'emp-1', 'EMPLOYEE', { notes: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow HR_ADMIN to update any task', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue({
        ...task,
        assigneeId: 'other-emp',
      });
      prisma.onboardingTask.update.mockResolvedValue(task);
      prisma.onboardingProcess.findFirst.mockResolvedValue({ id: 'proc-1', status: 'IN_PROGRESS' });
      prisma.onboardingTask.count.mockResolvedValue(1);

      await expect(
        service.updateTask('tenant-1', 'task-1', 'emp-hr', 'HR_ADMIN', { notes: 'Override' }),
      ).resolves.toBeDefined();
    });

    it('should throw BadRequestException when process is cancelled', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue({
        ...task,
        process: { status: 'CANCELLED' },
      });

      await expect(
        service.updateTask('tenant-1', 'task-1', 'emp-1', 'EMPLOYEE', { notes: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set completedAt when status is COMPLETED', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue(task);
      prisma.onboardingTask.update.mockResolvedValue({ ...task, status: 'COMPLETED' });
      prisma.onboardingProcess.findFirst.mockResolvedValue({ id: 'proc-1', status: 'IN_PROGRESS' });
      prisma.onboardingTask.count.mockResolvedValue(0); // no pending tasks
      prisma.onboardingProcess.update.mockResolvedValue({});

      await service.updateTask('tenant-1', 'task-1', 'emp-1', 'EMPLOYEE', {
        status: 'COMPLETED',
      });

      expect(prisma.onboardingTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      });
    });

    it('should notify new assignee when assigneeId changes', async () => {
      prisma.onboardingTask.findFirst.mockResolvedValue(task);
      prisma.onboardingTask.update.mockResolvedValue({ ...task, assigneeId: 'new-emp' });
      prisma.onboardingProcess.findFirst.mockResolvedValue({ id: 'proc-1', status: 'IN_PROGRESS' });
      prisma.onboardingTask.count.mockResolvedValue(1);

      await service.updateTask('tenant-1', 'task-1', 'emp-hr', 'HR_ADMIN', {
        assigneeId: 'new-emp',
      });

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'new-emp',
        expect.any(String),
        'Onboarding Task Assigned',
        expect.stringContaining('Setup laptop'),
        '/onboarding/my-tasks',
      );
    });
  });

  describe('completeTask', () => {
    it('should delegate to updateTask with COMPLETED status', async () => {
      const task = {
        id: 'task-1',
        tenantId: 'tenant-1',
        assigneeId: 'emp-1',
        processId: 'proc-1',
        title: 'Task',
        process: { status: 'IN_PROGRESS' },
      };
      prisma.onboardingTask.findFirst.mockResolvedValue(task);
      prisma.onboardingTask.update.mockResolvedValue({ ...task, status: 'COMPLETED' });
      prisma.onboardingProcess.findFirst.mockResolvedValue({ id: 'proc-1', status: 'IN_PROGRESS' });
      prisma.onboardingTask.count.mockResolvedValue(1);

      const result = await service.completeTask('tenant-1', 'task-1', 'emp-1', 'EMPLOYEE');

      expect(prisma.onboardingTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      });
      expect(result.status).toBe('COMPLETED');
    });
  });
});
