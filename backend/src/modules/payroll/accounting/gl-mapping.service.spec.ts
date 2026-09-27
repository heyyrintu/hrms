import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createMockPrismaService } from '../../../test/helpers';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { GlMappingService } from './gl-mapping.service';

describe('GlMappingService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let audit: { log: jest.Mock };
  let service: GlMappingService;

  const actor: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { log: jest.fn() };
    service = new GlMappingService(prisma, audit as unknown as AuditService);
  });

  describe('getMappings', () => {
    it('lists system keys as known keys, flagging which are mapped', async () => {
      (prisma.payrollGlMapping.findMany as jest.Mock).mockResolvedValue([
        { componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' },
      ]);
      (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payrollOneTimePayment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMappings('tenant-1');

      expect(result.mappings).toEqual([{ componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }]);
      const basic = result.knownKeys.find((k) => k.key === 'BASIC');
      expect(basic?.mapped).toBe(true);
      expect(basic?.isSystem).toBe(true);
      const netPay = result.knownKeys.find((k) => k.key === 'NET_PAY');
      expect(netPay?.mapped).toBe(false);
    });

    it('adds component names from active salary structures, not duplicating system keys', async () => {
      (prisma.payrollGlMapping.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([
        { components: [{ name: 'HRA', type: 'earning' }, { name: 'BASIC', type: 'earning' }] },
      ]);
      (prisma.payrollOneTimePayment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMappings('tenant-1');

      const hra = result.knownKeys.find((k) => k.key === 'HRA');
      expect(hra).toMatchObject({ category: 'EARNING', side: 'DEBIT', isSystem: false, mapped: false });
      // BASIC stays the one system-key entry, not duplicated by the structure component of the same name.
      expect(result.knownKeys.filter((k) => k.key === 'BASIC')).toHaveLength(1);
    });

    it('adds distinct one-time payment names from the last 12 months', async () => {
      (prisma.payrollGlMapping.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payrollOneTimePayment.findMany as jest.Mock).mockResolvedValue([
        { name: 'Diwali bonus', kind: 'BONUS' },
        { name: 'Notice recovery', kind: 'RECOVERY' },
      ]);

      const result = await service.getMappings('tenant-1');

      expect(result.knownKeys.find((k) => k.key === 'Diwali bonus')).toMatchObject({ category: 'EARNING' });
      expect(result.knownKeys.find((k) => k.key === 'Notice recovery')).toMatchObject({ category: 'DEDUCTION' });
    });
  });

  describe('replaceMappings', () => {
    it('rejects a duplicate component key', async () => {
      await expect(
        service.replaceMappings(actor, [
          { componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' },
          { componentKey: 'BASIC', glCode: '4002', glName: 'Other' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a blank code or name', async () => {
      await expect(
        service.replaceMappings(actor, [{ componentKey: 'BASIC', glCode: '  ', glName: 'Salaries' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces the whole set in a transaction and audit-logs it', async () => {
      (prisma.payrollGlMapping.findMany as jest.Mock)
        .mockResolvedValueOnce([{ componentKey: 'OLD', glCode: '1', glName: 'Old' }]) // "before" snapshot
        .mockResolvedValueOnce([{ componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }]) // getMappings after
        .mockResolvedValue([]);
      (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payrollOneTimePayment.findMany as jest.Mock).mockResolvedValue([]);

      await service.replaceMappings(actor, [{ componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }]);

      expect(prisma.payrollGlMapping.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
      expect(prisma.payrollGlMapping.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }],
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'PayrollGlMapping', tenantId: 'tenant-1' }),
        prisma,
      );
    });
  });
});
