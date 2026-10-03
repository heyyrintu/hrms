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

    it('reads through the transaction client when one is given, not the module prisma', async () => {
      const tx = {
        attendancePolicy: {
          findUnique: jest.fn().mockResolvedValue(storedPolicy),
          create: jest.fn(),
        },
      } as any;

      await expect(service.getOrCreate(tenantId, tx)).resolves.toBe(storedPolicy);

      expect(tx.attendancePolicy.findUnique).toHaveBeenCalledWith({ where: { tenantId } });
      expect(prisma.attendancePolicy.findUnique).not.toHaveBeenCalled();
    });

    it('creates through the transaction client when one is given', async () => {
      const tx = {
        attendancePolicy: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(storedPolicy),
        },
      } as any;

      await expect(service.getOrCreate(tenantId, tx)).resolves.toBe(storedPolicy);

      expect(tx.attendancePolicy.create).toHaveBeenCalledWith({
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
      expect(prisma.attendancePolicy.create).not.toHaveBeenCalled();
    });

    it('re-reads through the transaction client on a race, not the module prisma', async () => {
      const tx = {
        attendancePolicy: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(storedPolicy),
          create: jest.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('unique', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          ),
        },
      } as any;

      await expect(service.getOrCreate(tenantId, tx)).resolves.toBe(storedPolicy);
      expect(tx.attendancePolicy.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.attendancePolicy.findUnique).not.toHaveBeenCalled();
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

    describe('capture policy', () => {
      const withCapture = (over: Record<string, unknown> = {}) => ({
        ...storedPolicy,
        ipRestrictionEnabled: false,
        allowedIpRanges: [],
        selfieRequired: false,
        ...over,
      });
      beforeEach(() => {
        prisma.attendancePolicy.findUnique.mockResolvedValue(withCapture());
        prisma.attendancePolicy.update.mockResolvedValue(storedPolicy);
      });

      it('rejects an invalid range, naming it', async () => {
        await expect(
          service.update(tenantId, { allowedIpRanges: ['10.0.0.0/8', '300.1.1.1'] }),
        ).rejects.toThrow(/300\.1\.1\.1/);
        expect(prisma.attendancePolicy.update).not.toHaveBeenCalled();
      });

      it('rejects enabling restriction with an empty list', async () => {
        await expect(
          service.update(tenantId, { ipRestrictionEnabled: true }),
        ).rejects.toThrow('Add at least one allowed IP range before enabling IP restriction');
        expect(prisma.attendancePolicy.update).not.toHaveBeenCalled();
      });

      it('enables restriction together with a list', async () => {
        await service.update(tenantId, {
          ipRestrictionEnabled: true,
          allowedIpRanges: ['10.0.0.0/8'],
        });
        expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
          where: { tenantId },
          data: { ipRestrictionEnabled: true, allowedIpRanges: ['10.0.0.0/8'] },
        });
      });

      it('rejects clearing the list while restriction stays enabled', async () => {
        prisma.attendancePolicy.findUnique.mockResolvedValue(
          withCapture({ ipRestrictionEnabled: true, allowedIpRanges: ['10.0.0.0/8'] }),
        );
        await expect(
          service.update(tenantId, { allowedIpRanges: [] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('allows disabling while clearing the list', async () => {
        prisma.attendancePolicy.findUnique.mockResolvedValue(
          withCapture({ ipRestrictionEnabled: true, allowedIpRanges: ['10.0.0.0/8'] }),
        );
        await service.update(tenantId, {
          ipRestrictionEnabled: false,
          allowedIpRanges: [],
        });
        expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
          where: { tenantId },
          data: { ipRestrictionEnabled: false, allowedIpRanges: [] },
        });
      });

      it('trims and de-duplicates ranges', async () => {
        await service.update(tenantId, {
          allowedIpRanges: [' 10.0.0.0/8 ', '10.0.0.0/8', '192.168.1.10'],
        });
        expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
          where: { tenantId },
          data: { allowedIpRanges: ['10.0.0.0/8', '192.168.1.10'] },
        });
      });

      it('stores selfieRequired', async () => {
        await service.update(tenantId, { selfieRequired: true });
        expect(prisma.attendancePolicy.update).toHaveBeenCalledWith({
          where: { tenantId },
          data: { selfieRequired: true },
        });
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
