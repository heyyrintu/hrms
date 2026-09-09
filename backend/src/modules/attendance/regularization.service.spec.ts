import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { RegularizationService } from './regularization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtCalculationService } from './ot-calculation.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('RegularizationService', () => {
  let service: RegularizationService;
  let prisma: any;
  let otCalculation: { getOtRule: jest.Mock; calculateOtMinutes: jest.Mock };

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
      ],
    }).compile();

    service = module.get(RegularizationService);
    prisma = module.get(PrismaService);
    otCalculation = module.get(OtCalculationService);
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
