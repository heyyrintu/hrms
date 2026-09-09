import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompOffService } from './comp-off.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('CompOffService', () => {
  let service: CompOffService;
  let prisma: any;

  const tenantId = 'test-tenant';
  const approverId = 'emp-manager';

  const pendingRequest = {
    id: 'co-1',
    tenantId,
    employeeId: 'emp-1',
    workedDate: new Date('2025-03-15T12:00:00Z'),
    earnedDays: 1,
    expiryDate: new Date('2999-01-01T00:00:00Z'),
    status: 'PENDING',
    employee: { id: 'emp-1', managerId: approverId, firstName: 'A', lastName: 'B' },
  };

  const alreadyProcessed = () =>
    new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: 'test',
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompOffService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get(CompOffService);
    prisma = module.get(PrismaService);
  });

  describe('approve', () => {
    it('should only transition a request that is still PENDING', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      prisma.leaveBalance.update.mockResolvedValue({});

      await service.approve(tenantId, 'co-1', approverId, 'MANAGER', {});

      expect(prisma.compOffRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'co-1', status: 'PENDING' } }),
      );
    });

    it('should refuse to credit a comp-off whose expiry has already passed', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue({
        ...pendingRequest,
        expiryDate: new Date('2025-01-01T00:00:00Z'),
      });

      await expect(
        service.approve(tenantId, 'co-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.compOffRequest.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });

    it('should transition and credit the balance inside one transaction', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      prisma.leaveBalance.update.mockResolvedValue({});

      await service.approve(tenantId, 'co-1', approverId, 'MANAGER', {});

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should propagate a balance-credit failure so the approval is rolled back', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      prisma.leaveBalance.update.mockRejectedValue(new Error('balance write failed'));

      await expect(
        service.approve(tenantId, 'co-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow('balance write failed');
    });

    it('should throw ConflictException and not credit balance when already processed concurrently', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.approve(tenantId, 'co-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow(ConflictException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('should throw ConflictException when already processed concurrently', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockRejectedValue(alreadyProcessed());

      await expect(
        service.reject(tenantId, 'co-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow(ConflictException);
    });
  });
});
