import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { CreateOtRuleDto, UpdateOtRuleDto } from './dto/admin.dto';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // getOtRules
  // ---------------------------------------------------------------------------
  describe('getOtRules', () => {
    it('should return all OT rules for a tenant', async () => {
      const rules = [{ id: 'r1', name: 'Standard' }, { id: 'r2', name: 'Night' }];
      prisma.otRule.findMany.mockResolvedValue(rules);

      const result = await service.getOtRules('tenant-1');

      expect(prisma.otRule.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(rules);
    });

    it('should return empty array when no rules exist', async () => {
      prisma.otRule.findMany.mockResolvedValue([]);

      const result = await service.getOtRules('tenant-1');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getOtRule
  // ---------------------------------------------------------------------------
  describe('getOtRule', () => {
    it('should return a single OT rule by id and tenantId', async () => {
      const rule = { id: 'r1', tenantId: 'tenant-1', name: 'Standard' };
      prisma.otRule.findFirst.mockResolvedValue(rule);

      const result = await service.getOtRule('tenant-1', 'r1');

      expect(prisma.otRule.findFirst).toHaveBeenCalledWith({
        where: { id: 'r1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(rule);
    });

    it('should throw NotFoundException when OT rule does not exist', async () => {
      prisma.otRule.findFirst.mockResolvedValue(null);

      await expect(service.getOtRule('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getOtRule('tenant-1', 'nonexistent')).rejects.toThrow(
        'OT rule not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // createOtRule
  // ---------------------------------------------------------------------------
  describe('createOtRule', () => {
    const dto: CreateOtRuleDto = {
      name: 'Standard OT',
      employmentType: 'PERMANENT' as any,
      dailyThresholdMinutes: 480,
      roundingIntervalMinutes: 15,
      requiresManagerApproval: true,
    };

    it('should create an OT rule when no duplicate employment type exists', async () => {
      prisma.otRule.findUnique.mockResolvedValue(null);
      const created = { id: 'r1', tenantId: 'tenant-1', ...dto };
      prisma.otRule.create.mockResolvedValue(created);

      const result = await service.createOtRule('tenant-1', dto);

      expect(prisma.otRule.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_employmentType: {
            tenantId: 'tenant-1',
            employmentType: dto.employmentType,
          },
        },
      });
      expect(prisma.otRule.create).toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('should skip uniqueness check when employmentType is not provided', async () => {
      const dtoNoType: CreateOtRuleDto = { name: 'General OT' };
      const created = { id: 'r2', tenantId: 'tenant-1', name: 'General OT' };
      prisma.otRule.create.mockResolvedValue(created);

      const result = await service.createOtRule('tenant-1', dtoNoType);

      expect(prisma.otRule.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('should throw ConflictException when employment type rule already exists', async () => {
      prisma.otRule.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.createOtRule('tenant-1', dto)).rejects.toThrow(ConflictException);
      await expect(service.createOtRule('tenant-1', dto)).rejects.toThrow(
        `OT rule for ${dto.employmentType} already exists`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateOtRule
  // ---------------------------------------------------------------------------
  describe('updateOtRule', () => {
    const updateDto: UpdateOtRuleDto = { name: 'Updated OT' };

    it('should update an existing OT rule', async () => {
      const existing = { id: 'r1', tenantId: 'tenant-1', name: 'Old' };
      prisma.otRule.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, name: 'Updated OT' };
      prisma.otRule.update.mockResolvedValue(updated);

      const result = await service.updateOtRule('tenant-1', 'r1', updateDto);

      expect(prisma.otRule.findFirst).toHaveBeenCalledWith({
        where: { id: 'r1', tenantId: 'tenant-1' },
      });
      expect(prisma.otRule.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: updateDto,
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException if OT rule does not exist', async () => {
      prisma.otRule.findFirst.mockResolvedValue(null);

      await expect(
        service.updateOtRule('tenant-1', 'nonexistent', updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteOtRule
  // ---------------------------------------------------------------------------
  describe('deleteOtRule', () => {
    it('should delete an existing OT rule', async () => {
      const existing = { id: 'r1', tenantId: 'tenant-1' };
      prisma.otRule.findFirst.mockResolvedValue(existing);
      prisma.otRule.delete.mockResolvedValue(existing);

      const result = await service.deleteOtRule('tenant-1', 'r1');

      expect(prisma.otRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(result).toEqual(existing);
    });

    it('should throw NotFoundException if OT rule does not exist', async () => {
      prisma.otRule.findFirst.mockResolvedValue(null);

      await expect(service.deleteOtRule('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getDashboardStats
  // ---------------------------------------------------------------------------
  describe('getDashboardStats', () => {
    it('should return all 6 dashboard counts', async () => {
      prisma.employee.count
        .mockResolvedValueOnce(50)   // totalEmployees
        .mockResolvedValueOnce(45);  // activeEmployees
      prisma.attendanceRecord.count
        .mockResolvedValueOnce(30)   // presentToday
        .mockResolvedValueOnce(5)    // onLeaveToday
        .mockResolvedValueOnce(3);   // pendingOtApprovals
      prisma.leaveRequest.count.mockResolvedValue(8); // pendingLeaveRequests

      const result = await service.getDashboardStats('tenant-1');

      expect(result).toEqual({
        totalEmployees: 50,
        activeEmployees: 45,
        presentToday: 30,
        onLeaveToday: 5,
        pendingLeaveRequests: 8,
        pendingOtApprovals: 3,
      });
    });

    it('should return zeros when no data exists', async () => {
      prisma.employee.count.mockResolvedValue(0);
      prisma.attendanceRecord.count.mockResolvedValue(0);
      prisma.leaveRequest.count.mockResolvedValue(0);

      const result = await service.getDashboardStats('tenant-1');

      expect(result).toEqual({
        totalEmployees: 0,
        activeEmployees: 0,
        presentToday: 0,
        onLeaveToday: 0,
        pendingLeaveRequests: 0,
        pendingOtApprovals: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getManagerDashboardStats
  // ---------------------------------------------------------------------------
  describe('getManagerDashboardStats', () => {
    it('should return stats scoped to direct reports', async () => {
      const directReports = [{ id: 'emp-1' }, { id: 'emp-2' }, { id: 'emp-3' }];
      prisma.employee.findMany.mockResolvedValue(directReports);
      prisma.attendanceRecord.count
        .mockResolvedValueOnce(2)   // presentToday
        .mockResolvedValueOnce(1)   // onLeaveToday
        .mockResolvedValueOnce(0);  // pendingOtApprovals
      prisma.leaveRequest.count.mockResolvedValue(1); // pendingLeaveRequests

      const result = await service.getManagerDashboardStats('tenant-1', 'mgr-1');

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', managerId: 'mgr-1', status: 'ACTIVE' },
        select: { id: true },
      });
      expect(result).toEqual({
        teamSize: 3,
        presentToday: 2,
        onLeaveToday: 1,
        pendingLeaveRequests: 1,
        pendingOtApprovals: 0,
      });
    });

    it('should return zero team size when manager has no direct reports', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.count.mockResolvedValue(0);
      prisma.leaveRequest.count.mockResolvedValue(0);

      const result = await service.getManagerDashboardStats('tenant-1', 'mgr-1');

      expect(result).toEqual({
        teamSize: 0,
        presentToday: 0,
        onLeaveToday: 0,
        pendingLeaveRequests: 0,
        pendingOtApprovals: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getAnalytics
  // ---------------------------------------------------------------------------
  describe('getAnalytics', () => {
    it('should return analytics data with all 4 sections', async () => {
      // Mock groupBy for department headcount
      prisma.employee.groupBy.mockResolvedValueOnce([
        { departmentId: 'dept-1', _count: { id: 10 } },
        { departmentId: null, _count: { id: 2 } },
      ]);
      // Mock groupBy for employment type
      prisma.employee.groupBy.mockResolvedValueOnce([
        { employmentType: 'PERMANENT', _count: { id: 8 } },
        { employmentType: 'CONTRACT', _count: { id: 4 } },
      ]);
      // Mock findMany for monthly joins
      prisma.employee.findMany.mockResolvedValue([]);
      // Mock groupBy for leave utilization
      prisma.leaveRequest.groupBy.mockResolvedValue([]);
      // Mock department name resolution
      prisma.department.findMany.mockResolvedValue([
        { id: 'dept-1', name: 'Engineering' },
      ]);

      const result = await service.getAnalytics('tenant-1');

      expect(result).toHaveProperty('headcountByDepartment');
      expect(result).toHaveProperty('employmentTypeDistribution');
      expect(result).toHaveProperty('monthlyJoins');
      expect(result).toHaveProperty('leaveUtilization');
      expect(result.headcountByDepartment).toEqual([
        { department: 'Engineering', count: 10 },
        { department: 'Unassigned', count: 2 },
      ]);
      expect(result.employmentTypeDistribution).toEqual([
        { type: 'PERMANENT', count: 8 },
        { type: 'CONTRACT', count: 4 },
      ]);
      expect(result.monthlyJoins).toHaveLength(6);
    });

    it('should handle empty data', async () => {
      prisma.employee.groupBy
        .mockResolvedValueOnce([])   // department headcount
        .mockResolvedValueOnce([]);  // employment type
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.leaveRequest.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics('tenant-1');

      expect(result.headcountByDepartment).toEqual([]);
      expect(result.employmentTypeDistribution).toEqual([]);
      expect(result.monthlyJoins).toHaveLength(6);
      expect(result.leaveUtilization).toEqual([]);
    });
  });
});
