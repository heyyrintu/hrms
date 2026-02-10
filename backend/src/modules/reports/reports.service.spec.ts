import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { ReportFormat } from './dto/report.dto';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma = createMockPrismaService();
    // The reports service uses prisma.attendanceRecord which is not in the
    // standard mock model list. Add it manually.
    (mockPrisma as any).attendanceRecord = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================
  // generateAttendanceReport()
  // ============================
  describe('generateAttendanceReport', () => {
    it('should generate an XLSX attendance report', async () => {
      const records = [
        {
          employee: {
            employeeCode: 'E001',
            firstName: 'John',
            lastName: 'Doe',
            department: { name: 'Engineering' },
          },
          date: new Date('2024-01-15'),
          status: 'PRESENT',
          clockInTime: new Date('2024-01-15T09:00:00Z'),
          clockOutTime: new Date('2024-01-15T17:00:00Z'),
          workedMinutes: 480,
          breakMinutes: 30,
          standardWorkMinutes: 480,
          otMinutesCalculated: 0,
          otMinutesApproved: null,
          remarks: '',
        },
      ];
      prisma.attendanceRecord.findMany.mockResolvedValue(records);

      const result = await service.generateAttendanceReport('tenant-1', {
        from: '2024-01-01',
        to: '2024-01-31',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          date: { gte: new Date('2024-01-01'), lte: new Date('2024-01-31') },
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: [{ date: 'asc' }, { employee: { firstName: 'asc' } }],
      });
      expect(result.filename).toBe('attendance_report_2024-01-01_to_2024-01-31.xlsx');
      expect(result.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should generate a CSV attendance report', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      const result = await service.generateAttendanceReport('tenant-1', {
        from: '2024-01-01',
        to: '2024-01-31',
        format: ReportFormat.CSV,
      });

      expect(result.filename).toBe('attendance_report_2024-01-01_to_2024-01-31.csv');
      expect(result.contentType).toBe('text/csv');
    });

    it('should filter by employeeId when provided', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.generateAttendanceReport('tenant-1', {
        from: '2024-01-01',
        to: '2024-01-31',
        employeeId: 'emp-1',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employeeId: 'emp-1' }),
        }),
      );
    });

    it('should filter by departmentId when provided', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.generateAttendanceReport('tenant-1', {
        from: '2024-01-01',
        to: '2024-01-31',
        departmentId: 'dept-1',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: { departmentId: 'dept-1' },
          }),
        }),
      );
    });
  });

  // ============================
  // generateLeaveReport()
  // ============================
  describe('generateLeaveReport', () => {
    it('should generate an XLSX leave report', async () => {
      const balances = [
        {
          employee: {
            employeeCode: 'E001',
            firstName: 'John',
            lastName: 'Doe',
            department: { name: 'Engineering' },
          },
          leaveType: { name: 'Annual', code: 'AL' },
          year: 2024,
          totalDays: 20,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        },
      ];
      prisma.leaveBalance.findMany.mockResolvedValue(balances);

      const result = await service.generateLeaveReport('tenant-1', { year: '2024' });

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', year: 2024 },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
          leaveType: { select: { name: true, code: true } },
        },
        orderBy: [
          { employee: { firstName: 'asc' } },
          { leaveType: { name: 'asc' } },
        ],
      });
      expect(result.filename).toBe('leave_report_2024.xlsx');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should default to current year when year not specified', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.generateLeaveReport('tenant-1', {});

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ year: new Date().getFullYear() }),
        }),
      );
    });

    it('should generate CSV format when requested', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      const result = await service.generateLeaveReport('tenant-1', {
        format: ReportFormat.CSV,
      });

      expect(result.filename).toContain('.csv');
      expect(result.contentType).toBe('text/csv');
    });
  });

  // ============================
  // generateEmployeeReport()
  // ============================
  describe('generateEmployeeReport', () => {
    it('should generate an XLSX employee report', async () => {
      const employees = [
        {
          employeeCode: 'E001',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
          phone: '123',
          department: { name: 'Engineering' },
          designation: 'Dev',
          employmentType: 'FULL_TIME',
          payType: 'SALARIED',
          status: 'ACTIVE',
          joinDate: new Date('2023-01-01'),
          exitDate: null,
          manager: { firstName: 'Jane', lastName: 'Smith' },
          hourlyRate: null,
          otMultiplier: 1.5,
        },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);

      const result = await service.generateEmployeeReport('tenant-1', {});

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: {
          department: { select: { name: true } },
          manager: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
      expect(result.filename).toBe('employee_report.xlsx');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should filter by departmentId, status, and employmentType', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      await service.generateEmployeeReport('tenant-1', {
        departmentId: 'dept-1',
        status: 'ACTIVE',
        employmentType: 'FULL_TIME',
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            departmentId: 'dept-1',
            status: 'ACTIVE',
            employmentType: 'FULL_TIME',
          },
        }),
      );
    });

    it('should produce CSV with No data found for empty result', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.generateEmployeeReport('tenant-1', {
        format: ReportFormat.CSV,
      });

      expect(result.contentType).toBe('text/csv');
      expect(result.buffer.toString()).toBe('No data found');
    });
  });
});
