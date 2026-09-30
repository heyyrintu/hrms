import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createMockPrismaService } from '../../../test/helpers';
import { BadgesService, DEFAULT_BADGES } from './badges.service';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('BadgesService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: BadgesService;

  const tenantId = 'tenant-1';

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new BadgesService(prisma as any);
  });

  describe('list', () => {
    it('seeds the five defaults once when the tenant has no badges', async () => {
      (prisma.badge.count as jest.Mock).mockResolvedValue(0);
      (prisma.badge.createMany as jest.Mock).mockResolvedValue({ count: 5 });
      (prisma.badge.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(tenantId, false);

      expect(prisma.badge.createMany).toHaveBeenCalledWith({
        data: DEFAULT_BADGES.map((b) => ({ tenantId, ...b })),
        skipDuplicates: true,
      });
      expect(DEFAULT_BADGES).toHaveLength(5);
    });

    it('does not reseed when the tenant already has badges', async () => {
      (prisma.badge.count as jest.Mock).mockResolvedValue(3);
      (prisma.badge.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(tenantId, false);

      expect(prisma.badge.createMany).not.toHaveBeenCalled();
    });

    it('returns only active badges for a non-HR caller', async () => {
      (prisma.badge.count as jest.Mock).mockResolvedValue(1);
      (prisma.badge.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(tenantId, false);

      expect(prisma.badge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, isActive: true } }),
      );
    });

    it('includes inactive badges when asked (HR)', async () => {
      (prisma.badge.count as jest.Mock).mockResolvedValue(1);
      (prisma.badge.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(tenantId, true);

      expect(prisma.badge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });
  });

  describe('create', () => {
    it('creates a badge', async () => {
      (prisma.badge.create as jest.Mock).mockResolvedValue({ id: 'b-1', name: 'Team Player' });

      const result = await service.create(tenantId, { name: 'Team Player', icon: '🤝', points: 10 });

      expect(result).toEqual({ id: 'b-1', name: 'Team Player' });
      expect(prisma.badge.create).toHaveBeenCalledWith({
        data: { tenantId, name: 'Team Player', description: null, icon: '🤝', points: 10 },
      });
    });

    it('rejects a duplicate name with 409', async () => {
      (prisma.badge.create as jest.Mock).mockRejectedValue(uniqueViolation());

      await expect(
        service.create(tenantId, { name: 'Team Player', icon: '🤝' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('404s when the badge does not exist for this tenant', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.update(tenantId, 'missing', { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('updates only the given fields', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'b-1' });
      (prisma.badge.update as jest.Mock).mockResolvedValue({ id: 'b-1', points: 30 });

      await service.update(tenantId, 'b-1', { points: 30 });

      expect(prisma.badge.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { points: 30 },
      });
    });

    it('reactivates an inactive badge when isActive is true', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'b-1', isActive: false });
      (prisma.badge.update as jest.Mock).mockResolvedValue({ id: 'b-1', isActive: true });

      await service.update(tenantId, 'b-1', { isActive: true });

      expect(prisma.badge.findFirst).toHaveBeenCalledWith({ where: { id: 'b-1', tenantId } });
      expect(prisma.badge.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { isActive: true },
      });
    });

    it('can still deactivate via isActive false, and leaves isActive alone when omitted', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'b-1' });
      (prisma.badge.update as jest.Mock).mockResolvedValue({ id: 'b-1' });

      await service.update(tenantId, 'b-1', { isActive: false });
      expect((prisma.badge.update as jest.Mock).mock.calls[0][0].data).toEqual({ isActive: false });

      (prisma.badge.update as jest.Mock).mockClear();
      await service.update(tenantId, 'b-1', { name: 'N' });
      expect((prisma.badge.update as jest.Mock).mock.calls[0][0].data).toEqual({ name: 'N' });
    });

    it('rejects a rename onto a duplicate name with 409', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'b-1' });
      (prisma.badge.update as jest.Mock).mockRejectedValue(uniqueViolation());

      await expect(service.update(tenantId, 'b-1', { name: 'Dup' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('deactivate', () => {
    it('404s when the badge does not exist for this tenant', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deactivate(tenantId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sets isActive false', async () => {
      (prisma.badge.findFirst as jest.Mock).mockResolvedValue({ id: 'b-1' });
      (prisma.badge.update as jest.Mock).mockResolvedValue({ id: 'b-1', isActive: false });

      await service.deactivate(tenantId, 'b-1');

      expect(prisma.badge.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { isActive: false },
      });
    });
  });
});
