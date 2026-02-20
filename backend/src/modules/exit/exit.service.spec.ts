import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExitService } from './exit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { createMockPrismaService, createMockEmailService } from '../../test/helpers';

describe('ExitService', () => {
  let service: ExitService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExitService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EmailService, useValue: createMockEmailService() },
      ],
    }).compile();

    service = module.get<ExitService>(ExitService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── initiate ──────────────────────────────────────────────

  describe('initiate', () => {
    const dto = {
      employeeId: 'emp-1',
      type: 'RESIGNATION' as any,
      reason: 'Better opportunity',
    };

    it('should initiate a separation', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', status: 'ACTIVE', firstName: 'John', lastName: 'Doe', email: 'john@test.com' });
      prisma.separation.findFirst.mockResolvedValue(null);
      const created = { id: 'sep-1', ...dto, status: 'INITIATED' };
      prisma.separation.create.mockResolvedValue(created);

      const result = await service.initiate('tenant-1', 'user-1', dto);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-1', tenantId: 'tenant-1', status: 'ACTIVE' },
      });
      expect(result).toEqual(created);
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.initiate('tenant-1', 'user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when active separation exists', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', status: 'ACTIVE' });
      prisma.separation.findFirst.mockResolvedValue({ id: 'existing', status: 'INITIATED' });

      await expect(service.initiate('tenant-1', 'user-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── findAll ───────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all separations for tenant', async () => {
      const separations = [{ id: 'sep-1' }, { id: 'sep-2' }];
      prisma.separation.findMany.mockResolvedValue(separations);

      const result = await service.findAll('tenant-1', {});

      expect(prisma.separation.findMany).toHaveBeenCalled();
      expect(result).toEqual(separations);
    });

    it('should filter by status', async () => {
      prisma.separation.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { status: 'INITIATED' });

      const call = prisma.separation.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('INITIATED');
    });

    it('should filter by type', async () => {
      prisma.separation.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { type: 'RESIGNATION' });

      const call = prisma.separation.findMany.mock.calls[0][0];
      expect(call.where.type).toBe('RESIGNATION');
    });
  });

  // ── findOne ───────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a separation by id', async () => {
      const sep = { id: 'sep-1', tenantId: 'tenant-1' };
      prisma.separation.findFirst.mockResolvedValue(sep);

      const result = await service.findOne('tenant-1', 'sep-1');

      expect(result).toEqual(sep);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.separation.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'none')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ────────────────────────────────────────────────

  describe('update', () => {
    it('should update a separation', async () => {
      const existing = { id: 'sep-1', status: 'INITIATED' };
      prisma.separation.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, reason: 'Updated reason' };
      prisma.separation.update.mockResolvedValue(updated);

      const result = await service.update('tenant-1', 'sep-1', { reason: 'Updated reason' });

      expect(prisma.separation.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('should throw BadRequestException for completed separations', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      await expect(
        service.update('tenant-1', 'sep-1', { reason: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── moveToNoticePeriod ────────────────────────────────────

  describe('moveToNoticePeriod', () => {
    it('should move INITIATED separation to NOTICE_PERIOD', async () => {
      const sep = { id: 'sep-1', status: 'INITIATED' };
      prisma.separation.findFirst.mockResolvedValue(sep);
      prisma.separation.update.mockResolvedValue({ ...sep, status: 'NOTICE_PERIOD' });

      const result = await service.moveToNoticePeriod('tenant-1', 'sep-1');

      expect(prisma.separation.update).toHaveBeenCalledWith({
        where: { id: 'sep-1' },
        data: { status: 'NOTICE_PERIOD' },
        include: expect.any(Object),
      });
      expect(result.status).toBe('NOTICE_PERIOD');
    });

    it('should throw BadRequestException if not in INITIATED status', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'CLEARANCE_PENDING' });

      await expect(service.moveToNoticePeriod('tenant-1', 'sep-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── moveToClearance ───────────────────────────────────────

  describe('moveToClearance', () => {
    it('should move NOTICE_PERIOD to CLEARANCE_PENDING', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'NOTICE_PERIOD' });
      prisma.separation.update.mockResolvedValue({ id: 'sep-1', status: 'CLEARANCE_PENDING' });

      const result = await service.moveToClearance('tenant-1', 'sep-1');

      expect(result.status).toBe('CLEARANCE_PENDING');
    });

    it('should move INITIATED to CLEARANCE_PENDING', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'INITIATED' });
      prisma.separation.update.mockResolvedValue({ id: 'sep-1', status: 'CLEARANCE_PENDING' });

      const result = await service.moveToClearance('tenant-1', 'sep-1');

      expect(result.status).toBe('CLEARANCE_PENDING');
    });

    it('should throw BadRequestException from COMPLETED status', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      await expect(service.moveToClearance('tenant-1', 'sep-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── complete ──────────────────────────────────────────────

  describe('complete', () => {
    it('should mark employee inactive and complete separation', async () => {
      prisma.separation.findFirst.mockResolvedValue({
        id: 'sep-1',
        status: 'CLEARANCE_PENDING',
        employeeId: 'emp-1',
        lastWorkingDate: new Date('2025-06-30T12:00:00Z'),
      });
      prisma.employee.update.mockResolvedValue({});
      prisma.separation.update.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      const result = await service.complete('tenant-1', 'sep-1');

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: {
          status: 'INACTIVE',
          exitDate: new Date('2025-06-30T12:00:00Z'),
        },
      });
      expect(result.status).toBe('COMPLETED');
    });

    it('should throw BadRequestException for already completed separation', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      await expect(service.complete('tenant-1', 'sep-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for cancelled separation', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'CANCELLED' });

      await expect(service.complete('tenant-1', 'sep-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── cancel ────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel an active separation', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'INITIATED' });
      prisma.separation.update.mockResolvedValue({ id: 'sep-1', status: 'CANCELLED' });

      const result = await service.cancel('tenant-1', 'sep-1');

      expect(result.status).toBe('CANCELLED');
    });

    it('should throw BadRequestException for completed separation', async () => {
      prisma.separation.findFirst.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      await expect(service.cancel('tenant-1', 'sep-1')).rejects.toThrow(BadRequestException);
    });
  });
});
