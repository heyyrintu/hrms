import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockEmployeesService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  get360View: jest.fn(),
  getDirectReports: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('EmployeesController', () => {
  let controller: EmployeesController;
  let service: typeof mockEmployeesService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockEmployeesService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [
        { provide: EmployeesService, useValue: mockEmployeesService },
      ],
    }).compile();

    controller = module.get<EmployeesController>(EmployeesController);
    service = module.get(EmployeesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call employeesService.create with tenantId and dto', async () => {
      const dto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
      };
      const mockResult = { id: 'emp-new', ...dto };
      service.create.mockResolvedValue(mockResult);

      const result = await controller.create(adminUser, dto as any);

      expect(service.create).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findAll', () => {
    it('should call employeesService.findAll with tenantId and query', async () => {
      const query = { page: 1, limit: 10 };
      const mockResult = { data: [], total: 0 };
      service.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(adminUser, query as any);

      expect(service.findAll).toHaveBeenCalledWith('tenant-1', query);
      expect(result).toEqual(mockResult);
    });

    it('should pass filter parameters through to the service', async () => {
      const query = { page: 1, limit: 10, departmentId: 'dept-1' };
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.findAll(adminUser, query as any);

      expect(service.findAll).toHaveBeenCalledWith('tenant-1', query);
    });
  });

  describe('findOne', () => {
    it('should call employeesService.findOne with tenantId and id', async () => {
      const mockResult = { id: 'emp-1', firstName: 'John' };
      service.findOne.mockResolvedValue(mockResult);

      const result = await controller.findOne(adminUser, 'emp-1');

      expect(service.findOne).toHaveBeenCalledWith('tenant-1', 'emp-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('get360View', () => {
    it('should call employeesService.get360View with tenantId and id', async () => {
      const mockResult = { employee: {}, attendance: [], leaves: [] };
      service.get360View.mockResolvedValue(mockResult);

      const result = await controller.get360View(adminUser, 'emp-1');

      expect(service.get360View).toHaveBeenCalledWith('tenant-1', 'emp-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getDirectReports', () => {
    it('should call employeesService.getDirectReports with tenantId and id', async () => {
      const mockResult = [{ id: 'emp-2', firstName: 'Jane' }];
      service.getDirectReports.mockResolvedValue(mockResult);

      const result = await controller.getDirectReports(adminUser, 'emp-1');

      expect(service.getDirectReports).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should call employeesService.update with tenantId, id, and dto', async () => {
      const dto = { firstName: 'Updated' };
      const mockResult = { id: 'emp-1', firstName: 'Updated' };
      service.update.mockResolvedValue(mockResult);

      const result = await controller.update(adminUser, 'emp-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('tenant-1', 'emp-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('remove', () => {
    it('should call employeesService.remove with tenantId and id', async () => {
      const mockResult = { id: 'emp-1', deletedAt: new Date() };
      service.remove.mockResolvedValue(mockResult);

      const result = await controller.remove(adminUser, 'emp-1');

      expect(service.remove).toHaveBeenCalledWith('tenant-1', 'emp-1');
      expect(result).toEqual(mockResult);
    });
  });
});
