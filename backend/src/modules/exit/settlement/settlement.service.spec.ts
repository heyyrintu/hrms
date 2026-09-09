import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

// The gratuity calculator is owned by another module and has its own tests.
// Mocking it keeps the arithmetic under test here to the settlement's own
// figures, and lets these tests run whatever that calculator currently does.
jest.mock(
  '../gratuity/gratuity.calculator',
  () => ({ calculateGratuity: jest.fn() }),
  { virtual: true },
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { calculateGratuity } from '../gratuity/gratuity.calculator';

const mockCalculateGratuity = calculateGratuity as jest.MockedFunction<
  typeof calculateGratuity
>;

/**
 * Fixtures are built so every expected figure below can be checked by hand.
 *
 *   basePay                50,000
 *   HRA (40% of basePay)   20,000
 *   DA (fixed, pfApplicable) 10,000
 *   Conveyance (fixed)      2,000
 *   -----------------------------
 *   monthly gross          82,000
 *   basic + DA (PF wages)  60,000
 */
const TENANT = 'tenant-1';
const LAST_WORKING_DATE = new Date('2025-03-15T12:00:00Z');
const INITIATED_DATE = new Date('2025-02-20T12:00:00Z');
const JOIN_DATE = new Date('2018-04-01T12:00:00Z');

function makeSeparation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sep-1',
    tenantId: TENANT,
    employeeId: 'emp-1',
    type: 'RESIGNATION',
    status: 'CLEARANCE_PENDING',
    initiatedDate: INITIATED_DATE,
    lastWorkingDate: LAST_WORKING_DATE,
    noticePeriodDays: 30,
    isNoticePeriodWaived: false,
    employee: {
      id: 'emp-1',
      firstName: 'Asha',
      lastName: 'Rao',
      employeeCode: 'E-001',
      email: 'asha@example.com',
      designation: 'Engineer',
      department: { name: 'Engineering' },
      joinDate: JOIN_DATE,
    },
    ...overrides,
  };
}

function makeSalary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sal-1',
    tenantId: TENANT,
    employeeId: 'emp-1',
    basePay: new Decimal(50000),
    isActive: true,
    salaryStructure: {
      id: 'ss-1',
      components: [
        { name: 'HRA', type: 'earning', calcType: 'percentage', value: 40 },
        {
          name: 'Dearness Allowance',
          type: 'earning',
          calcType: 'fixed',
          value: 10000,
          pfApplicable: true,
        },
        { name: 'Conveyance', type: 'earning', calcType: 'fixed', value: 2000 },
        { name: 'Society Dues', type: 'deduction', calcType: 'fixed', value: 500 },
      ],
    },
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    tenantId: TENANT,
    gratuityEnabled: true,
    gratuityDaysPerYear: new Decimal(15),
    gratuityMonthDays: new Decimal(26),
    gratuityMinYears: new Decimal(5),
    gratuityExemptionCap: new Decimal(2000000),
    leaveEncashmentEnabled: true,
    encashmentMonthDays: new Decimal(30),
    ...overrides,
  };
}

/**
 * Earned leave carries 12 encashable days; the sick leave row is overdrawn and
 * must floor at zero rather than subtract from the earned leave; the loss-of-pay
 * type is unpaid and must be excluded entirely.
 */
function makeBalances() {
  return [
    {
      id: 'bal-1',
      leaveTypeId: 'lt-el',
      totalDays: new Decimal(12),
      carriedOver: new Decimal(5),
      usedDays: new Decimal(4),
      pendingDays: new Decimal(1),
      leaveType: { id: 'lt-el', name: 'Earned Leave', code: 'EL', isPaid: true },
    },
    {
      id: 'bal-2',
      leaveTypeId: 'lt-sl',
      totalDays: new Decimal(6),
      carriedOver: new Decimal(0),
      usedDays: new Decimal(8),
      pendingDays: new Decimal(0),
      leaveType: { id: 'lt-sl', name: 'Sick Leave', code: 'SL', isPaid: true },
    },
    {
      id: 'bal-3',
      leaveTypeId: 'lt-lop',
      totalDays: new Decimal(30),
      carriedOver: new Decimal(0),
      usedDays: new Decimal(0),
      pendingDays: new Decimal(0),
      leaveType: { id: 'lt-lop', name: 'Loss of Pay', code: 'LOP', isPaid: false },
    },
  ];
}

const GRATUITY_RESULT = {
  eligible: true,
  ineligibleReason: null,
  serviceYears: new Decimal('6.96'),
  countedYears: new Decimal(7),
  amount: new Decimal('242307.69'),
  exemptAmount: new Decimal('242307.69'),
  taxableAmount: new Decimal(0),
};

describe('SettlementService', () => {
  let service: SettlementService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<SettlementService>(SettlementService);
    prisma = module.get(PrismaService);

    mockCalculateGratuity.mockReset();
    mockCalculateGratuity.mockReturnValue({ ...GRATUITY_RESULT });
  });

  /** Wire up the happy-path reads for `compute`. */
  function arrangeCompute(options: {
    separation?: Record<string, unknown> | null;
    salary?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
    balances?: unknown[];
    existing?: unknown;
  } = {}) {
    prisma.separation.findFirst.mockResolvedValue(
      options.separation === undefined ? makeSeparation() : options.separation,
    );
    prisma.employeeSalary.findFirst.mockResolvedValue(
      options.salary === undefined ? makeSalary() : options.salary,
    );
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      options.config === undefined ? makeConfig() : options.config,
    );
    prisma.leaveBalance.findMany.mockResolvedValue(
      options.balances === undefined ? makeBalances() : options.balances,
    );
    prisma.settlement.findFirst.mockResolvedValue(options.existing ?? null);
    prisma.settlement.create.mockImplementation(({ data }: any) => ({
      id: 'stl-1',
      ...data,
    }));
    prisma.settlement.update.mockImplementation(({ data }: any) => ({
      id: 'stl-1',
      ...data,
    }));
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── compute ───────────────────────────────────────────────

  describe('compute', () => {
    it('computes every component of a settlement', async () => {
      arrangeCompute();

      const result: any = await service.compute(TENANT, 'sep-1', {});

      // Pro-rata: 82,000 x 15 / 31 = 39,677.4193... -> 39,677.42
      expect(result.proRataSalary.toFixed(2)).toBe('39677.42');

      // Encashment: (12 + 5 - 4 - 1) = 12 days, sick leave floors at 0,
      // loss of pay excluded. 12 x (60,000 / 30) = 24,000.00
      expect(result.leaveEncashmentDays.toFixed(2)).toBe('12.00');
      expect(result.leaveEncashment.toFixed(2)).toBe('24000.00');

      expect(result.gratuity.toFixed(2)).toBe('242307.69');
      expect(result.gratuityExempt.toFixed(2)).toBe('242307.69');

      // Notice: 20 Feb to 15 Mar inclusive = 24 days served against 30
      // required, so 6 short. 82,000 x 6 / 31 = 15,870.9677... -> 15,870.97
      expect(result.noticeShortfallDays).toBe(6);
      expect(result.noticeRecovery.toFixed(2)).toBe('15870.97');

      // 39,677.42 + 24,000.00 + 242,307.69 = 305,985.11
      expect(result.grossPayable.toFixed(2)).toBe('305985.11');
      expect(result.totalRecoveries.toFixed(2)).toBe('15870.97');
      expect(result.netPayable.toFixed(2)).toBe('290114.14');
      expect(result.status).toBe('DRAFT');
    });

    it('passes basic plus DA and the tenant gratuity config to the calculator', async () => {
      arrangeCompute();

      await service.compute(TENANT, 'sep-1', {});

      expect(mockCalculateGratuity).toHaveBeenCalledTimes(1);
      const [input, config] = mockCalculateGratuity.mock.calls[0];
      expect(input.lastDrawnWages.toFixed(2)).toBe('60000.00');
      expect(input.joinDate).toEqual(JOIN_DATE);
      expect(input.lastWorkingDate).toEqual(LAST_WORKING_DATE);
      expect(input.waiveMinimumService).toBe(false);
      expect(config.gratuityDaysPerYear.toFixed(2)).toBe('15.00');
      expect(config.gratuityMonthDays.toFixed(2)).toBe('26.00');
    });

    it('forwards the minimum-service waiver when asked', async () => {
      arrangeCompute();

      await service.compute(TENANT, 'sep-1', {
        waiveGratuityMinimumService: true,
      });

      expect(mockCalculateGratuity.mock.calls[0][0].waiveMinimumService).toBe(true);
    });

    it('records zero gratuity when the calculator finds the leaver ineligible', async () => {
      arrangeCompute();
      mockCalculateGratuity.mockReturnValue({
        eligible: false,
        ineligibleReason: 'Less than 5 completed years of service',
        serviceYears: new Decimal('2.50'),
        countedYears: new Decimal(0),
        amount: new Decimal(0),
        exemptAmount: new Decimal(0),
        taxableAmount: new Decimal(0),
      });

      const result: any = await service.compute(TENANT, 'sep-1', {});

      expect(result.gratuity.toFixed(2)).toBe('0.00');
      // 39,677.42 + 24,000.00
      expect(result.grossPayable.toFixed(2)).toBe('63677.42');
      expect(result.breakdown.gratuity.ineligibleReason).toBe(
        'Less than 5 completed years of service',
      );
    });

    it('recovers nothing when the notice period was waived', async () => {
      arrangeCompute({
        separation: makeSeparation({ isNoticePeriodWaived: true }),
      });

      const result: any = await service.compute(TENANT, 'sep-1', {});

      expect(result.noticeShortfallDays).toBe(0);
      expect(result.noticeRecovery.toFixed(2)).toBe('0.00');
      expect(result.totalRecoveries.toFixed(2)).toBe('0.00');
    });

    it('recovers nothing when the full notice was served', async () => {
      arrangeCompute({
        separation: makeSeparation({ noticePeriodDays: 20 }),
      });

      const result: any = await service.compute(TENANT, 'sep-1', {});

      expect(result.noticeShortfallDays).toBe(0);
      expect(result.noticeRecovery.toFixed(2)).toBe('0.00');
    });

    it('pays nothing for leave when encashment is disabled for the tenant', async () => {
      arrangeCompute({
        config: makeConfig({ leaveEncashmentEnabled: false }),
      });

      const result: any = await service.compute(TENANT, 'sep-1', {});

      expect(result.leaveEncashmentDays.toFixed(2)).toBe('0.00');
      expect(result.leaveEncashment.toFixed(2)).toBe('0.00');
      expect(prisma.leaveBalance.findMany).not.toHaveBeenCalled();
    });

    it('starts the pro-rata window at the join date when the leaver joined mid-month', async () => {
      arrangeCompute({
        separation: makeSeparation({
          employee: {
            ...makeSeparation().employee,
            joinDate: new Date('2025-03-06T12:00:00Z'),
          },
        }),
      });

      const result: any = await service.compute(TENANT, 'sep-1', {});

      // 6 March to 15 March inclusive = 10 days. 82,000 x 10 / 31 = 26,451.61
      expect(result.proRataSalary.toFixed(2)).toBe('26451.61');
      expect(result.breakdown.proRata.daysWorked).toBe(10);
    });

    it('stores a breakdown showing how each figure was reached', async () => {
      arrangeCompute();

      const result: any = await service.compute(TENANT, 'sep-1', {});

      expect(result.breakdown.proRata).toMatchObject({
        monthlyGross: '82000.00',
        daysWorked: 15,
        daysInMonth: 31,
        amount: '39677.42',
      });
      expect(result.breakdown.leaveEncashment.perDayRate).toBe('2000.00');
      expect(result.breakdown.leaveEncashment.leaveTypes).toEqual([
        { code: 'EL', name: 'Earned Leave', days: '12.00', amount: '24000.00' },
      ]);
      expect(result.breakdown.noticeRecovery).toMatchObject({
        required: 30,
        served: 24,
        shortfallDays: 6,
        dailyRate: '2645.16',
      });
      expect(result.breakdown.totals).toMatchObject({
        grossPayable: '305985.11',
        totalRecoveries: '15870.97',
        netPayable: '290114.14',
      });
    });

    it('scopes every read by tenant', async () => {
      arrangeCompute();

      await service.compute(TENANT, 'sep-1', {});

      expect(prisma.separation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sep-1', tenantId: TENANT } }),
      );
      expect(prisma.employeeSalary.findFirst.mock.calls[0][0].where).toMatchObject(
        { tenantId: TENANT, employeeId: 'emp-1', isActive: true },
      );
      expect(prisma.statutoryConfig.findUnique).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
      });
      expect(prisma.leaveBalance.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: TENANT,
        employeeId: 'emp-1',
      });
    });

    it('throws NotFoundException when the separation does not exist', async () => {
      arrangeCompute({ separation: null });

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when no last working date has been set', async () => {
      arrangeCompute({
        separation: makeSeparation({ lastWorkingDate: null }),
      });

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the employee has no active salary', async () => {
      arrangeCompute({ salary: null });

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the tenant has no statutory config', async () => {
      arrangeCompute({ config: null });

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to recompute a settlement that is no longer a draft', async () => {
      arrangeCompute({ existing: { id: 'stl-1', status: 'APPROVED' } });

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.settlement.update).not.toHaveBeenCalled();
      expect(prisma.settlement.create).not.toHaveBeenCalled();
    });

    it('overwrites an existing draft with a status-guarded update', async () => {
      arrangeCompute({ existing: { id: 'stl-1', status: 'DRAFT' } });

      await service.compute(TENANT, 'sep-1', {});

      expect(prisma.settlement.create).not.toHaveBeenCalled();
      expect(prisma.settlement.update.mock.calls[0][0].where).toEqual({
        id: 'stl-1',
        status: 'DRAFT',
      });
    });

    it('turns a lost recompute race into a ConflictException', async () => {
      arrangeCompute({ existing: { id: 'stl-1', status: 'DRAFT' } });
      prisma.settlement.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.compute(TENANT, 'sep-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('does its writes inside a transaction', async () => {
      arrangeCompute();

      await service.compute(TENANT, 'sep-1', {});

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // ── findOne / findBySeparation ────────────────────────────

  describe('findOne', () => {
    it('returns the settlement scoped to the tenant', async () => {
      const settlement = { id: 'stl-1', status: 'DRAFT' };
      prisma.settlement.findFirst.mockResolvedValue(settlement);

      const result = await service.findOne(TENANT, 'stl-1');

      expect(prisma.settlement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'stl-1', tenantId: TENANT } }),
      );
      expect(result).toEqual(settlement);
    });

    it('throws NotFoundException when absent', async () => {
      prisma.settlement.findFirst.mockResolvedValue(null);

      await expect(service.findOne(TENANT, 'stl-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findBySeparation', () => {
    it('looks the settlement up by its separation', async () => {
      const settlement = { id: 'stl-1', separationId: 'sep-1' };
      prisma.settlement.findFirst.mockResolvedValue(settlement);

      const result = await service.findBySeparation(TENANT, 'sep-1');

      expect(prisma.settlement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { separationId: 'sep-1', tenantId: TENANT },
        }),
      );
      expect(result).toEqual(settlement);
    });

    it('throws NotFoundException when none has been computed', async () => {
      prisma.settlement.findFirst.mockResolvedValue(null);

      await expect(service.findBySeparation(TENANT, 'sep-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ────────────────────────────────────────────────

  describe('update', () => {
    const draft = {
      id: 'stl-1',
      tenantId: TENANT,
      status: 'DRAFT',
      proRataSalary: new Decimal('39677.42'),
      leaveEncashment: new Decimal('24000.00'),
      gratuity: new Decimal('242307.69'),
      otherEarnings: new Decimal(0),
      noticeRecovery: new Decimal('15870.97'),
      otherRecoveries: new Decimal(0),
      tds: new Decimal(0),
      breakdown: { totals: {} },
    };

    beforeEach(() => {
      prisma.settlement.findFirst.mockResolvedValue(draft);
      prisma.settlement.update.mockImplementation(({ data }: any) => ({
        id: 'stl-1',
        ...data,
      }));
    });

    it('re-derives the totals from the manual figures', async () => {
      const result: any = await service.update(TENANT, 'stl-1', {
        otherEarnings: 5000,
        otherRecoveries: 2500,
        tds: 10000,
        remarks: 'Laptop returned',
      });

      // 39,677.42 + 24,000.00 + 242,307.69 + 5,000.00 = 310,985.11
      expect(result.grossPayable.toFixed(2)).toBe('310985.11');
      // 15,870.97 + 2,500.00
      expect(result.totalRecoveries.toFixed(2)).toBe('18370.97');
      // 310,985.11 - 18,370.97 - 10,000.00
      expect(result.netPayable.toFixed(2)).toBe('282614.14');
      expect(result.remarks).toBe('Laptop returned');
    });

    it('keeps the stored figures when a field is omitted', async () => {
      const result: any = await service.update(TENANT, 'stl-1', {
        tds: 1000,
      });

      expect(result.otherEarnings.toFixed(2)).toBe('0.00');
      expect(result.grossPayable.toFixed(2)).toBe('305985.11');
      expect(result.netPayable.toFixed(2)).toBe('289114.14');
    });

    it('refreshes the totals section of the breakdown', async () => {
      const result: any = await service.update(TENANT, 'stl-1', {
        otherEarnings: 5000,
      });

      expect(result.breakdown.totals).toMatchObject({
        grossPayable: '310985.11',
        netPayable: '295114.14',
      });
    });

    it('guards the update on the draft status', async () => {
      await service.update(TENANT, 'stl-1', { tds: 1000 });

      expect(prisma.settlement.update.mock.calls[0][0].where).toEqual({
        id: 'stl-1',
        status: 'DRAFT',
      });
    });

    it('refuses to edit an approved settlement', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        ...draft,
        status: 'APPROVED',
      });

      await expect(
        service.update(TENANT, 'stl-1', { tds: 1000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects negative manual figures', async () => {
      await expect(
        service.update(TENANT, 'stl-1', { otherRecoveries: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('turns a lost race into a ConflictException', async () => {
      prisma.settlement.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update(TENANT, 'stl-1', { tds: 1000 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── approve ───────────────────────────────────────────────

  describe('approve', () => {
    it('moves a draft to approved and stamps the approver', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'DRAFT',
      });
      prisma.settlement.update.mockImplementation(({ data }: any) => ({
        id: 'stl-1',
        ...data,
      }));

      const result: any = await service.approve(TENANT, 'stl-1', 'user-9');

      expect(prisma.settlement.update.mock.calls[0][0].where).toEqual({
        id: 'stl-1',
        status: 'DRAFT',
      });
      expect(result.status).toBe('APPROVED');
      expect(result.approvedBy).toBe('user-9');
      expect(result.approvedAt).toBeInstanceOf(Date);
    });

    it('refuses to approve twice', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'APPROVED',
      });

      await expect(service.approve(TENANT, 'stl-1', 'user-9')).rejects.toThrow(
        ConflictException,
      );
    });

    it('turns a lost race into a ConflictException', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'DRAFT',
      });
      prisma.settlement.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.approve(TENANT, 'stl-1', 'user-9')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── markPaid ──────────────────────────────────────────────

  describe('markPaid', () => {
    it('moves an approved settlement to paid', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'APPROVED',
      });
      prisma.settlement.update.mockImplementation(({ data }: any) => ({
        id: 'stl-1',
        ...data,
      }));

      const result: any = await service.markPaid(TENANT, 'stl-1');

      expect(prisma.settlement.update.mock.calls[0][0].where).toEqual({
        id: 'stl-1',
        status: 'APPROVED',
      });
      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('refuses to pay a settlement that was never approved', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'DRAFT',
      });

      await expect(service.markPaid(TENANT, 'stl-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('turns a lost race into a ConflictException', async () => {
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'stl-1',
        status: 'APPROVED',
      });
      prisma.settlement.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.markPaid(TENANT, 'stl-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
