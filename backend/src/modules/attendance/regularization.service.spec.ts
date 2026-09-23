import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { RegularizationService } from './regularization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtCalculationService } from './ot-calculation.service';
import {
  AttendancePolicyService,
  ATTENDANCE_POLICY_DEFAULTS,
} from './policy/attendance-policy.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('RegularizationService', () => {
  let service: RegularizationService;
  let prisma: any;
  let otCalculation: { getOtRule: jest.Mock; calculateOtMinutes: jest.Mock };
  let policyService: { getOrCreate: jest.Mock };

  const tenantId = 'test-tenant';
  const approverId = 'emp-manager';

  const pendingRequest = {
    id: 'reg-1',
    tenantId,
    employeeId: 'emp-1',
    date: new Date('2025-03-15T00:00:00Z'),
    requestedClockIn: new Date('2025-03-15T03:30:00Z'),
    requestedClockOut: new Date('2025-03-15T12:30:00Z'),
    reason: 'Forgot to punch',
    status: 'PENDING',
    employee: { id: 'emp-1', firstName: 'A', lastName: 'B', managerId: approverId },
  };

  const alreadyProcessed = () =>
    new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: 'test',
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegularizationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        {
          provide: OtCalculationService,
          useValue: {
            getOtRule: jest.fn().mockResolvedValue({ id: 'ot-1' }),
            calculateOtMinutes: jest.fn().mockReturnValue(60),
          },
        },
        {
          provide: AttendancePolicyService,
          useValue: {
            getOrCreate: jest
              .fn()
              .mockResolvedValue({ id: 'pol-1', tenantId, ...ATTENDANCE_POLICY_DEFAULTS }),
          },
        },
      ],
    }).compile();

    service = module.get(RegularizationService);
    prisma = module.get(PrismaService);
    otCalculation = module.get(OtCalculationService);
    policyService = module.get(AttendancePolicyService);
  });

  // `AttendanceRecord.date` is `@db.Date`, and the clock-in path and the
  // auto-absent sweep both key on the UTC midnight of the IST calendar day. A
  // request reconstructed from server-local parts would point at a different
  // row on a non-UTC box.
  describe('create', () => {
    it('keys the request on the UTC-midnight IST calendar day', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-12-31T21:30:00Z'));
      try {
        prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', managerId: approverId });
        prisma.attendanceRegularization.findUnique.mockResolvedValue(null);
        prisma.attendanceRegularization.create.mockResolvedValue({ id: 'reg-1' });

        await service.create(tenantId, 'emp-1', {
          date: '2026-03-16',
          requestedClockIn: '2026-03-16T03:30:00Z',
          requestedClockOut: '2026-03-16T12:30:00Z',
          reason: 'Forgot to punch',
        } as any);

        const expected = new Date('2026-03-16T00:00:00.000Z');
        expect(prisma.attendanceRegularization.findUnique).toHaveBeenCalledWith({
          where: {
            tenantId_employeeId_date: { tenantId, employeeId: 'emp-1', date: expected },
          },
        });
        expect(prisma.attendanceRegularization.create.mock.calls[0][0].data.date).toEqual(
          expected,
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('approve', () => {
    it('should recompute overtime from the regularized hours rather than leaving the old value', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', employmentType: 'PERMANENT' });
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        otMinutesCalculated: 0,
        standardWorkMinutes: 480,
      });
      prisma.attendanceRecord.update.mockResolvedValue({});

      await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

      // 03:30 to 12:30 is 540 minutes worked against a 480-minute standard.
      expect(otCalculation.calculateOtMinutes).toHaveBeenCalledWith(540, 480, expect.anything());
      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workedMinutes: 540, otMinutesCalculated: 60 }),
        }),
      );
    });

    it('should replace the day sessions so they match the regularized clock times', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', employmentType: 'PERMANENT' });
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        otMinutesCalculated: 0,
        standardWorkMinutes: 480,
      });
      prisma.attendanceRecord.update.mockResolvedValue({});
      prisma.attendanceSession.deleteMany.mockResolvedValue({ count: 2 });
      prisma.attendanceSession.create.mockResolvedValue({});

      await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

      expect(prisma.attendanceSession.deleteMany).toHaveBeenCalledWith({
        where: { attendanceId: 'att-1' },
      });
      expect(prisma.attendanceSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attendanceId: 'att-1' }),
      });
    });

    it('should only transition a request that is still PENDING', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockResolvedValue({});

      await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

      expect(prisma.attendanceRegularization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'reg-1', status: 'PENDING' } }),
      );
    });

    describe('worked-hours classification', () => {
      function primeApprove(
        requestedClockOut: string,
        existing: Record<string, unknown> | null = {
          id: 'att-1',
          status: 'PRESENT',
          standardWorkMinutes: 480,
        },
      ) {
        prisma.attendanceRegularization.findFirst.mockResolvedValue({
          ...pendingRequest,
          requestedClockOut: new Date(requestedClockOut),
        });
        prisma.attendanceRegularization.update.mockResolvedValue({
          ...pendingRequest,
          status: 'APPROVED',
        });
        prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', employmentType: 'PERMANENT' });
        prisma.attendanceRecord.findUnique.mockResolvedValue(existing);
        prisma.attendanceRecord.update.mockResolvedValue({});
        prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-new' });
      }

      const statusWritten = () =>
        (prisma.attendanceRecord.update.mock.calls[0] ??
          prisma.attendanceRecord.create.mock.calls[0])[0].data.status;

      it('keeps a regularized full day PRESENT', async () => {
        // 03:30 -> 12:30 UTC is 540 minutes.
        primeApprove('2025-03-15T12:30:00Z');

        await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

        expect(policyService.getOrCreate).toHaveBeenCalledWith(tenantId);
        expect(statusWritten()).toBe('PRESENT');
      });

      it('makes regularized hours between the thresholds a HALF_DAY', async () => {
        // 03:30 -> 08:30 UTC is 300 minutes.
        primeApprove('2025-03-15T08:30:00Z');

        await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

        expect(statusWritten()).toBe('HALF_DAY');
      });

      it('makes regularized hours short of a half day ABSENT, on a new record too', async () => {
        // 03:30 -> 06:30 UTC is 180 minutes.
        primeApprove('2025-03-15T06:30:00Z', null);

        await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

        expect(statusWritten()).toBe('ABSENT');
      });

      it('keeps a full work-from-home day as WFH', async () => {
        primeApprove('2025-03-15T12:30:00Z', {
          id: 'att-1',
          status: 'WFH',
          standardWorkMinutes: 480,
        });

        await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

        expect(statusWritten()).toBe('WFH');
      });

      it('falls back to PRESENT when the tenant switched both thresholds off', async () => {
        policyService.getOrCreate.mockResolvedValue({
          ...ATTENDANCE_POLICY_DEFAULTS,
          minHalfDayMinutes: 0,
          minFullDayMinutes: 0,
        });
        primeApprove('2025-03-15T04:00:00Z');

        await service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {});

        expect(statusWritten()).toBe('PRESENT');
      });
    });

    it('should throw ConflictException and not rewrite attendance when already processed concurrently', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.approve(tenantId, 'reg-1', approverId, UserRole.MANAGER, {}),
      ).rejects.toThrow(ConflictException);

      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('should throw ConflictException when already processed concurrently', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.reject(tenantId, 'reg-1', approverId, UserRole.MANAGER, {}),
      ).rejects.toThrow(ConflictException);
    });
  });
});
