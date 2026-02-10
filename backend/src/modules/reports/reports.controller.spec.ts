import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  generateAttendanceReport: jest.fn(),
  generateLeaveReport: jest.fn(),
  generateEmployeeReport: jest.fn(),
};

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: typeof mockService;

  const mockUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    }).compile();
    controller = module.get<ReportsController>(ReportsController);
    service = module.get(ReportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // attendanceReport
  // ============================================
  describe('attendanceReport', () => {
    const dto = { from: '2025-01-01', to: '2025-01-31' };

    it('should generate attendance report and send file', async () => {
      const fileResult = {
        buffer: Buffer.from('report-data'),
        filename: 'attendance.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      service.generateAttendanceReport.mockResolvedValue(fileResult);

      const mockRes = {
        set: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.attendanceReport(mockUser, dto, mockRes);

      expect(service.generateAttendanceReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dto,
        mockUser.role,
        mockUser.employeeId,
      );
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': fileResult.contentType,
        'Content-Disposition': `attachment; filename="${fileResult.filename}"`,
        'Content-Length': fileResult.buffer.length,
      });
      expect(mockRes.end).toHaveBeenCalledWith(fileResult.buffer);
    });

    it('should pass dto with optional filters', async () => {
      const dtoWithFilters = {
        from: '2025-01-01',
        to: '2025-01-31',
        departmentId: 'dept-1',
        employeeId: 'emp-1',
        format: 'csv' as any,
      };
      service.generateAttendanceReport.mockResolvedValue({
        buffer: Buffer.from('csv-data'),
        filename: 'attendance.csv',
        contentType: 'text/csv',
      });

      const mockRes = { set: jest.fn(), end: jest.fn() } as any;

      await controller.attendanceReport(mockUser, dtoWithFilters, mockRes);

      expect(service.generateAttendanceReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dtoWithFilters,
        mockUser.role,
        mockUser.employeeId,
      );
    });
  });

  // ============================================
  // leaveReport
  // ============================================
  describe('leaveReport', () => {
    const dto = { year: '2025' };

    it('should generate leave report and send file', async () => {
      const fileResult = {
        buffer: Buffer.from('leave-data'),
        filename: 'leave.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      service.generateLeaveReport.mockResolvedValue(fileResult);

      const mockRes = {
        set: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.leaveReport(mockUser, dto, mockRes);

      expect(service.generateLeaveReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dto,
        mockUser.role,
        mockUser.employeeId,
      );
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': fileResult.contentType,
        'Content-Disposition': `attachment; filename="${fileResult.filename}"`,
        'Content-Length': fileResult.buffer.length,
      });
      expect(mockRes.end).toHaveBeenCalledWith(fileResult.buffer);
    });

    it('should pass dto with department and employee filters', async () => {
      const dtoWithFilters = {
        year: '2025',
        departmentId: 'dept-1',
        employeeId: 'emp-1',
      };
      service.generateLeaveReport.mockResolvedValue({
        buffer: Buffer.from('data'),
        filename: 'leave.xlsx',
        contentType: 'application/octet-stream',
      });

      const mockRes = { set: jest.fn(), end: jest.fn() } as any;

      await controller.leaveReport(mockUser, dtoWithFilters, mockRes);

      expect(service.generateLeaveReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dtoWithFilters,
        mockUser.role,
        mockUser.employeeId,
      );
    });
  });

  // ============================================
  // employeeReport
  // ============================================
  describe('employeeReport', () => {
    const dto = {};

    it('should generate employee report and send file', async () => {
      const fileResult = {
        buffer: Buffer.from('employee-data'),
        filename: 'employees.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      service.generateEmployeeReport.mockResolvedValue(fileResult);

      const mockRes = {
        set: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.employeeReport(mockUser, dto, mockRes);

      expect(service.generateEmployeeReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dto,
        mockUser.role,
        mockUser.employeeId,
      );
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': fileResult.contentType,
        'Content-Disposition': `attachment; filename="${fileResult.filename}"`,
        'Content-Length': fileResult.buffer.length,
      });
      expect(mockRes.end).toHaveBeenCalledWith(fileResult.buffer);
    });

    it('should pass filters for department, status, and employment type', async () => {
      const dtoWithFilters = {
        departmentId: 'dept-1',
        status: 'ACTIVE',
        employmentType: 'FULL_TIME',
        format: 'csv' as any,
      };
      service.generateEmployeeReport.mockResolvedValue({
        buffer: Buffer.from('csv'),
        filename: 'employees.csv',
        contentType: 'text/csv',
      });

      const mockRes = { set: jest.fn(), end: jest.fn() } as any;

      await controller.employeeReport(mockUser, dtoWithFilters, mockRes);

      expect(service.generateEmployeeReport).toHaveBeenCalledWith(
        mockUser.tenantId,
        dtoWithFilters,
        mockUser.role,
        mockUser.employeeId,
      );
    });
  });
});
