import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { RegularizationService } from './regularization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtCalculationService } from './ot-calculation.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
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
  let notifications: any;
  let engine: {
    start: jest.Mock;
    notifyPending: jest.Mock;
    act: jest.Mock;
    cancel: jest.Mock;
    listActionableEntityIds: jest.Mock;
  };

  const tenantId = 'test-tenant';
  const approverId = 'emp-manager';

  const managerActor: AuthenticatedUser = {
    userId: 'user-manager',
    email: 'manager@test.com',
    tenantId,
    role: UserRole.MANAGER,
    employeeId: approverId,
  };

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
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
    };
    // Default: single-step chain, onFinal runs inside a transaction.
    engine.act.mockImplementation(async (input: any) => {
      await prisma.$transaction((tx: any) => input.onFinal?.(tx));
      return {
        outcome: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        instanceId: 'inst-1',
        nextStepOrder: null,
      };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegularizationService,
        { provide: ApprovalEngineService, useValue: engine },
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
    notifications = module.get(NotificationsService);
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
        expect(engine.start).toHaveBeenCalledWith({
          tenantId,
          entityType: 'REGULARIZATION',
          entityId: 'reg-1',
          context: { requesterEmployeeId: 'emp-1', requesterUserId: null, days: null },
          tx: prisma,
        });
        expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'REGULARIZATION', 'reg-1');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getPendingApprovals', () => {
    it('scopes non-admins to the engine\'s actionable ids', async () => {
      engine.listActionableEntityIds.mockResolvedValue(['reg-1']);
      prisma.attendanceRegularization.findMany.mockResolvedValue([]);

      await service.getPendingApprovals(managerActor);

      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(managerActor, 'REGULARIZATION');
      expect(prisma.attendanceRegularization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'PENDING', id: { in: ['reg-1'] } },
        }),
      );
    });

    it('shows SUPER_ADMIN every pending request', async () => {
      prisma.attendanceRegularization.findMany.mockResolvedValue([]);

      await service.getPendingApprovals({ ...managerActor, role: UserRole.SUPER_ADMIN });

      expect(engine.listActionableEntityIds).not.toHaveBeenCalled();
      expect(prisma.attendanceRegularization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'PENDING' } }),
      );
    });
  });

  describe('approve', () => {
    it('keeps the already-processed pre-check before the engine acts', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue({
        ...pendingRequest,
        status: 'APPROVED',
      });

      await expect(service.approve(managerActor, 'reg-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(engine.act).not.toHaveBeenCalled();
    });

    it('propagates the engine\'s 403 and rewrites nothing', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      engine.act.mockRejectedValue(new ForbiddenException('not an approver'));

      await expect(service.approve(managerActor, 'reg-1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });

    it('stays PENDING and rewrites no attendance when the chain ADVANCES', async () => {
      prisma.attendanceRegularization.findFirst
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(pendingRequest);
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });

      const result = await service.approve(managerActor, 'reg-1', {});

      expect(result.status).toBe('PENDING');
      expect(prisma.attendanceRegularization.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
      expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('rewrites the attendance record inside onFinal on the final approval', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      const tx = createMockPrismaService() as any;
      tx.attendanceRegularization.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      tx.employee.findFirst.mockResolvedValue({ id: 'emp-1', employmentType: 'PERMANENT' });
      tx.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        status: 'PRESENT',
        standardWorkMinutes: 480,
      });
      tx.attendanceRecord.update.mockResolvedValue({});
      engine.act.mockImplementation(async (input: any) => {
        await input.onFinal(tx);
        return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
      });

      const result = await service.approve(managerActor, 'reg-1', { approverNote: 'ok' });

      expect(result.status).toBe('APPROVED');
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'REGULARIZATION',
          entityId: 'reg-1',
          decision: 'APPROVE',
          note: 'ok',
        }),
      );
      expect(tx.attendanceRegularization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approverId }),
        }),
      );
      expect(tx.attendanceRecord.update).toHaveBeenCalled();
      expect(tx.attendanceSession.create).toHaveBeenCalled();
      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        'ATTENDANCE_REGULARIZATION_APPROVED',
        'Regularization Approved',
        expect.any(String),
        '/attendance/regularization',
      );
    });

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

      await service.approve(managerActor, 'reg-1', {});

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

      await service.approve(managerActor, 'reg-1', {});

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

      await service.approve(managerActor, 'reg-1', {});

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

        await service.approve(managerActor, 'reg-1', {});

        expect(policyService.getOrCreate).toHaveBeenCalledWith(tenantId);
        expect(statusWritten()).toBe('PRESENT');
      });

      // The approver's status is final: a later clock-in must not "restore"
      // whatever an earlier lunch-break clock-out downgraded.
      it('clears the worked-hours marker so a later clock-in cannot override it', async () => {
        primeApprove('2025-03-15T08:30:00Z');

        await service.approve(managerActor, 'reg-1', {});

        expect(prisma.attendanceRecord.update.mock.calls[0][0].data.preClassificationStatus).toBeNull();
      });

      it('makes regularized hours between the thresholds a HALF_DAY', async () => {
        // 03:30 -> 08:30 UTC is 300 minutes.
        primeApprove('2025-03-15T08:30:00Z');

        await service.approve(managerActor, 'reg-1', {});

        expect(statusWritten()).toBe('HALF_DAY');
      });

      it('makes regularized hours short of a half day ABSENT, on a new record too', async () => {
        // 03:30 -> 06:30 UTC is 180 minutes.
        primeApprove('2025-03-15T06:30:00Z', null);

        await service.approve(managerActor, 'reg-1', {});

        expect(statusWritten()).toBe('ABSENT');
      });

      it('keeps a full work-from-home day as WFH', async () => {
        primeApprove('2025-03-15T12:30:00Z', {
          id: 'att-1',
          status: 'WFH',
          standardWorkMinutes: 480,
        });

        await service.approve(managerActor, 'reg-1', {});

        expect(statusWritten()).toBe('WFH');
      });

      it('falls back to PRESENT when the tenant switched both thresholds off', async () => {
        policyService.getOrCreate.mockResolvedValue({
          ...ATTENDANCE_POLICY_DEFAULTS,
          minHalfDayMinutes: 0,
          minFullDayMinutes: 0,
        });
        primeApprove('2025-03-15T04:00:00Z');

        await service.approve(managerActor, 'reg-1', {});

        expect(statusWritten()).toBe('PRESENT');
      });
    });

    it('should throw ConflictException and not rewrite attendance when already processed concurrently', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.approve(managerActor, 'reg-1', {}),
      ).rejects.toThrow(ConflictException);

      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects through the engine with a null approverId for an approver without an employee', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockResolvedValue({
        ...pendingRequest,
        status: 'REJECTED',
      });

      await service.reject({ ...managerActor, employeeId: undefined }, 'reg-1', {
        approverNote: 'no',
      });

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'REGULARIZATION', decision: 'REJECT', note: 'no' }),
      );
      expect(prisma.attendanceRegularization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED', approverId: null }),
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        'ATTENDANCE_REGULARIZATION_REJECTED',
        'Regularization Rejected',
        expect.stringContaining('Note: no'),
        '/attendance/regularization',
      );
    });

    it('should throw ConflictException when already processed concurrently', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue(pendingRequest);
      prisma.attendanceRegularization.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.reject(managerActor, 'reg-1', {}),
      ).rejects.toThrow(ConflictException);
    });
  });
});
