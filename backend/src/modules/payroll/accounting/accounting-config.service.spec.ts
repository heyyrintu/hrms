import { UserRole } from '@prisma/client';
import { createMockPrismaService } from '../../../test/helpers';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AccountingConfigService } from './accounting-config.service';

describe('AccountingConfigService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let audit: { log: jest.Mock };
  let service: AccountingConfigService;

  const actor: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { log: jest.fn() };
    service = new AccountingConfigService(prisma, audit as unknown as AuditService);
  });

  describe('get', () => {
    it('returns the schema defaults when the tenant has no row', async () => {
      (prisma.payrollAccountingConfig.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.get('tenant-1');

      expect(result).toEqual({
        suspenseGlCode: null,
        suspenseGlName: null,
        costCenterMode: 'NONE',
        tallyCompanyName: null,
        tallyVoucherType: 'Journal',
        narrationTemplate: 'Salary for {{month}} {{year}}',
      });
    });

    it('returns the tenant row when one exists', async () => {
      (prisma.payrollAccountingConfig.findUnique as jest.Mock).mockResolvedValue({
        suspenseGlCode: '9999',
        suspenseGlName: 'Suspense',
        costCenterMode: 'DEPARTMENT',
        tallyCompanyName: 'Acme',
        tallyVoucherType: 'Payment',
        narrationTemplate: 'Custom',
      });

      const result = await service.get('tenant-1');
      expect(result.suspenseGlCode).toBe('9999');
      expect(result.costCenterMode).toBe('DEPARTMENT');
    });
  });

  describe('update', () => {
    it('upserts the changed fields and audit-logs the change', async () => {
      (prisma.payrollAccountingConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.payrollAccountingConfig.upsert as jest.Mock).mockResolvedValue({ id: 'config-1' });

      await service.update(actor, { costCenterMode: 'DEPARTMENT' as never });

      expect(prisma.payrollAccountingConfig.upsert).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        create: { tenantId: 'tenant-1', costCenterMode: 'DEPARTMENT' },
        update: { costCenterMode: 'DEPARTMENT' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'PayrollAccountingConfig', tenantId: 'tenant-1' }),
      );
    });

    it('clears a suspense code back to null on a blank string', async () => {
      (prisma.payrollAccountingConfig.findUnique as jest.Mock).mockResolvedValue({
        suspenseGlCode: '9999',
        suspenseGlName: 'Suspense',
        costCenterMode: 'NONE',
        tallyCompanyName: null,
        tallyVoucherType: 'Journal',
        narrationTemplate: 'Salary for {{month}} {{year}}',
      });
      (prisma.payrollAccountingConfig.upsert as jest.Mock).mockResolvedValue({ id: 'config-1' });

      await service.update(actor, { suspenseGlCode: '  ' });

      expect(prisma.payrollAccountingConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { suspenseGlCode: null } }),
      );
    });
  });
});
