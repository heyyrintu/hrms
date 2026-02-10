import { Test, TestingModule } from '@nestjs/testing';
import { AuditService, CreateAuditLogInput } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================
  // log()
  // ============================
  describe('log', () => {
    it('should create an audit log entry', async () => {
      const input: CreateAuditLogInput = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'CREATE' as any,
        entityType: 'Employee',
        entityId: 'emp-1',
        oldValues: undefined,
        newValues: { firstName: 'John' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      const created = { id: 'log-1', ...input, createdAt: new Date() };
      prisma.auditLog.create.mockResolvedValue(created);

      const result = await service.log(input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'CREATE',
          entityType: 'Employee',
          entityId: 'emp-1',
          oldValues: undefined,
          newValues: { firstName: 'John' },
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      });
      expect(result).toEqual(created);
    });

    it('should handle minimal input (only required fields)', async () => {
      const input: CreateAuditLogInput = {
        tenantId: 'tenant-1',
        action: 'LOGIN' as any,
        entityType: 'User',
      };

      prisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

      await service.log(input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          userId: undefined,
          action: 'LOGIN',
          entityType: 'User',
          entityId: undefined,
          oldValues: undefined,
          newValues: undefined,
          ipAddress: undefined,
          userAgent: undefined,
        },
      });
    });
  });

  // ============================
  // getLogs()
  // ============================
  describe('getLogs', () => {
    it('should return paginated logs with defaults', async () => {
      const logs = [{ id: 'log-1' }];
      prisma.auditLog.findMany.mockResolvedValue(logs);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getLogs('tenant-1', {});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
      });
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(result).toEqual({
        data: logs,
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });
    });

    it('should filter by action', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.getLogs('tenant-1', { action: 'CREATE' as any });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', action: 'CREATE' },
        }),
      );
    });

    it('should filter by entityType and entityId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.getLogs('tenant-1', {
        entityType: 'Employee',
        entityId: 'emp-1',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            entityType: 'Employee',
            entityId: 'emp-1',
          },
        }),
      );
    });

    it('should filter by userId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.getLogs('tenant-1', { userId: 'user-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', userId: 'user-1' },
        }),
      );
    });

    it('should filter by date range', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.getLogs('tenant-1', {
        from: '2024-01-01',
        to: '2024-01-31',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            createdAt: {
              gte: new Date('2024-01-01'),
              lte: new Date('2024-01-31'),
            },
          },
        }),
      );
    });

    it('should filter by from date only', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.getLogs('tenant-1', { from: '2024-01-01' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            createdAt: { gte: new Date('2024-01-01') },
          },
        }),
      );
    });

    it('should use custom pagination', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(100);

      const result = await service.getLogs('tenant-1', { page: '3', limit: '10' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        total: 100,
        page: 3,
        limit: 10,
        totalPages: 10,
      });
    });
  });

  // ============================
  // getEntityHistory()
  // ============================
  describe('getEntityHistory', () => {
    it('should return logs for a specific entity', async () => {
      const logs = [
        { id: 'log-1', action: 'CREATE' },
        { id: 'log-2', action: 'UPDATE' },
      ];
      prisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await service.getEntityHistory('tenant-1', 'Employee', 'emp-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          entityType: 'Employee',
          entityId: 'emp-1',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(logs);
    });

    it('should return empty array when no history found', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.getEntityHistory('tenant-1', 'Employee', 'unknown');

      expect(result).toEqual([]);
    });
  });
});
