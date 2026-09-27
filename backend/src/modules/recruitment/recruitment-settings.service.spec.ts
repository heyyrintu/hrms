import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMockPrismaService } from '../../test/helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { RecruitmentSettingsService } from './recruitment-settings.service';
import { DEFAULT_PRE_ONBOARDING_DOCUMENTS } from './recruitment.types';

describe('RecruitmentSettingsService', () => {
  const tenantId = 'tenant-1';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: RecruitmentSettingsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    const config = { get: jest.fn().mockReturnValue('https://hrms.test') } as unknown as ConfigService;
    service = new RecruitmentSettingsService(prisma as unknown as PrismaService, config);
  });

  describe('get', () => {
    it('returns defaults with the careers URL when no row exists yet', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: tenantId, code: 'acme' });
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.get(tenantId);

      expect(result).toEqual({
        careersPageEnabled: false,
        careersIntro: null,
        offerExpiryDays: 7,
        preOnboardingExpiryDays: 14,
        preOnboardingDocuments: [...DEFAULT_PRE_ONBOARDING_DOCUMENTS],
        careersUrl: 'https://hrms.test/careers/acme',
      });
    });

    it('returns the stored row when one exists', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: tenantId, code: 'acme' });
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({
        careersPageEnabled: true,
        careersIntro: 'Join us',
        offerExpiryDays: 10,
        preOnboardingExpiryDays: 20,
        preOnboardingDocuments: [{ key: 'x', label: 'X', category: 'OTHER', required: true }],
      });

      const result = await service.get(tenantId);

      expect(result.careersPageEnabled).toBe(true);
      expect(result.careersIntro).toBe('Join us');
      expect(result.offerExpiryDays).toBe(10);
      expect(result.preOnboardingExpiryDays).toBe(20);
      expect(result.preOnboardingDocuments).toEqual([{ key: 'x', label: 'X', category: 'OTHER', required: true }]);
      expect(result.careersUrl).toBe('https://hrms.test/careers/acme');
    });

    it('throws NotFoundException for an unknown tenant', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('upserts only the supplied fields and keeps existing ones for the rest', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: tenantId, code: 'acme' });
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({
        careersPageEnabled: false,
        careersIntro: 'Old intro',
        offerExpiryDays: 7,
        preOnboardingExpiryDays: 14,
        preOnboardingDocuments: [...DEFAULT_PRE_ONBOARDING_DOCUMENTS],
      });
      (prisma.recruitmentSettings.upsert as jest.Mock).mockImplementation(({ update }: any) => ({
        careersPageEnabled: update.careersPageEnabled,
        careersIntro: update.careersIntro,
        offerExpiryDays: update.offerExpiryDays,
        preOnboardingExpiryDays: update.preOnboardingExpiryDays,
        preOnboardingDocuments: update.preOnboardingDocuments,
      }));

      const result = await service.update(tenantId, { careersPageEnabled: true });

      expect(result.careersPageEnabled).toBe(true);
      expect(result.careersIntro).toBe('Old intro');
      expect(result.offerExpiryDays).toBe(7);
      const upsertCall = (prisma.recruitmentSettings.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertCall.where).toEqual({ tenantId });
    });

    it('allows clearing careersIntro to null explicitly', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: tenantId, code: 'acme' });
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({
        careersPageEnabled: true,
        careersIntro: 'Old intro',
        offerExpiryDays: 7,
        preOnboardingExpiryDays: 14,
        preOnboardingDocuments: [...DEFAULT_PRE_ONBOARDING_DOCUMENTS],
      });
      (prisma.recruitmentSettings.upsert as jest.Mock).mockImplementation(({ update }: any) => update);

      const result = await service.update(tenantId, { careersIntro: null });
      expect(result.careersIntro).toBeNull();
    });

    it('throws NotFoundException for an unknown tenant', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.update('missing', {})).rejects.toThrow(NotFoundException);
    });
  });
});
