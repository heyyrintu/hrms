import { Test, TestingModule } from '@nestjs/testing';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockShiftsService = {
  getAssignments: jest.fn(),
  getEmployeeShiftHistory: jest.fn(),
  assignShift: jest.fn(),
  bulkAssignShift: jest.fn(),
  findAllShifts: jest.fn(),
  findShiftById: jest.fn(),
  createShift: jest.fn(),
  updateShift: jest.fn(),
  deleteShift: jest.fn(),
};

describe('ShiftsController', () => {
  let controller: ShiftsController;
  let service: typeof mockShiftsService;

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
    Object.values(mockShiftsService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShiftsController],
      providers: [{ provide: ShiftsService, useValue: mockShiftsService }],
    }).compile();

    controller = module.get<ShiftsController>(ShiftsController);
    service = module.get(ShiftsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================
  // Shift Assignments
  // ==========================================
  describe('getAssignments', () => {
    it('should call shiftsService.getAssignments with tenantId and activeOnly=true by default', async () => {
      const mockResult = [{ id: 'sa-1', shiftId: 'shift-1' }];
      service.getAssignments.mockResolvedValue(mockResult);

      const result = await controller.getAssignments(adminUser);

      expect(service.getAssignments).toHaveBeenCalledWith('tenant-1', true);
      expect(result).toEqual(mockResult);
    });

    it('should pass activeOnly=true when explicitly set to true', async () => {
      service.getAssignments.mockResolvedValue([]);

      await controller.getAssignments(adminUser, true);

      expect(service.getAssignments).toHaveBeenCalledWith('tenant-1', true);
    });

    it('should pass activeOnly=false when set to false', async () => {
      service.getAssignments.mockResolvedValue([]);

      await controller.getAssignments(adminUser, false);

      expect(service.getAssignments).toHaveBeenCalledWith('tenant-1', false);
    });
  });

  describe('getEmployeeShiftHistory', () => {
    it('should call shiftsService.getEmployeeShiftHistory with tenantId and employeeId', async () => {
      const mockResult = [{ id: 'sa-1', shiftName: 'Morning' }];
      service.getEmployeeShiftHistory.mockResolvedValue(mockResult);

      const result = await controller.getEmployeeShiftHistory(
        employeeUser,
        'emp-2',
      );

      expect(service.getEmployeeShiftHistory).toHaveBeenCalledWith(
        'tenant-1',
        'emp-2',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('assignShift', () => {
    it('should call shiftsService.assignShift with tenantId and dto', async () => {
      const dto = {
        employeeId: 'emp-2',
        shiftId: 'shift-1',
        startDate: '2025-02-01',
      };
      const mockResult = { id: 'sa-new', ...dto };
      service.assignShift.mockResolvedValue(mockResult);

      const result = await controller.assignShift(adminUser, dto as any);

      expect(service.assignShift).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('bulkAssignShift', () => {
    it('should call shiftsService.bulkAssignShift with tenantId and extracted dto fields', async () => {
      const dto = {
        shiftId: 'shift-1',
        employeeIds: ['emp-2', 'emp-3'],
        startDate: '2025-02-01',
        endDate: '2025-02-28',
      };
      const mockResult = { assigned: 2 };
      service.bulkAssignShift.mockResolvedValue(mockResult);

      const result = await controller.bulkAssignShift(adminUser, dto as any);

      expect(service.bulkAssignShift).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
        ['emp-2', 'emp-3'],
        '2025-02-01',
        '2025-02-28',
      );
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================
  // Shift CRUD
  // ==========================================
  describe('findAll', () => {
    it('should call shiftsService.findAllShifts with tenantId', async () => {
      const mockResult = [{ id: 'shift-1', name: 'Morning' }];
      service.findAllShifts.mockResolvedValue(mockResult);

      const result = await controller.findAll(employeeUser);

      expect(service.findAllShifts).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('findById', () => {
    it('should call shiftsService.findShiftById with tenantId and id', async () => {
      const mockResult = {
        id: 'shift-1',
        name: 'Morning',
        startTime: '09:00',
      };
      service.findShiftById.mockResolvedValue(mockResult);

      const result = await controller.findById(employeeUser, 'shift-1');

      expect(service.findShiftById).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('create', () => {
    it('should call shiftsService.createShift with tenantId and dto', async () => {
      const dto = { name: 'Night Shift', startTime: '22:00', endTime: '06:00' };
      const mockResult = { id: 'shift-new', ...dto };
      service.createShift.mockResolvedValue(mockResult);

      const result = await controller.create(adminUser, dto as any);

      expect(service.createShift).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should call shiftsService.updateShift with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated Morning' };
      const mockResult = { id: 'shift-1', name: 'Updated Morning' };
      service.updateShift.mockResolvedValue(mockResult);

      const result = await controller.update(adminUser, 'shift-1', dto as any);

      expect(service.updateShift).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('delete', () => {
    it('should call shiftsService.deleteShift with tenantId and id', async () => {
      const mockResult = { id: 'shift-1', deletedAt: new Date() };
      service.deleteShift.mockResolvedValue(mockResult);

      const result = await controller.delete(adminUser, 'shift-1');

      expect(service.deleteShift).toHaveBeenCalledWith('tenant-1', 'shift-1');
      expect(result).toEqual(mockResult);
    });
  });
});
