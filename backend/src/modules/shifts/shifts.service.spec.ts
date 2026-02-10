import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { CreateShiftDto, UpdateShiftDto, AssignShiftDto } from './dto/shift.dto';

describe('ShiftsService', () => {
  let service: ShiftsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<ShiftsService>(ShiftsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // createShift
  // ---------------------------------------------------------------------------
  describe('createShift', () => {
    const dto: CreateShiftDto = {
      name: 'Day Shift',
      code: 'DAY',
      startTime: '09:00',
      endTime: '17:00',
      breakMinutes: 60,
      standardWorkMinutes: 480,
      graceMinutes: 15,
    };

    it('should create a shift when code is unique', async () => {
      prisma.shift.findFirst.mockResolvedValue(null);
      const created = { id: 's1', tenantId: 'tenant-1', ...dto };
      prisma.shift.create.mockResolvedValue(created);

      const result = await service.createShift('tenant-1', dto);

      expect(prisma.shift.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', code: dto.code },
      });
      expect(prisma.shift.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: dto.name,
          code: dto.code,
          startTime: dto.startTime,
          endTime: dto.endTime,
          breakMinutes: 60,
          standardWorkMinutes: 480,
          graceMinutes: 15,
        },
      });
      expect(result).toEqual(created);
    });

    it('should use default values when optional fields are not provided', async () => {
      const minDto: CreateShiftDto = {
        name: 'Night',
        code: 'NIGHT',
        startTime: '22:00',
        endTime: '06:00',
      };
      prisma.shift.findFirst.mockResolvedValue(null);
      prisma.shift.create.mockResolvedValue({ id: 's2', ...minDto });

      await service.createShift('tenant-1', minDto);

      expect(prisma.shift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          breakMinutes: 60,
          standardWorkMinutes: 480,
          graceMinutes: 15,
        }),
      });
    });

    it('should throw ConflictException when shift code already exists', async () => {
      prisma.shift.findFirst.mockResolvedValue({ id: 'existing', code: dto.code });

      await expect(service.createShift('tenant-1', dto)).rejects.toThrow(ConflictException);
      await expect(service.createShift('tenant-1', dto)).rejects.toThrow(
        `Shift with code "${dto.code}" already exists`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findAllShifts
  // ---------------------------------------------------------------------------
  describe('findAllShifts', () => {
    it('should return all active shifts for a tenant', async () => {
      const shifts = [{ id: 's1', name: 'Day' }, { id: 's2', name: 'Night' }];
      prisma.shift.findMany.mockResolvedValue(shifts);

      const result = await service.findAllShifts('tenant-1');

      expect(prisma.shift.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isActive: true },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(shifts);
    });

    it('should return empty array when no active shifts exist', async () => {
      prisma.shift.findMany.mockResolvedValue([]);

      const result = await service.findAllShifts('tenant-1');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findShiftById
  // ---------------------------------------------------------------------------
  describe('findShiftById', () => {
    it('should return a shift by id and tenantId', async () => {
      const shift = { id: 's1', tenantId: 'tenant-1', name: 'Day Shift' };
      prisma.shift.findFirst.mockResolvedValue(shift);

      const result = await service.findShiftById('tenant-1', 's1');

      expect(prisma.shift.findFirst).toHaveBeenCalledWith({
        where: { id: 's1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(shift);
    });

    it('should throw NotFoundException when shift does not exist', async () => {
      prisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.findShiftById('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findShiftById('tenant-1', 'nonexistent')).rejects.toThrow(
        'Shift not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateShift
  // ---------------------------------------------------------------------------
  describe('updateShift', () => {
    const updateDto: UpdateShiftDto = { name: 'Updated Shift' };

    it('should update an existing shift', async () => {
      prisma.shift.findFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-1' });
      const updated = { id: 's1', name: 'Updated Shift' };
      prisma.shift.update.mockResolvedValue(updated);

      const result = await service.updateShift('tenant-1', 's1', updateDto);

      expect(prisma.shift.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: updateDto,
      });
      expect(result).toEqual(updated);
    });

    it('should check code uniqueness when code is being updated', async () => {
      const dtoWithCode: UpdateShiftDto = { code: 'NEW_CODE' };
      prisma.shift.findFirst
        .mockResolvedValueOnce({ id: 's1', tenantId: 'tenant-1' })  // findShiftById
        .mockResolvedValueOnce(null);                                  // uniqueness check
      prisma.shift.update.mockResolvedValue({ id: 's1', code: 'NEW_CODE' });

      await service.updateShift('tenant-1', 's1', dtoWithCode);

      // Second findFirst call is the uniqueness check
      expect(prisma.shift.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', code: 'NEW_CODE', NOT: { id: 's1' } },
      });
    });

    it('should throw ConflictException when new code already exists on another shift', async () => {
      const dtoWithCode: UpdateShiftDto = { code: 'EXISTING' };
      prisma.shift.findFirst
        .mockResolvedValueOnce({ id: 's1', tenantId: 'tenant-1' })    // findShiftById
        .mockResolvedValueOnce({ id: 's2', code: 'EXISTING' });       // uniqueness check

      await expect(
        service.updateShift('tenant-1', 's1', dtoWithCode),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if shift does not exist', async () => {
      prisma.shift.findFirst.mockResolvedValue(null);

      await expect(
        service.updateShift('tenant-1', 'nonexistent', updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteShift (soft delete)
  // ---------------------------------------------------------------------------
  describe('deleteShift', () => {
    it('should soft-delete a shift by setting isActive to false', async () => {
      prisma.shift.findFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-1' });
      prisma.shift.update.mockResolvedValue({ id: 's1', isActive: false });

      const result = await service.deleteShift('tenant-1', 's1');

      expect(prisma.shift.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { isActive: false },
      });
      expect(result).toEqual({ id: 's1', isActive: false });
    });

    it('should throw NotFoundException if shift does not exist', async () => {
      prisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.deleteShift('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // assignShift
  // ---------------------------------------------------------------------------
  describe('assignShift', () => {
    const dto: AssignShiftDto = {
      employeeId: 'emp-1',
      shiftId: 's1',
      startDate: '2025-02-01',
    };

    it('should assign a shift to an employee', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', tenantId: 'tenant-1' });
      prisma.shift.findFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-1', name: 'Day' });
      prisma.shiftAssignment.updateMany.mockResolvedValue({ count: 1 });
      const assignment = {
        id: 'sa-1',
        employeeId: 'emp-1',
        shiftId: 's1',
        employee: { firstName: 'John', lastName: 'Doe', employeeCode: 'E001' },
        shift: { name: 'Day', code: 'DAY' },
      };
      prisma.shiftAssignment.create.mockResolvedValue(assignment);

      const result = await service.assignShift('tenant-1', dto);

      // Should deactivate existing assignments
      expect(prisma.shiftAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          employeeId: dto.employeeId,
          isActive: true,
        },
        data: {
          isActive: false,
          endDate: new Date(dto.startDate),
        },
      });

      // Should create new assignment
      expect(prisma.shiftAssignment.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          employeeId: dto.employeeId,
          shiftId: dto.shiftId,
          startDate: new Date(dto.startDate),
          endDate: null,
        },
        include: {
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          shift: { select: { name: true, code: true } },
        },
      });
      expect(result).toEqual(assignment);
    });

    it('should handle optional endDate', async () => {
      const dtoWithEnd: AssignShiftDto = { ...dto, endDate: '2025-06-30' };
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.shift.findFirst.mockResolvedValue({ id: 's1', name: 'Day' });
      prisma.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
      prisma.shiftAssignment.create.mockResolvedValue({ id: 'sa-1' });

      await service.assignShift('tenant-1', dtoWithEnd);

      expect(prisma.shiftAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            endDate: new Date('2025-06-30'),
          }),
        }),
      );
    });

    it('should throw NotFoundException when employee does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.assignShift('tenant-1', dto)).rejects.toThrow(NotFoundException);
      await expect(service.assignShift('tenant-1', dto)).rejects.toThrow('Employee not found');
    });

    it('should throw NotFoundException when shift does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.shift.findFirst.mockResolvedValue(null); // findShiftById will throw

      await expect(service.assignShift('tenant-1', dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // bulkAssignShift
  // ---------------------------------------------------------------------------
  describe('bulkAssignShift', () => {
    it('should assign a shift to multiple employees and return results', async () => {
      // Mock for each iteration of the loop
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: 'emp-1' })
        .mockResolvedValueOnce({ id: 'emp-2' });
      prisma.shift.findFirst
        .mockResolvedValueOnce({ id: 's1', name: 'Day' })
        .mockResolvedValueOnce({ id: 's1', name: 'Day' });
      prisma.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
      prisma.shiftAssignment.create
        .mockResolvedValueOnce({ id: 'sa-1', employeeId: 'emp-1' })
        .mockResolvedValueOnce({ id: 'sa-2', employeeId: 'emp-2' });

      const result = await service.bulkAssignShift(
        'tenant-1',
        's1',
        ['emp-1', 'emp-2'],
        '2025-02-01',
      );

      expect(result).toHaveLength(2);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(true);
    });

    it('should capture errors for individual assignments without failing the batch', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: 'emp-1' })
        .mockResolvedValueOnce(null); // second employee not found
      prisma.shift.findFirst.mockResolvedValue({ id: 's1', name: 'Day' });
      prisma.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
      prisma.shiftAssignment.create.mockResolvedValueOnce({ id: 'sa-1' });

      const result = await service.bulkAssignShift(
        'tenant-1',
        's1',
        ['emp-1', 'emp-2'],
        '2025-02-01',
      );

      expect(result).toHaveLength(2);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
      expect(result[1]).toHaveProperty('error');
    });
  });

  // ---------------------------------------------------------------------------
  // getAssignments
  // ---------------------------------------------------------------------------
  describe('getAssignments', () => {
    it('should return active assignments by default', async () => {
      const assignments = [{ id: 'sa-1' }];
      prisma.shiftAssignment.findMany.mockResolvedValue(assignments);

      const result = await service.getAssignments('tenant-1');

      expect(prisma.shiftAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', isActive: true },
        }),
      );
      expect(result).toEqual(assignments);
    });

    it('should return all assignments when activeOnly is false', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);

      await service.getAssignments('tenant-1', false);

      expect(prisma.shiftAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getEmployeeShiftHistory
  // ---------------------------------------------------------------------------
  describe('getEmployeeShiftHistory', () => {
    it('should return all shift assignments for an employee', async () => {
      const history = [{ id: 'sa-1' }, { id: 'sa-2' }];
      prisma.shiftAssignment.findMany.mockResolvedValue(history);

      const result = await service.getEmployeeShiftHistory('tenant-1', 'emp-1');

      expect(prisma.shiftAssignment.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: {
          shift: { select: { name: true, code: true, startTime: true, endTime: true } },
        },
        orderBy: { startDate: 'desc' },
      });
      expect(result).toEqual(history);
    });

    it('should return empty array when employee has no shift history', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);

      const result = await service.getEmployeeShiftHistory('tenant-1', 'emp-1');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentShift
  // ---------------------------------------------------------------------------
  describe('getCurrentShift', () => {
    it('should return the current active shift for an employee', async () => {
      const shift = { id: 's1', name: 'Day Shift' };
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        shift,
      });

      const result = await service.getCurrentShift('tenant-1', 'emp-1');

      expect(prisma.shiftAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
          isActive: true,
        },
        include: { shift: true },
        orderBy: { startDate: 'desc' },
      });
      expect(result).toEqual(shift);
    });

    it('should return null when employee has no active shift assignment', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentShift('tenant-1', 'emp-1');

      expect(result).toBeNull();
    });
  });
});
