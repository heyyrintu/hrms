import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendancePolicyService } from './attendance-policy.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('AttendancePolicyService', () => {
  let service: AttendancePolicyService;
  let prisma: any;

  const tenantId = 'tenant-1';

  const storedPolicy = {
    id: 'pol-1',
    tenantId,
    defaultShiftStart: '09:00',
    defaultGraceMinutes: 15,
    lateMarksPerHalfDay: null,
    autoMarkAbsent: false,
    absentIsLop: true,
    minHalfDayMinutes: 240,
    minFullDayMinutes: 480,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendancePolicyService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(AttendancePolicyService);
    prisma = module.get(PrismaService);
  });

  describe('getOrCreate', () => {
    it('returns the existing policy without writing', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);

      await expect(service.getOrCreate(tenantId)).resolves.toBe(storedPolicy);

      expect(prisma.attendancePolicy.findUnique).toHaveBeenCalledWith({
        where: { tenantId },
      });
      expect(prisma.attendancePolicy.create).not.toHaveBeenCalled();
    });

    it('creates the row with the documented defaults on first read', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(null);
      prisma.attendancePolicy.create.mockResolvedValue(storedPolicy);

      await expect(service.getOrCreate(tenantId)).resolves.toBe(storedPolicy);

      expect(prisma.attendancePolicy.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          defaultShiftStart: '09:00',
          defaultGraceMinutes: 15,
          lateMarksPerHalfDay: null,
          autoMarkAbsent: false,
          absentIsLop: true,
          minHalfDayMinutes: 240,
          minFullDayMinutes: 480,
        },
      });
    });

    it('re-reads instead of failing when another request created the row first', async () => {
      prisma.attendancePolicy.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedPolicy);
      prisma.attendancePolicy.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.getOrCreate(tenantId)).resolves.toBe(storedPolicy);
      expect(prisma.attendancePolicy.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it('creates the row first, then applies only the supplied fields', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);
      prisma.attendancePolicy.update.mockResolvedValue({
        ...storedPolicy,
        defaultGraceMinutes: 5,
      });

      const result = await service.update(tenantId, { defaultGraceMinutes: 5 });

      expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
        where: { tenantId },
        data: { defaultGraceMinutes: 5 },
      });
      expect(result.defaultGraceMinutes).toBe(5);
    });

    it('passes an explicit null through so the late-mark penalty can be switched off', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);
      prisma.attendancePolicy.update.mockResolvedValue(storedPolicy);

      await service.update(tenantId, { lateMarksPerHalfDay: null });

      expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
        where: { tenantId },
        data: { lateMarksPerHalfDay: null },
      });
    });

    it('rejects a half-day threshold above the full-day threshold', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);

      await expect(
        service.update(tenantId, { minHalfDayMinutes: 500, minFullDayMinutes: 480 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.attendancePolicy.update).not.toHaveBeenCalled();
    });

    it('checks one threshold against the stored value of the other', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);

      // Stored full day is 480.
      await expect(
        service.update(tenantId, { minHalfDayMinutes: 481 }),
      ).rejects.toThrow(BadRequestException);
      // Stored half day is 240.
      await expect(
        service.update(tenantId, { minFullDayMinutes: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows either threshold to be switched off with 0', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);
      prisma.attendancePolicy.update.mockResolvedValue(storedPolicy);

      await service.update(tenantId, { minFullDayMinutes: 0 });

      expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
        where: { tenantId },
        data: { minFullDayMinutes: 0 },
      });
    });

    it('ignores undefined fields entirely', async () => {
      prisma.attendancePolicy.findUnique.mockResolvedValue(storedPolicy);
      prisma.attendancePolicy.update.mockResolvedValue(storedPolicy);

      await service.update(tenantId, {});

      expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
        where: { tenantId },
        data: {},
      });
    });
  });
});
