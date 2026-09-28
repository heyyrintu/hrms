import { createMockPrismaService } from '../../../test/helpers';
import {
  DEFAULT_ENGAGEMENT_SETTINGS,
  EngagementSettingsService,
} from './engagement-settings.service';

describe('EngagementSettingsService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: EngagementSettingsService;

  const storedRow = {
    id: 'es-1',
    tenantId: 'tenant-1',
    pointsEnabled: true,
    monthlyPointsAllowance: 250,
    showBirthdays: false,
    showAnniversaries: true,
    createdAt: new Date('2026-03-15T12:00:00Z'),
    updatedAt: new Date('2026-03-15T12:00:00Z'),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new EngagementSettingsService(prisma as any);
  });

  describe('get', () => {
    it('returns the defaults when the tenant has no settings row', async () => {
      (prisma.engagementSettings.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.get('tenant-1');

      expect(result).toEqual(DEFAULT_ENGAGEMENT_SETTINGS);
      expect(prisma.engagementSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
    });

    it('does not hand out the shared defaults object', async () => {
      (prisma.engagementSettings.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.get('tenant-1');
      result.pointsEnabled = true;

      expect(DEFAULT_ENGAGEMENT_SETTINGS.pointsEnabled).toBe(false);
    });

    it('returns the stored values, and only the four view fields', async () => {
      (prisma.engagementSettings.findUnique as jest.Mock).mockResolvedValue(storedRow);

      const result = await service.get('tenant-1');

      expect(result).toEqual({
        pointsEnabled: true,
        monthlyPointsAllowance: 250,
        showBirthdays: false,
        showAnniversaries: true,
      });
    });

    it('reads through the transaction client when one is given', async () => {
      const tx = createMockPrismaService();
      (tx.engagementSettings.findUnique as jest.Mock).mockResolvedValue(storedRow);

      const result = await service.get('tenant-1', tx as any);

      expect(result.monthlyPointsAllowance).toBe(250);
      expect(tx.engagementSettings.findUnique).toHaveBeenCalled();
      expect(prisma.engagementSettings.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('upserts by tenantId, creating from defaults plus the given fields', async () => {
      (prisma.engagementSettings.upsert as jest.Mock).mockResolvedValue({
        ...storedRow,
        pointsEnabled: true,
        monthlyPointsAllowance: 100,
        showBirthdays: true,
      });

      const result = await service.update('tenant-1', { pointsEnabled: true });

      expect(prisma.engagementSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
          create: {
            tenantId: 'tenant-1',
            ...DEFAULT_ENGAGEMENT_SETTINGS,
            pointsEnabled: true,
          },
          update: { pointsEnabled: true },
        }),
      );
      expect(result).toEqual({
        pointsEnabled: true,
        monthlyPointsAllowance: 100,
        showBirthdays: true,
        showAnniversaries: true,
      });
    });

    it('only updates the fields that were sent', async () => {
      (prisma.engagementSettings.upsert as jest.Mock).mockResolvedValue(storedRow);

      await service.update('tenant-1', {
        monthlyPointsAllowance: 250,
        showBirthdays: false,
      });

      const call = (prisma.engagementSettings.upsert as jest.Mock).mock.calls[0][0];
      expect(call.update).toEqual({ monthlyPointsAllowance: 250, showBirthdays: false });
    });
  });
});
