import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { OtCalculationService } from './ot-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendancePolicyService } from './policy/attendance-policy.service';
import { ATTENDANCE_POLICY_DEFAULTS } from './policy/attendance-policy.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  mockSuperAdmin,
  mockManager,
} from '../../test/helpers';

function createMockOtCalculationService() {
  return {
    getOtRule: jest.fn().mockResolvedValue(null),
    calculateOtMinutes: jest.fn().mockReturnValue(0),
    calculateWorkedMinutes: jest.fn().mockReturnValue(0),
    calculateWorkedMinutesFromSessions: jest.fn().mockReturnValue(0),
    checkMonthlyOtLimit: jest
      .fn()
      .mockResolvedValue({ exceeded: false, currentTotal: 0, limit: null }),
    roundMinutes: jest.fn().mockReturnValue(0),
  };
}

function createMockAttendancePolicyService(
  overrides: Record<string, unknown> = {},
) {
  return {
    getOrCreate: jest.fn().mockResolvedValue({
      id: 'pol-1',
      tenantId: 'test-tenant',
      ...ATTENDANCE_POLICY_DEFAULTS,
      ...overrides,
    }),
    update: jest.fn(),
  };
}

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: any;
  let otCalc: any;
  let notifications: any;
  let policyService: any;

  const tenantId = 'test-tenant';
  const employeeId = 'emp-1';

  const mockEmployee = {
    id: employeeId,
    tenantId,
    firstName: 'John',
    lastName: 'Doe',
    employeeCode: 'E001',
    status: 'ACTIVE',
    employmentType: 'FULL_TIME',
    payType: 'SALARIED',
    hourlyRate: null,
    otMultiplier: null,
  };

  const today = new Date();
  const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: OtCalculationService, useValue: createMockOtCalculationService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        {
          provide: AttendancePolicyService,
          useValue: createMockAttendancePolicyService(),
        },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    prisma = module.get(PrismaService);
    otCalc = module.get(OtCalculationService);
    notifications = module.get(NotificationsService);
    policyService = module.get(AttendancePolicyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -----------------------------------------------------------
  // clockIn
  // -----------------------------------------------------------
  describe('clockIn', () => {
    // Valid GPS coordinates used in all clockIn tests (no geofencing: tenant.findUnique returns undefined by default)
    const mockCoords = { latitude: 28.6139, longitude: 77.209 };

    it('should create a new attendance record when none exists for today', async () => {
      const createdRecord = {
        id: 'att-1',
        tenantId,
        employeeId,
        date: dateOnly,
        clockInTime: expect.any(Date),
        status: 'PRESENT',
        source: 'WEB',
        sessions: [{ id: 'sess-1', inTime: new Date(), outTime: null }],
      };

      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null); // no geofencing
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue(createdRecord);
      // getAttendanceById is called at the end
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        ...createdRecord,
        employee: mockEmployee,
      });

      const result = await service.clockIn(tenantId, employeeId, { ...mockCoords });

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: employeeId, tenantId, status: 'ACTIVE' },
      });
      expect(prisma.attendanceRecord.create).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.employee).toBeDefined();
    });

    // `AttendanceRecord.date` is `@db.Date`: Prisma writes the UTC date part,
    // and the auto-absent sweep and the payroll LOP join both read it that
    // way. Deriving the day in the server's zone would store 15 March for a
    // 16 March IST clock-in on an IST-hosted box, and the sweep would then
    // mark a present employee ABSENT.
    it('stores the Asia/Kolkata calendar day as UTC midnight, not server-local midnight', async () => {
      // 20:00 UTC on 15 March is already 01:30 IST on 16 March.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T20:00:00Z'));
      try {
        prisma.employee.findFirst.mockResolvedValue(mockEmployee);
        prisma.tenant.findUnique.mockResolvedValue(null);
        prisma.attendanceRecord.findUnique.mockResolvedValue(null);
        prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });
        prisma.attendanceRecord.findFirst.mockResolvedValue({
          id: 'att-1',
          employee: mockEmployee,
        });

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              tenantId_employeeId_date: {
                tenantId,
                employeeId,
                date: new Date('2026-03-16T00:00:00.000Z'),
              },
            },
          }),
        );
        expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              date: new Date('2026-03-16T00:00:00.000Z'),
            }),
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.clockIn(tenantId, employeeId, { ...mockCoords })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should run the open-session check and session insert in one serializable transaction', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'att-1', employee: mockEmployee });

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('should surface a lost create race on the daily unique key as ConflictException', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.clockIn(tenantId, employeeId, { ...mockCoords })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should surface a concurrent double-tap as ConflictException instead of a second open session', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );

      await expect(service.clockIn(tenantId, employeeId, { ...mockCoords })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when already clocked in (open session exists)', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null); // no geofencing
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        sessions: [{ id: 'sess-1', inTime: new Date(), outTime: null }],
      });

      await expect(service.clockIn(tenantId, employeeId, { ...mockCoords })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.clockIn(tenantId, employeeId, { ...mockCoords })).rejects.toThrow(
        'Already clocked in',
      );
    });

    it('should create a new session when attendance exists but no open session', async () => {
      const existingAttendance = {
        id: 'att-1',
        clockInTime: new Date(),
        sessions: [
          { id: 'sess-1', inTime: new Date(), outTime: new Date() },
        ],
      };

      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null); // no geofencing
      prisma.attendanceRecord.findUnique.mockResolvedValue(existingAttendance);
      prisma.attendanceSession.create.mockResolvedValue({ id: 'sess-2' });
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        ...existingAttendance,
        employee: mockEmployee,
      });

      const result = await service.clockIn(tenantId, employeeId, { ...mockCoords });

      expect(prisma.attendanceSession.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          attendanceId: 'att-1',
          inTime: expect.any(Date),
        },
      });
      expect(result).toBeDefined();
    });

    it('should update clockInTime when attendance exists with no clockInTime', async () => {
      const existingAttendance = {
        id: 'att-1',
        clockInTime: null,
        sessions: [
          { id: 'sess-1', inTime: new Date(), outTime: new Date() },
        ],
      };

      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null); // no geofencing
      prisma.attendanceRecord.findUnique.mockResolvedValue(existingAttendance);
      prisma.attendanceSession.create.mockResolvedValue({ id: 'sess-2' });
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        ...existingAttendance,
        employee: mockEmployee,
      });

      await service.clockIn(tenantId, employeeId, { ...mockCoords, source: 'MOBILE' as any, remarks: 'late' });

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: expect.objectContaining({
          clockInTime: expect.any(Date),
          status: 'PRESENT',
          source: 'MOBILE',
          remarks: 'late',
        }),
      });
    });

    it('should use WEB as default source when not provided', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null); // no geofencing
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({
        id: 'att-1',
        sessions: [],
      });
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'WEB',
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // clockOut
  // -----------------------------------------------------------
  describe('clockOut', () => {
    it('should throw BadRequestException when no attendance record for today', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        'No clock-in record found for today',
      );
    });

    it('should throw BadRequestException when no open session found', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        sessions: [{ id: 'sess-1', inTime: new Date(), outTime: new Date() }],
      });

      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        'No open session found',
      );
    });

    it('should close the open session and update attendance', async () => {
      const clockInTime = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8 hours ago
      const openSession = { id: 'sess-1', inTime: clockInTime, outTime: null };

      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        sessions: [openSession],
      });
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      otCalc.getOtRule.mockResolvedValue(null);
      otCalc.calculateOtMinutes.mockReturnValue(0);

      prisma.attendanceSession.findMany.mockResolvedValue([
        { ...openSession, sessionMinutes: 480 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });

      const result = await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: {
          outTime: expect.any(Date),
          sessionMinutes: expect.any(Number),
        },
      });
      expect(prisma.attendanceRecord.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should use breakMinutes from dto when provided', async () => {
      const clockInTime = new Date(Date.now() - 9 * 60 * 60 * 1000);
      const openSession = { id: 'sess-1', inTime: clockInTime, outTime: null };

      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        sessions: [openSession],
      });
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      otCalc.getOtRule.mockResolvedValue(null);
      otCalc.calculateOtMinutes.mockReturnValue(0);

      prisma.attendanceSession.findMany.mockResolvedValue([
        { id: 'sess-1', sessionMinutes: 540 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });

      await service.clockOut(tenantId, employeeId, { breakMinutes: 60 });

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            breakMinutes: 60,
          }),
        }),
      );
    });

    it('should calculate OT minutes via the OtCalculationService', async () => {
      const clockInTime = new Date(Date.now() - 10 * 60 * 60 * 1000);
      const openSession = { id: 'sess-1', inTime: clockInTime, outTime: null };
      const otRule = { id: 'rule-1', dailyThresholdMinutes: 480 };

      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        sessions: [openSession],
      });
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      otCalc.getOtRule.mockResolvedValue(otRule);
      otCalc.calculateOtMinutes.mockReturnValue(120);

      prisma.attendanceSession.findMany.mockResolvedValue([
        { id: 'sess-1', sessionMinutes: 600 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });

      await service.clockOut(tenantId, employeeId, {});

      expect(otCalc.getOtRule).toHaveBeenCalledWith(tenantId, mockEmployee.employmentType);
      expect(otCalc.calculateOtMinutes).toHaveBeenCalledWith(600, 480, otRule);
      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            otMinutesCalculated: 120,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // getTodayStatus
  // -----------------------------------------------------------
  describe('getTodayStatus', () => {
    it('should return NOT_CLOCKED_IN when no attendance record exists', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      const result = await service.getTodayStatus(tenantId, employeeId);

      expect(result).toEqual({
        status: 'NOT_CLOCKED_IN',
        clockedIn: false,
        clockInTime: null,
        clockOutTime: null,
        workedMinutes: 0,
      });
    });

    it('should return clockedIn: true when last session has no outTime', async () => {
      const sessionInTime = new Date();
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        status: 'PRESENT',
        clockInTime: sessionInTime,
        clockOutTime: null,
        workedMinutes: 0,
        otMinutesCalculated: 0,
        sessions: [{ id: 'sess-1', inTime: sessionInTime, outTime: null }],
      });

      const result = await service.getTodayStatus(tenantId, employeeId);

      expect(result.clockedIn).toBe(true);
      expect(result.status).toBe('PRESENT');
      expect(result.currentSessionStart).toEqual(sessionInTime);
    });

    it('should return clockedIn: false when last session is closed', async () => {
      const now = new Date();
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        status: 'PRESENT',
        clockInTime: now,
        clockOutTime: now,
        workedMinutes: 480,
        otMinutesCalculated: 0,
        sessions: [{ id: 'sess-1', inTime: now, outTime: now }],
      });

      const result = await service.getTodayStatus(tenantId, employeeId);

      expect(result.clockedIn).toBe(false);
      expect(result.currentSessionStart).toBeNull();
    });
  });

  // -----------------------------------------------------------
  // getMyAttendance
  // -----------------------------------------------------------
  describe('getMyAttendance', () => {
    it('should return attendance records for the given date range', async () => {
      const records = [
        { id: 'att-1', date: new Date('2025-01-01'), sessions: [] },
        { id: 'att-2', date: new Date('2025-01-02'), sessions: [] },
      ];
      prisma.attendanceRecord.findMany.mockResolvedValue(records);

      const result = await service.getMyAttendance(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId,
          date: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        include: {
          sessions: { orderBy: { inTime: 'asc' } },
        },
        orderBy: { date: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------
  // getEmployeeAttendance
  // -----------------------------------------------------------
  describe('getEmployeeAttendance', () => {
    it('should return attendance with employee details', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getEmployeeAttendance(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            employee: expect.any(Object),
          }),
        }),
      );
    });

    it('should filter by status when provided', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getEmployeeAttendance(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-01-31',
        status: 'PRESENT' as any,
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PRESENT',
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // getAttendanceSummary
  // -----------------------------------------------------------
  describe('getAttendanceSummary', () => {
    it('should aggregate attendance records and return summary', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', workedMinutes: 480, otMinutesCalculated: 60, otMinutesApproved: 30 },
        { status: 'PRESENT', workedMinutes: 500, otMinutesCalculated: 80, otMinutesApproved: null },
        { status: 'LEAVE', workedMinutes: 0, otMinutesCalculated: 0, otMinutesApproved: null },
      ]);

      const result = await service.getAttendanceSummary(tenantId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(result.totalRecords).toBe(3);
      expect(result.statusCounts).toEqual({ PRESENT: 2, LEAVE: 1 });
      expect(result.totalWorkedMinutes).toBe(980);
      expect(result.totalOtCalculated).toBe(140);
      expect(result.totalOtApproved).toBe(30);
      expect(result.averageWorkedMinutesPerDay).toBe(Math.round(980 / 3));
    });

    it('should return zeros when no records found', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      const result = await service.getAttendanceSummary(tenantId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(result.totalRecords).toBe(0);
      expect(result.totalWorkedMinutes).toBe(0);
      expect(result.averageWorkedMinutesPerDay).toBe(0);
    });

    it('should filter by employeeId when provided', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getAttendanceSummary(tenantId, {
        from: '2025-01-01',
        to: '2025-01-31',
        employeeId: 'emp-1',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 'emp-1',
          }),
        }),
      );
    });

    it('should filter by departmentId when provided', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getAttendanceSummary(tenantId, {
        from: '2025-01-01',
        to: '2025-01-31',
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

  // -----------------------------------------------------------
  // getPendingOtApprovals
  // -----------------------------------------------------------
  describe('getPendingOtApprovals', () => {
    it('should return all pending OT records for SUPER_ADMIN', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getPendingOtApprovals(mockSuperAdmin);

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: mockSuperAdmin.tenantId,
            otMinutesCalculated: { gt: 0 },
            otMinutesApproved: null,
            clockOutTime: { not: null },
          }),
        }),
      );
    });

    it('should scope MANAGER to direct reports only', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.getPendingOtApprovals(mockManager);

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: { managerId: mockManager.employeeId },
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // approveOt
  // -----------------------------------------------------------
  describe('approveOt', () => {
    const attendanceRecord = {
      id: 'att-1',
      tenantId,
      employeeId,
      date: new Date('2025-01-15'),
      otMinutesCalculated: 120,
      otMinutesApproved: null,
      remarks: null,
    };

    it('should approve OT and notify employee', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue(attendanceRecord);
      prisma.attendanceRecord.update.mockResolvedValue({
        ...attendanceRecord,
        otMinutesApproved: 90,
        employee: mockEmployee,
        sessions: [],
      });

      const result = await service.approveOt(tenantId, 'att-1', {
        otMinutesApproved: 90,
      });

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: {
          otMinutesApproved: 90,
          remarks: null,
        },
        include: expect.any(Object),
      });
      expect(notifications.notifyEmployee).toHaveBeenCalled();
      expect(result.otMinutesApproved).toBe(90);
    });

    it('should throw BadRequestException when approved OT exceeds calculated', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue(attendanceRecord);

      await expect(
        service.approveOt(tenantId, 'att-1', { otMinutesApproved: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when attendance record not found', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.approveOt(tenantId, 'nonexistent', { otMinutesApproved: 60 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use dto remarks when provided', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue(attendanceRecord);
      prisma.attendanceRecord.update.mockResolvedValue({
        ...attendanceRecord,
        otMinutesApproved: 60,
        remarks: 'approved partial',
        employee: mockEmployee,
        sessions: [],
      });

      await service.approveOt(tenantId, 'att-1', {
        otMinutesApproved: 60,
        remarks: 'approved partial',
      });

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remarks: 'approved partial',
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // getPayableHours
  // -----------------------------------------------------------
  describe('getPayableHours', () => {
    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.getPayableHours(tenantId, employeeId, {
          from: '2025-01-01',
          to: '2025-01-31',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return payable hours summary for salaried employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', workedMinutes: 480, otMinutesCalculated: 60, otMinutesApproved: 60 },
        { status: 'PRESENT', workedMinutes: 500, otMinutesCalculated: 80, otMinutesApproved: null },
      ]);

      const result = await service.getPayableHours(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(result.employeeId).toBe(employeeId);
      expect(result.totalWorkedMinutes).toBe(980);
      expect(result.totalOtMinutesCalculated).toBe(140);
      expect(result.totalOtMinutesApproved).toBe(60);
      expect(result.daysWorked).toBe(2);
      // Salaried employee should NOT have estimatedPay fields
      expect(result.estimatedRegularPay).toBeUndefined();
    });

    it('should calculate estimated pay for hourly employees', async () => {
      const hourlyEmployee = {
        ...mockEmployee,
        payType: 'HOURLY',
        hourlyRate: 25,
        otMultiplier: 1.5,
      };
      prisma.employee.findFirst.mockResolvedValue(hourlyEmployee);
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', workedMinutes: 480, otMinutesCalculated: 0, otMinutesApproved: 0 },
        { status: 'PRESENT', workedMinutes: 540, otMinutesCalculated: 60, otMinutesApproved: 60 },
      ]);

      const result = await service.getPayableHours(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(result.hourlyRate).toBe(25);
      expect(result.otMultiplier).toBe(1.5);
      expect(result.estimatedRegularPay).toBeDefined();
      expect(result.estimatedOtPay).toBeDefined();
      expect(result.estimatedTotalPay).toBeDefined();

      // Verify calculations: regularHours = 1020/60 = 17, otHours = 60/60 = 1
      // regularPay = 17 * 25 = 425, otPay = 1 * 25 * 1.5 = 37.5
      expect(result.estimatedRegularPay).toBe(425);
      expect(result.estimatedOtPay).toBe(37.5);
      expect(result.estimatedTotalPay).toBe(462.5);
    });
  });

  // -----------------------------------------------------------
  // createManualAttendance
  // -----------------------------------------------------------
  describe('createManualAttendance', () => {
    const manualDto = {
      employeeId,
      date: '2025-01-15',
      clockInTime: '2025-01-15T09:00:00Z',
      clockOutTime: '2025-01-15T18:00:00Z',
      breakMinutes: 60,
      status: 'PRESENT' as any,
      remarks: 'manual entry',
    };

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createManualAttendance(tenantId, manualDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when attendance already exists', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findUnique.mockResolvedValue({ id: 'att-existing' });

      await expect(
        service.createManualAttendance(tenantId, manualDto),
      ).rejects.toThrow(BadRequestException);
    });

    // Same UTC-midnight basis as clockIn, so an HR-entered day and a punched
    // day collide on the daily unique key instead of sitting side by side.
    it('keys the day on UTC midnight rather than server-local midnight', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      otCalc.calculateWorkedMinutes.mockReturnValue(480);
      otCalc.getOtRule.mockResolvedValue(null);
      otCalc.calculateOtMinutes.mockReturnValue(0);
      prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-new' });

      await service.createManualAttendance(tenantId, manualDto);

      expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_employeeId_date: {
            tenantId,
            employeeId,
            date: new Date('2025-01-15T00:00:00.000Z'),
          },
        },
      });
      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            date: new Date('2025-01-15T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('should create manual attendance with worked minutes and OT', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      otCalc.calculateWorkedMinutes.mockReturnValue(480);
      otCalc.getOtRule.mockResolvedValue(null);
      otCalc.calculateOtMinutes.mockReturnValue(0);

      const created = {
        id: 'att-new',
        tenantId,
        employeeId,
        workedMinutes: 480,
        employee: mockEmployee,
      };
      prisma.attendanceRecord.create.mockResolvedValue(created);

      const result = await service.createManualAttendance(tenantId, manualDto);

      expect(otCalc.calculateWorkedMinutes).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        60,
      );
      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'API',
            standardWorkMinutes: 480,
          }),
        }),
      );
      expect(result.id).toBe('att-new');
    });

    it('should create manual attendance without clock times (e.g., marking absent)', async () => {
      const absentDto = {
        employeeId,
        date: '2025-01-15',
        status: 'ABSENT' as any,
        remarks: 'absent',
      };

      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({
        id: 'att-absent',
        employee: mockEmployee,
      });

      await service.createManualAttendance(tenantId, absentDto);

      // calculateWorkedMinutes should NOT be called since no clockIn/clockOut
      expect(otCalc.calculateWorkedMinutes).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workedMinutes: 0,
            otMinutesCalculated: 0,
          }),
        }),
      );
    });
  });
  // -----------------------------------------------------------
  // Late marks (clock-in) and the half-day penalty (clock-out)
  // -----------------------------------------------------------
  describe('late marks', () => {
    const mockCoords = { latitude: 12.9716, longitude: 77.5946 };

    function primeClockIn() {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });
    }

    it('scores the punch against the employee shift when one is assigned', async () => {
      primeClockIn();
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        shift: { id: 'shift-1', startTime: '00:00', graceMinutes: 0, isActive: true },
      });

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      // A 00:00 shift with no grace means any punch after midnight IST is late.
      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLate: true }),
        }),
      );
      expect(policyService.getOrCreate).not.toHaveBeenCalled();
    });

    it('falls back to the tenant policy when the employee has no shift', async () => {
      primeClockIn();
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        defaultShiftStart: '23:59',
        defaultGraceMinutes: 0,
      });

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      expect(policyService.getOrCreate).toHaveBeenCalledWith(tenantId);
      // A 23:59 shift start means almost nothing can be late.
      expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLate: false, lateByMinutes: null }),
        }),
      );
    });

    it('leaves lateByMinutes null when the punch is on time', async () => {
      primeClockIn();
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        defaultShiftStart: '23:59',
      });

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      const data = prisma.attendanceRecord.create.mock.calls[0][0].data;
      expect(data.isLate).toBe(false);
      expect(data.lateByMinutes).toBeNull();
    });

    function primeClockOut(attendance: Record<string, unknown>) {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        status: 'PRESENT',
        isLate: false,
        date: new Date('2026-03-16T00:00:00Z'),
        sessions: [{ id: 'sess-1', inTime: new Date(), outTime: null }],
        ...attendance,
      });
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      // A full day's work in an earlier session, so the worked-hours
      // classification leaves the status alone and these tests see only the
      // late-mark penalty.
      prisma.attendanceSession.findMany.mockResolvedValue([
        { id: 'sess-0', sessionMinutes: 480 },
        { id: 'sess-1', sessionMinutes: 0 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });
    }

    it('converts the day to HALF_DAY on the Nth late mark of the month', async () => {
      primeClockOut({ isLate: true });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 3,
      });
      prisma.attendanceRecord.count.mockResolvedValue(3);

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.count).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId,
          isLate: true,
          date: {
            gte: new Date('2026-03-01T00:00:00Z'),
            lte: new Date('2026-03-16T00:00:00Z'),
          },
        },
      });
      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'HALF_DAY' }),
        }),
      );
    });

    it('converts again on every further multiple of N', async () => {
      primeClockOut({ isLate: true });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 3,
      });
      prisma.attendanceRecord.count.mockResolvedValue(6);

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'HALF_DAY' }),
        }),
      );
    });

    it('leaves the status alone below the threshold', async () => {
      primeClockOut({ isLate: true });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 3,
      });
      prisma.attendanceRecord.count.mockResolvedValue(2);

      await service.clockOut(tenantId, employeeId, {});

      const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
      expect(data.status).toBeUndefined();
    });

    it('does nothing when the tenant has no late-mark threshold', async () => {
      primeClockOut({ isLate: true });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: null,
      });

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
      const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
      expect(data.status).toBeUndefined();
    });

    it('does not count the month when the day was not late', async () => {
      primeClockOut({ isLate: false });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 1,
      });

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
    });

    it('never softens a day that is already worse than a half day', async () => {
      primeClockOut({ isLate: true, status: 'LEAVE' });
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 1,
      });

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
      const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
      expect(data.status).toBeUndefined();
    });
  });

  // -----------------------------------------------------------
  // worked-hours classification at clock-out
  // -----------------------------------------------------------
  describe('worked-hours classification', () => {
    function primeClockOut(
      attendance: Record<string, unknown>,
      totalSessionMinutes: number,
    ) {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        status: 'PRESENT',
        isLate: false,
        date: new Date('2026-03-16T00:00:00Z'),
        sessions: [{ id: 'sess-1', inTime: new Date(), outTime: null }],
        ...attendance,
      });
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendanceSession.findMany.mockResolvedValue([
        { id: 'sess-0', sessionMinutes: totalSessionMinutes },
        { id: 'sess-1', sessionMinutes: 0 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });
    }

    const statusWritten = () => prisma.attendanceRecord.update.mock.calls[0][0].data.status;

    it('marks HALF_DAY between the half-day and full-day thresholds', async () => {
      primeClockOut({}, 300);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBe('HALF_DAY');
    });

    it('marks ABSENT below the half-day threshold, which payroll reads as LOP', async () => {
      primeClockOut({}, 200);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBe('ABSENT');
    });

    it('classifies on net minutes, after breaks', async () => {
      // 500 minutes logged, 60 minutes break -> 440 net, short of 480.
      primeClockOut({}, 500);

      await service.clockOut(tenantId, employeeId, { breakMinutes: 60 });

      expect(statusWritten()).toBe('HALF_DAY');
    });

    it('leaves a full day alone', async () => {
      primeClockOut({}, 480);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBeUndefined();
    });

    it('restores PRESENT when a later session completes the day', async () => {
      primeClockOut({ status: 'HALF_DAY' }, 500);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBe('PRESENT');
    });

    it('does nothing when the tenant switched both thresholds off', async () => {
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        minHalfDayMinutes: 0,
        minFullDayMinutes: 0,
      });
      primeClockOut({}, 30);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBeUndefined();
    });

    it('never rewrites a LEAVE or HOLIDAY day', async () => {
      primeClockOut({ status: 'HOLIDAY' }, 30);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBeUndefined();
    });

    it('leaves a regularized day with the status its approver gave it', async () => {
      primeClockOut({}, 30);
      prisma.attendanceRegularization.findFirst.mockResolvedValue({ id: 'reg-1' });

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRegularization.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId,
          date: new Date('2026-03-16T00:00:00Z'),
          status: 'APPROVED',
        },
        select: { id: true },
      });
      expect(statusWritten()).toBeUndefined();
    });

    it('applies the late-mark penalty on top of a full day', async () => {
      policyService.getOrCreate.mockResolvedValue({
        ...ATTENDANCE_POLICY_DEFAULTS,
        lateMarksPerHalfDay: 1,
      });
      prisma.attendanceRecord.count.mockResolvedValue(1);
      primeClockOut({ isLate: true }, 480);

      await service.clockOut(tenantId, employeeId, {});

      expect(statusWritten()).toBe('HALF_DAY');
    });
  });

  // -----------------------------------------------------------
  // night shifts
  // -----------------------------------------------------------
  describe('overnight shifts', () => {
    const mockCoords = { latitude: 12.9716, longitude: 77.5946 };
    const nightShift = {
      id: 'shift-night',
      startTime: '22:00',
      endTime: '06:00',
      graceMinutes: 0,
      isOvernight: true,
      isActive: true,
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    function primeClockIn() {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'att-1',
        employee: mockEmployee,
        sessions: [],
      });
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        shift: nightShift,
      });
    }

    it('files a clock-in after midnight under the day the shift started, late from 22:00', async () => {
      // 00:30 IST on the 17th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-16T19:00:00Z'));
      primeClockIn();

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      const data = prisma.attendanceRecord.create.mock.calls[0][0].data;
      expect(data.date).toEqual(new Date('2026-03-16T00:00:00Z'));
      expect(data.isLate).toBe(true);
      expect(data.lateByMinutes).toBe(150);
      expect(data.shiftId).toBe('shift-night');
    });

    it('is not late for an early clock-in before the start', async () => {
      // 21:55 IST on the 16th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-16T16:25:00Z'));
      primeClockIn();

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      const data = prisma.attendanceRecord.create.mock.calls[0][0].data;
      expect(data.date).toEqual(new Date('2026-03-16T00:00:00Z'));
      expect(data.isLate).toBe(false);
    });

    it('closes the shift the next morning with minutes counted across midnight', async () => {
      // 06:05 IST on the 17th; clocked in 22:00 IST on the 16th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T00:35:00Z'));
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-1', shift: nightShift });
      const openSession = {
        id: 'sess-1',
        inTime: new Date('2026-03-16T16:30:00Z'),
        outTime: null,
      };
      // Only the 16th has a row; the 17th has nothing yet.
      prisma.attendanceRecord.findUnique.mockImplementation(
        async ({ where }: { where: { tenantId_employeeId_date: { date: Date } } }) =>
          where.tenantId_employeeId_date.date.toISOString() === '2026-03-16T00:00:00.000Z'
            ? {
                id: 'att-1',
                date: new Date('2026-03-16T00:00:00Z'),
                standardWorkMinutes: 480,
                breakMinutes: 0,
                remarks: null,
                status: 'PRESENT',
                isLate: false,
                sessions: [openSession],
              }
            : null,
      );
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendanceSession.findMany.mockResolvedValue([
        { ...openSession, sessionMinutes: 0 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'att-1', sessions: [] });

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_employeeId_date: {
              tenantId,
              employeeId,
              date: new Date('2026-03-16T00:00:00Z'),
            },
          },
        }),
      );
      expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { outTime: expect.any(Date), sessionMinutes: 485 },
      });
      const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
      expect(data.workedMinutes).toBe(485);
      expect(data.status).toBeUndefined();
    });

    it("shows a night-shift employee as clocked in on the dashboard after midnight", async () => {
      // 02:00 IST on the 17th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-16T20:30:00Z'));
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-1', shift: nightShift });
      // Only the 16th, the day the shift started, has a row.
      prisma.attendanceRecord.findUnique.mockImplementation(
        async ({ where }: { where: { tenantId_employeeId_date: { date: Date } } }) =>
          where.tenantId_employeeId_date.date.toISOString() === '2026-03-16T00:00:00.000Z'
            ? {
                id: 'att-1',
                status: 'PRESENT',
                sessions: [
                  { id: 'sess-1', inTime: new Date('2026-03-16T16:30:00Z'), outTime: null },
                ],
              }
            : null,
      );

      const result = await service.getTodayStatus(tenantId, employeeId);

      expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_employeeId_date: {
              tenantId,
              employeeId,
              date: new Date('2026-03-16T00:00:00Z'),
            },
          },
        }),
      );
      expect(result.clockedIn).toBe(true);
    });
  });

  // -----------------------------------------------------------
  // a same-day shift worked past midnight
  // -----------------------------------------------------------
  describe('clock-out after midnight on a day shift', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    function primeYesterdayOpen(inTime: Date) {
      const openSession = { id: 'sess-1', inTime, outTime: null };
      prisma.attendanceRecord.findUnique.mockImplementation(
        async ({ where }: { where: { tenantId_employeeId_date: { date: Date } } }) =>
          where.tenantId_employeeId_date.date.toISOString() === '2026-03-16T00:00:00.000Z'
            ? {
                id: 'att-16',
                date: new Date('2026-03-16T00:00:00Z'),
                standardWorkMinutes: 480,
                breakMinutes: 0,
                remarks: null,
                status: 'PRESENT',
                isLate: false,
                sessions: [openSession],
              }
            : null,
      );
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendanceSession.findMany.mockResolvedValue([
        { ...openSession, sessionMinutes: 0 },
      ]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'att-16', sessions: [] });
    }

    it("closes yesterday's still-open session instead of refusing", async () => {
      // 00:30 IST on the 17th, clocked in 09:00 IST on the 16th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-16T19:00:00Z'));
      primeYesterdayOpen(new Date('2026-03-16T03:30:00Z'));

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { outTime: expect.any(Date), sessionMinutes: 930 },
      });
      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'att-16' } }),
      );
    });

    it('refuses a session left open so long it is a forgotten clock-out', async () => {
      // 08:30 IST on the 17th, clocked in 09:00 IST on the 16th: 23h30 open.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T03:00:00Z'));
      primeYesterdayOpen(new Date('2026-03-16T03:30:00Z'));

      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        'No clock-in record found for today',
      );
      expect(prisma.attendanceSession.update).not.toHaveBeenCalled();
    });
  });
  // -----------------------------------------------------------
  // shift-boundary regressions from the wave-0 review
  // -----------------------------------------------------------
  describe('shift boundaries', () => {
    const mockCoords = { latitude: 12.9716, longitude: 77.5946 };
    const nightShift = {
      id: 'shift-night',
      startTime: '22:00',
      endTime: '06:00',
      graceMinutes: 0,
      isActive: true,
    };
    const dayShift = {
      id: 'shift-day',
      startTime: '09:00',
      endTime: '18:00',
      graceMinutes: 0,
      isActive: true,
    };
    const D16 = '2026-03-16T00:00:00.000Z';
    const D17 = '2026-03-17T00:00:00.000Z';

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Rows keyed by ISO date; any other day has no row. */
    function rowsByDay(rows: Record<string, Record<string, unknown>>) {
      prisma.attendanceRecord.findUnique.mockImplementation(
        async ({ where }: { where: { tenantId_employeeId_date: { date: Date } } }) =>
          rows[where.tenantId_employeeId_date.date.toISOString()] ?? null,
      );
    }

    /** Night shift up to and including the 16th, day shift from the 17th. */
    function nightThenDay() {
      prisma.shiftAssignment.findFirst.mockImplementation(
        async ({ where }: { where: { startDate: { lte: Date } } }) =>
          where.startDate.lte.toISOString() === D17
            ? { id: 'sa-day', shift: dayShift }
            : { id: 'sa-night', shift: nightShift },
      );
    }

    function row(id: string, date: string, extra: Record<string, unknown> = {}) {
      return {
        id,
        date: new Date(date),
        standardWorkMinutes: 480,
        breakMinutes: 0,
        remarks: null,
        status: 'PRESENT',
        isLate: false,
        clockInTime: new Date(date),
        preClassificationStatus: null,
        sessions: [],
        ...extra,
      };
    }

    /** `openId` is the session being closed; its minutes come from the clock. */
    function primeClockOutWrites(openId = 's17') {
      prisma.attendanceSession.update.mockResolvedValue({});
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendanceSession.findMany.mockResolvedValue([{ id: openId, sessionMinutes: 0 }]);
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'x', sessions: [] });
    }

    function primeClockInWrites() {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-new', sessions: [] });
      prisma.attendanceSession.create.mockResolvedValue({});
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'x', sessions: [] });
    }

    const closedNight16 = {
      id: 's16',
      inTime: new Date('2026-03-16T16:30:00Z'),
      outTime: new Date('2026-03-17T00:30:00Z'),
    };

    describe('an expired night assignment followed by a day shift', () => {
      it('files the 09:00 clock-in under today, on the day shift', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-17T03:30:00Z')); // 09:00 IST
        nightThenDay();
        rowsByDay({ [D16]: row('att-16', D16, { sessions: [closedNight16] }) });
        primeClockInWrites();

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
        const data = prisma.attendanceRecord.create.mock.calls[0][0].data;
        expect(data.date.toISOString()).toBe(D17);
        expect(data.shiftId).toBe('shift-day');
        expect(data.isLate).toBe(false);
      });

      it("closes today's session at lunch instead of looking at last night", async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-17T07:00:00Z')); // 12:30 IST
        nightThenDay();
        rowsByDay({
          [D16]: row('att-16', D16, { sessions: [closedNight16] }),
          [D17]: row('att-17', D17, {
            sessions: [{ id: 's17', inTime: new Date('2026-03-17T03:30:00Z'), outTime: null }],
          }),
        });
        primeClockOutWrites();

        await service.clockOut(tenantId, employeeId, {});

        expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
          where: { id: 's17' },
          data: { outTime: expect.any(Date), sessionMinutes: 210 },
        });
        expect(prisma.attendanceRecord.update.mock.calls[0][0].where).toEqual({ id: 'att-17' });
      });
    });

    it("does not score a morning punch late against tonight's night shift", async () => {
      // First night of a new assignment: nothing yesterday, nights from today.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T03:30:00Z')); // 09:00 IST
      prisma.shiftAssignment.findFirst.mockImplementation(
        async ({ where }: { where: { startDate: { lte: Date } } }) =>
          where.startDate.lte.toISOString() === D17 ? { id: 'sa-n', shift: nightShift } : null,
      );
      rowsByDay({});
      primeClockInWrites();

      await service.clockIn(tenantId, employeeId, { ...mockCoords });

      const data = prisma.attendanceRecord.create.mock.calls[0][0].data;
      expect(data.date.toISOString()).toBe(D17);
      expect(data.isLate).toBe(false);
    });

    describe('a lunch-break clock-out', () => {
      const openMorning = () =>
        rowsByDay({
          [D17]: row('att-17', D17, {
            sessions: [{ id: 's17', inTime: new Date('2026-03-17T03:30:00Z'), outTime: null }],
          }),
        });

      it('remembers the status the worked-hours rule replaced', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-17T07:00:00Z')); // 12:30 IST
        openMorning();
        primeClockOutWrites();

        await service.clockOut(tenantId, employeeId, {});

        const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
        expect(data.status).toBe('ABSENT');
        expect(data.preClassificationStatus).toBe('PRESENT');
      });

      it('does not touch the marker when the rule leaves the status alone', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-17T12:30:00Z')); // 18:00 IST
        openMorning();
        primeClockOutWrites();

        await service.clockOut(tenantId, employeeId, {});

        const data = prisma.attendanceRecord.update.mock.calls[0][0].data;
        expect(data.status).toBeUndefined();
        expect(data).not.toHaveProperty('preClassificationStatus');
      });

      const afterLunch = (extra: Record<string, unknown>) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-17T08:00:00Z')); // 13:30 IST
        rowsByDay({
          [D17]: row('att-17', D17, {
            sessions: [
              {
                id: 's17',
                inTime: new Date('2026-03-17T03:30:00Z'),
                outTime: new Date('2026-03-17T07:00:00Z'),
              },
            ],
            ...extra,
          }),
        });
        primeClockInWrites();
      };

      it('puts the day back to PRESENT when the next session starts', async () => {
        afterLunch({ status: 'ABSENT', preClassificationStatus: 'PRESENT' });

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceSession.create).toHaveBeenCalled();
        expect(prisma.attendanceRecord.update).toHaveBeenCalledWith({
          where: { id: 'att-17' },
          data: { status: 'PRESENT', preClassificationStatus: null },
        });
      });

      it('puts a work-from-home day back to WFH, not PRESENT', async () => {
        afterLunch({ status: 'HALF_DAY', preClassificationStatus: 'WFH' });

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceRecord.update).toHaveBeenCalledWith({
          where: { id: 'att-17' },
          data: { status: 'WFH', preClassificationStatus: null },
        });
      });

      it('leaves a HALF_DAY the rule did not write alone', async () => {
        afterLunch({ status: 'HALF_DAY', preClassificationStatus: null });

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      });

      it('never restores over a day that has since become LEAVE', async () => {
        afterLunch({ status: 'LEAVE', preClassificationStatus: 'PRESENT' });

        await service.clockIn(tenantId, employeeId, { ...mockCoords });

        expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      });
    });

    it('closes a 24-hour shift the next morning after its end time', async () => {
      // In 08:00 IST on the 16th, out 08:30 IST on the 17th.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T03:00:00Z'));
      const allDay = {
        id: 'shift-24',
        startTime: '08:00',
        endTime: '08:00',
        graceMinutes: 0,
        isActive: true,
      };
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-24', shift: allDay });
      rowsByDay({
        [D16]: row('att-16', D16, {
          shift: allDay,
          sessions: [{ id: 's16', inTime: new Date('2026-03-16T02:30:00Z'), outTime: null }],
        }),
      });
      primeClockOutWrites('s16');

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 's16' },
        data: { outTime: expect.any(Date), sessionMinutes: 1470 },
      });
    });

    it('refuses a duplicate clock-out rather than closing a forgotten session from yesterday', async () => {
      // 16:00 IST on the 17th: today is already clocked out; yesterday was
      // left open at 23:30 IST.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T10:30:00Z'));
      rowsByDay({
        [D16]: row('att-16', D16, {
          sessions: [{ id: 's16', inTime: new Date('2026-03-16T18:00:00Z'), outTime: null }],
        }),
        [D17]: row('att-17', D17, {
          sessions: [
            {
              id: 's17',
              inTime: new Date('2026-03-17T03:30:00Z'),
              outTime: new Date('2026-03-17T10:29:00Z'),
            },
          ],
        }),
      });
      primeClockOutWrites();

      await expect(service.clockOut(tenantId, employeeId, {})).rejects.toThrow(
        'No open session found',
      );
      expect(prisma.attendanceSession.update).not.toHaveBeenCalled();
    });

    it('shows the session a clock-out would close on the dashboard, even in overtime', async () => {
      // 08:30 IST on the 17th, still on last night's shift (in 22:00 IST).
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T03:00:00Z'));
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-n', shift: nightShift });
      rowsByDay({
        [D16]: row('att-16', D16, {
          sessions: [{ id: 's16', inTime: new Date('2026-03-16T16:30:00Z'), outTime: null }],
        }),
      });

      const result = await service.getTodayStatus(tenantId, employeeId);

      expect(result.clockedIn).toBe(true);
    });

    it("still closes last night's shift when today only holds a leave row", async () => {
      // 06:05 IST on the 17th; in at 22:00 IST on the 16th; the 17th is leave.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-17T00:35:00Z'));
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-n', shift: nightShift });
      rowsByDay({
        [D16]: row('att-16', D16, {
          sessions: [{ id: 's16', inTime: new Date('2026-03-16T16:30:00Z'), outTime: null }],
        }),
        [D17]: row('att-17', D17, { status: 'LEAVE', clockInTime: null, sessions: [] }),
      });
      primeClockOutWrites('s16');

      await service.clockOut(tenantId, employeeId, {});

      expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 's16' },
        data: { outTime: expect.any(Date), sessionMinutes: 485 },
      });
    });
  });
});
