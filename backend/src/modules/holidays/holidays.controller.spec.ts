import { Test, TestingModule } from '@nestjs/testing';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockHolidaysService = {
  findAll: jest.fn(),
  findUpcoming: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  bulkCreate: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('HolidaysController', () => {
  let controller: HolidaysController;
  let service: typeof mockHolidaysService;

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

  beforeEach(async () => {
    Object.values(mockHolidaysService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HolidaysController],
      providers: [
        { provide: HolidaysService, useValue: mockHolidaysService },
      ],
    }).compile();

    controller = module.get<HolidaysController>(HolidaysController);
    service = module.get(HolidaysService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should call holidaysService.findAll with tenantId and query', async () => {
      const query = { year: 2025 };
      const mockResult = [{ id: 'h-1', name: 'New Year' }];
      service.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(employeeUser, query as any);

      expect(service.findAll).toHaveBeenCalledWith('tenant-1', query);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findUpcoming', () => {
    it('should call holidaysService.findUpcoming with tenantId and default limit of 5', async () => {
      const mockResult = [{ id: 'h-1', name: 'Republic Day' }];
      service.findUpcoming.mockResolvedValue(mockResult);

      const result = await controller.findUpcoming(employeeUser);

      expect(service.findUpcoming).toHaveBeenCalledWith('tenant-1', 5);
      expect(result).toEqual(mockResult);
    });

    it('should call holidaysService.findUpcoming with provided limit', async () => {
      const mockResult = [
        { id: 'h-1', name: 'Republic Day' },
        { id: 'h-2', name: 'Holi' },
        { id: 'h-3', name: 'Independence Day' },
      ];
      service.findUpcoming.mockResolvedValue(mockResult);

      const result = await controller.findUpcoming(employeeUser, 3);

      expect(service.findUpcoming).toHaveBeenCalledWith('tenant-1', 3);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findById', () => {
    it('should call holidaysService.findById with tenantId and id', async () => {
      const mockResult = {
        id: 'h-1',
        name: 'New Year',
        date: '2025-01-01',
      };
      service.findById.mockResolvedValue(mockResult);

      const result = await controller.findById(employeeUser, 'h-1');

      expect(service.findById).toHaveBeenCalledWith('tenant-1', 'h-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('create', () => {
    it('should call holidaysService.create with tenantId and dto', async () => {
      const dto = { name: 'Diwali', date: '2025-10-20', type: 'NATIONAL' };
      const mockResult = { id: 'h-new', ...dto };
      service.create.mockResolvedValue(mockResult);

      const result = await controller.create(adminUser, dto as any);

      expect(service.create).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('bulkCreate', () => {
    it('should call holidaysService.bulkCreate with tenantId and dto.holidays', async () => {
      const holidays = [
        { name: 'Diwali', date: '2025-10-20' },
        { name: 'Christmas', date: '2025-12-25' },
      ];
      const dto = { holidays };
      const mockResult = { created: 2 };
      service.bulkCreate.mockResolvedValue(mockResult);

      const result = await controller.bulkCreate(adminUser, dto as any);

      expect(service.bulkCreate).toHaveBeenCalledWith('tenant-1', holidays);
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should call holidaysService.update with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated Holiday' };
      const mockResult = { id: 'h-1', name: 'Updated Holiday' };
      service.update.mockResolvedValue(mockResult);

      const result = await controller.update(adminUser, 'h-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('tenant-1', 'h-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('delete', () => {
    it('should call holidaysService.delete with tenantId and id', async () => {
      const mockResult = { id: 'h-1', deletedAt: new Date() };
      service.delete.mockResolvedValue(mockResult);

      const result = await controller.delete(adminUser, 'h-1');

      expect(service.delete).toHaveBeenCalledWith('tenant-1', 'h-1');
      expect(result).toEqual(mockResult);
    });
  });
});
