import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createMockPrismaService } from '../../../test/helpers';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AccountingConfigService } from './accounting-config.service';
import { GlMappingService } from './gl-mapping.service';
import { AccountingExportService } from './accounting-export.service';

describe('AccountingExportService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let audit: { log: jest.Mock };
  let config: { get: jest.Mock };
  let mappings: { getMappings: jest.Mock };
  let service: AccountingExportService;

  const actor: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  const basePayslip = {
    employeeId: 'emp-1',
    basePay: 50000,
    otPay: 0,
    earnings: [],
    deductions: [],
    netPay: 48200,
    pfEmployee: 1800,
    esiEmployee: 0,
    professionalTax: 0,
    lwfEmployee: 0,
    tds: 0,
    pfEmployer: 0,
    epsEmployer: 0,
    edliEmployer: 0,
    pfAdminEmployer: 0,
    esiEmployer: 0,
    lwfEmployer: 0,
    employee: { department: { name: 'Engineering' }, branch: null },
  };

  const goodMappings = {
    mappings: [
      { componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' },
      { componentKey: 'PF_EMPLOYEE', glCode: '2001', glName: 'PF payable' },
      { componentKey: 'NET_PAY', glCode: '2002', glName: 'Salaries payable' },
    ],
    knownKeys: [],
  };

  const defaultConfig = {
    suspenseGlCode: null,
    suspenseGlName: null,
    costCenterMode: 'NONE' as const,
    tallyCompanyName: null,
    tallyVoucherType: 'Journal',
    narrationTemplate: 'Salary for {{month}} {{year}}',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { log: jest.fn() };
    config = { get: jest.fn().mockResolvedValue(defaultConfig) };
    mappings = { getMappings: jest.fn().mockResolvedValue(goodMappings) };
    service = new AccountingExportService(
      prisma,
      audit as unknown as AuditService,
      config as unknown as AccountingConfigService,
      mappings as unknown as GlMappingService,
    );
  });

  const mockRun = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    tenantId: 'tenant-1',
    month: 9,
    year: 2026,
    runType: 'REGULAR',
    sequence: 0,
    status: 'APPROVED',
    ...overrides,
  });

  describe('preview', () => {
    it('throws 404 when the run does not exist for this tenant', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.preview('tenant-1', 'run-1', false)).rejects.toThrow(NotFoundException);
    });

    it('refuses a DRAFT run', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'DRAFT' }));
      await expect(service.preview('tenant-1', 'run-1', false)).rejects.toThrow(BadRequestException);
    });

    it('builds a balanced preview and marks a COMPUTED run as not exportable', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'COMPUTED' }));
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.preview('tenant-1', 'run-1', false);

      expect(result.balanced).toBe(true);
      expect(result.exportable).toBe(false);
      expect(result.voucherDate).toBe('2026-09-30');
      expect(result.narration).toBe('Salary for September 2026');
    });

    it('marks an APPROVED run as exportable', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'APPROVED' }));
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.preview('tenant-1', 'run-1', false);
      expect(result.exportable).toBe(true);
    });

    it('throws 400 when the journal does not balance', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'APPROVED' }));
      // netPay left out of the mapping set on purpose is fine (still balances via drop);
      // force an imbalance instead by giving an employer contribution with no payable line.
      mappings.getMappings.mockResolvedValue({
        mappings: [
          { componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' },
          { componentKey: 'PF_EMPLOYEE', glCode: '2001', glName: 'PF payable' },
          { componentKey: 'NET_PAY', glCode: '2002', glName: 'Salaries payable' },
          { componentKey: 'PF_EMPLOYER', glCode: '5001', glName: 'PF employer expense' },
          // PF_EMPLOYER_PAYABLE deliberately left unmapped, and unmapped is not allowed.
        ],
        knownKeys: [],
      });
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([{ ...basePayslip, pfEmployer: 1800 }]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.preview('tenant-1', 'run-1', false)).rejects.toThrow(
        /Journal does not balance/,
      );
    });
  });

  describe('export', () => {
    it('refuses to export a COMPUTED run', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'COMPUTED' }));
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.export(actor, 'run-1', 'csv', false)).rejects.toThrow(BadRequestException);
    });

    it('refuses to export with unmapped keys unless allowUnmapped is set', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'APPROVED' }));
      mappings.getMappings.mockResolvedValue({ mappings: [], knownKeys: [] });
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.export(actor, 'run-1', 'csv', false)).rejects.toThrow(BadRequestException);
    });

    it('exports a CSV file, names it by month, and audit-logs the export', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(mockRun({ status: 'APPROVED' }));
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      const file = await service.export(actor, 'run-1', 'csv', false);

      expect(file.filename).toBe('journal-2026-09.csv');
      expect(file.contentType).toBe('text/csv');
      expect(file.content).toContain('Voucher Date,Voucher No,GL Code,GL Name,Cost Centre,Debit,Credit,Narration');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'PayrollAccountingExport', entityId: 'run-1' }),
      );
    });

    it('adds an -oc<n> suffix to the filename for an off-cycle run', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(
        mockRun({ status: 'APPROVED', runType: 'OFF_CYCLE', sequence: 2 }),
      );
      (prisma.payslip.findMany as jest.Mock).mockResolvedValue([basePayslip]);
      (prisma.salaryHold.findMany as jest.Mock).mockResolvedValue([]);

      const file = await service.export(actor, 'run-1', 'tally', false);
      expect(file.filename).toBe('journal-2026-09-oc2.xml');
      expect(file.contentType).toBe('application/xml');
    });
  });
});
