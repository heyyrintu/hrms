import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockDepartmentsService = {
  create: jest.fn(),
  findAll: jest.fn(),
  getHierarchy: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('DepartmentsController', () => {
  let controller: DepartmentsController;
  let service: typeof mockDepartmentsService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockDepartmentsService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [
        { provide: DepartmentsService, useValue: mockDepartmentsService },
      ],
    }).compile();

    controller = module.get<DepartmentsController>(DepartmentsController);
    service = module.get(DepartmentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call departmentsService.create with tenantId and dto', async () => {
      const dto = { name: 'Engineering', code: 'ENG' };
      const mockResult = { id: 'dept-1', ...dto };
      service.create.mockResolvedValue(mockResult);

      const result = await controller.create(adminUser, dto as any);

      expect(service.create).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findAll', () => {
    it('should call departmentsService.findAll with tenantId', async () => {
      const mockResult = [
        { id: 'dept-1', name: 'Engineering' },
        { id: 'dept-2', name: 'HR' },
      ];
      service.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(adminUser);

      expect(service.findAll).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getHierarchy', () => {
    it('should call departmentsService.getHierarchy with tenantId', async () => {
      const mockResult = [
        { id: 'dept-1', name: 'Engineering', children: [] },
      ];
      service.getHierarchy.mockResolvedValue(mockResult);

      const result = await controller.getHierarchy(adminUser);

      expect(service.getHierarchy).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('findOne', () => {
    it('should call departmentsService.findOne with tenantId and id', async () => {
      const mockResult = { id: 'dept-1', name: 'Engineering' };
      service.findOne.mockResolvedValue(mockResult);

      const result = await controller.findOne(adminUser, 'dept-1');

      expect(service.findOne).toHaveBeenCalledWith('tenant-1', 'dept-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should call departmentsService.update with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated Engineering' };
      const mockResult = { id: 'dept-1', name: 'Updated Engineering' };
      service.update.mockResolvedValue(mockResult);

      const result = await controller.update(adminUser, 'dept-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('tenant-1', 'dept-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('remove', () => {
    it('should call departmentsService.remove with tenantId and id', async () => {
      const mockResult = { id: 'dept-1', deletedAt: new Date() };
      service.remove.mockResolvedValue(mockResult);

      const result = await controller.remove(adminUser, 'dept-1');

      expect(service.remove).toHaveBeenCalledWith('tenant-1', 'dept-1');
      expect(result).toEqual(mockResult);
    });
  });
});
