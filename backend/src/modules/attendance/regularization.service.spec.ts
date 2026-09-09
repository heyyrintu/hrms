import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { RegularizationService } from './regularization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('RegularizationService', () => {
  let service: RegularizationService;
  let prisma: any;

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
      ],
    }).compile();

    service = module.get(RegularizationService);
    prisma = module.get(PrismaService);
  });

  describe('approve', () => {
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
