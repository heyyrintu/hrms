import { Test, TestingModule } from '@nestjs/testing';
import { PayrollSettingsService } from './payroll-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('PayrollSettingsService', () => {
  let service: PayrollSettingsService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollSettingsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();
    service = module.get(PayrollSettingsService);
    prisma = module.get(PrismaService);
  });

  describe('get', () => {
    it('returns the defaults when the tenant has no row, without creating one', async () => {
      prisma.payrollSettings.findUnique.mockResolvedValue(null);

      await expect(service.get(tenantId)).resolves.toEqual({
        reimburseExpensesViaPayroll: false,
        autoArrears: true,
      });
      expect(prisma.payrollSettings.findUnique).toHaveBeenCalledWith({ where: { tenantId } });
      expect(prisma.payrollSettings.create).not.toHaveBeenCalled();
      expect(prisma.payrollSettings.upsert).not.toHaveBeenCalled();
    });

    it('returns the stored switches only', async () => {
      prisma.payrollSettings.findUnique.mockResolvedValue({
        id: 's-1',
        tenantId,
        reimburseExpensesViaPayroll: true,
        autoArrears: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.get(tenantId)).resolves.toEqual({
        reimburseExpensesViaPayroll: true,
        autoArrears: false,
      });
    });

    it('can read inside a transaction', async () => {
      const tx = { payrollSettings: { findUnique: jest.fn().mockResolvedValue(null) } };
      await service.get(tenantId, tx as any);
      expect(tx.payrollSettings.findUnique).toHaveBeenCalled();
      expect(prisma.payrollSettings.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('upserts only the fields given, creating the row with defaults for the rest', async () => {
      prisma.payrollSettings.upsert.mockResolvedValue({
        reimburseExpensesViaPayroll: true,
        autoArrears: true,
      });

      const result = await service.update(tenantId, { reimburseExpensesViaPayroll: true });

      expect(prisma.payrollSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId },
        update: { reimburseExpensesViaPayroll: true },
        create: { tenantId, reimburseExpensesViaPayroll: true },
      });
      expect(result).toEqual({ reimburseExpensesViaPayroll: true, autoArrears: true });
    });

    it('ignores anything that is not one of the two switches', async () => {
      prisma.payrollSettings.upsert.mockResolvedValue({
        reimburseExpensesViaPayroll: false,
        autoArrears: false,
      });

      await service.update(tenantId, { autoArrears: false, tenantId: 'other' } as any);

      expect(prisma.payrollSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId },
        update: { autoArrears: false },
        create: { tenantId, autoArrears: false },
      });
    });
  });
});
