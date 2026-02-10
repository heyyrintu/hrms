import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
  getProcesses: jest.fn(),
  getProcess: jest.fn(),
  createProcess: jest.fn(),
  cancelProcess: jest.fn(),
  deleteProcess: jest.fn(),
  getMyTasks: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
};

describe('OnboardingController', () => {
  let controller: OnboardingController;
  let service: typeof mockService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  const userNoEmployee: AuthenticatedUser = {
    userId: 'user-3',
    email: 'noemp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [{ provide: OnboardingService, useValue: mockService }],
    }).compile();
    controller = module.get<OnboardingController>(OnboardingController);
    service = module.get(OnboardingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // Templates (Admin)
  // ============================================
  describe('getTemplates', () => {
    it('should return all templates', async () => {
      const expected = [{ id: 'tpl-1', name: 'Default Onboarding' }];
      service.getTemplates.mockResolvedValue(expected);

      const result = await controller.getTemplates(adminUser);

      expect(result).toEqual(expected);
      expect(service.getTemplates).toHaveBeenCalledWith(adminUser.tenantId);
    });
  });

  describe('getTemplate', () => {
    it('should return a single template', async () => {
      const expected = { id: 'tpl-1', name: 'Default Onboarding', tasks: [] };
      service.getTemplate.mockResolvedValue(expected);

      const result = await controller.getTemplate(adminUser, 'tpl-1');

      expect(result).toEqual(expected);
      expect(service.getTemplate).toHaveBeenCalledWith(
        adminUser.tenantId,
        'tpl-1',
      );
    });
  });

  describe('createTemplate', () => {
    const dto = {
      name: 'New Template',
      type: 'ONBOARDING',
      tasks: [{ title: 'Setup laptop', category: 'IT', sortOrder: 0 }],
    };

    it('should create a template', async () => {
      const expected = { id: 'tpl-1', ...dto };
      service.createTemplate.mockResolvedValue(expected);

      const result = await controller.createTemplate(adminUser, dto);

      expect(result).toEqual(expected);
      expect(service.createTemplate).toHaveBeenCalledWith(
        adminUser.tenantId,
        dto,
      );
    });
  });

  describe('updateTemplate', () => {
    const dto = { name: 'Updated Template' };

    it('should update a template', async () => {
      const expected = { id: 'tpl-1', name: 'Updated Template' };
      service.updateTemplate.mockResolvedValue(expected);

      const result = await controller.updateTemplate(adminUser, 'tpl-1', dto);

      expect(result).toEqual(expected);
      expect(service.updateTemplate).toHaveBeenCalledWith(
        adminUser.tenantId,
        'tpl-1',
        dto,
      );
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a template and return message', async () => {
      service.deleteTemplate.mockResolvedValue(undefined);

      const result = await controller.deleteTemplate(adminUser, 'tpl-1');

      expect(result).toEqual({ message: 'Template deleted' });
      expect(service.deleteTemplate).toHaveBeenCalledWith(
        adminUser.tenantId,
        'tpl-1',
      );
    });
  });

  // ============================================
  // Processes (Admin)
  // ============================================
  describe('getProcesses', () => {
    it('should return processes with query params', async () => {
      const expected = { data: [{ id: 'proc-1' }], total: 1 };
      const query = { status: 'IN_PROGRESS', page: '1', limit: '20' };
      service.getProcesses.mockResolvedValue(expected);

      const result = await controller.getProcesses(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.getProcesses).toHaveBeenCalledWith(
        adminUser.tenantId,
        query,
      );
    });
  });

  describe('getProcess', () => {
    it('should return a single process', async () => {
      const expected = { id: 'proc-1', status: 'IN_PROGRESS' };
      service.getProcess.mockResolvedValue(expected);

      const result = await controller.getProcess(adminUser, 'proc-1');

      expect(result).toEqual(expected);
      expect(service.getProcess).toHaveBeenCalledWith(
        adminUser.tenantId,
        'proc-1',
      );
    });
  });

  describe('createProcess', () => {
    const dto = {
      employeeId: 'emp-new',
      templateId: 'tpl-1',
      startDate: '2025-04-01',
    };

    it('should create a process', async () => {
      const expected = { id: 'proc-1', ...dto };
      service.createProcess.mockResolvedValue(expected);

      const result = await controller.createProcess(adminUser, dto);

      expect(result).toEqual(expected);
      expect(service.createProcess).toHaveBeenCalledWith(
        adminUser.tenantId,
        dto,
      );
    });
  });

  describe('cancelProcess', () => {
    it('should cancel a process', async () => {
      const expected = { id: 'proc-1', status: 'CANCELLED' };
      service.cancelProcess.mockResolvedValue(expected);

      const result = await controller.cancelProcess(adminUser, 'proc-1');

      expect(result).toEqual(expected);
      expect(service.cancelProcess).toHaveBeenCalledWith(
        adminUser.tenantId,
        'proc-1',
      );
    });
  });

  describe('deleteProcess', () => {
    it('should delete a process and return message', async () => {
      service.deleteProcess.mockResolvedValue(undefined);

      const result = await controller.deleteProcess(adminUser, 'proc-1');

      expect(result).toEqual({ message: 'Process deleted' });
      expect(service.deleteProcess).toHaveBeenCalledWith(
        adminUser.tenantId,
        'proc-1',
      );
    });
  });

  // ============================================
  // Tasks
  // ============================================
  describe('getMyTasks', () => {
    it('should return tasks for the employee', async () => {
      const expected = { data: [{ id: 'task-1' }], total: 1 };
      const query = { status: 'PENDING' };
      service.getMyTasks.mockResolvedValue(expected);

      const result = await controller.getMyTasks(employeeUser, query);

      expect(result).toEqual(expected);
      expect(service.getMyTasks).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        query,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.getMyTasks(userNoEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTask', () => {
    const dto = { status: 'IN_PROGRESS', notes: 'Working on it' };

    it('should update a task', async () => {
      const expected = { id: 'task-1', status: 'IN_PROGRESS' };
      service.updateTask.mockResolvedValue(expected);

      const result = await controller.updateTask(employeeUser, 'task-1', dto);

      expect(result).toEqual(expected);
      expect(service.updateTask).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'task-1',
        employeeUser.employeeId,
        employeeUser.role,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.updateTask(userNoEmployee, 'task-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeTask', () => {
    it('should complete a task', async () => {
      const expected = { id: 'task-1', status: 'COMPLETED' };
      service.completeTask.mockResolvedValue(expected);

      const result = await controller.completeTask(employeeUser, 'task-1');

      expect(result).toEqual(expected);
      expect(service.completeTask).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'task-1',
        employeeUser.employeeId,
        employeeUser.role,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.completeTask(userNoEmployee, 'task-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
