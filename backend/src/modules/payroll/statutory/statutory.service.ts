import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InvestmentProofStatus, TaxRegime } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PROOF_SECTION_TO_DECLARATION_FIELD,
  ProofBackedField,
  VerifiedTotals,
  verificationApplies,
} from '../proofs/proofs.types';
import {
  UpdateStatutoryConfigDto,
  UpsertTaxDeclarationDto,
} from './dto/statutory.dto';
import {
  calculateEsi,
  calculateIncomeTax,
  calculateLwf,
  calculatePf,
  calculateProfessionalTax,
  monthlyTdsInstalment,
  IncomeTaxResult,
  PtSlab,
} from './statutory.calculators';

export interface StatutoryInput {
  tenantId: string;
  employeeId: string;
  /** Calendar month, 1-12. */
  month: number;
  year: number;
  /** Basic plus dearness allowance for the month, the base for provident fund. */
  pfWages: Decimal;
  /** Gross earnings for the month, the base for ESI and professional tax. */
  grossPay: Decimal;
  pfOptOut: boolean;
  gender: string | null;
  /** The employee's own choice, if they have made one. */
  employeeRegime: TaxRegime | null;
}

export interface StatutoryResult {
  pfWages: Decimal;
  pfEmployee: Decimal;
  pfEmployer: Decimal;
  epsEmployer: Decimal;
  edliEmployer: Decimal;
  pfAdminEmployer: Decimal;
  esiWages: Decimal;
  esiEmployee: Decimal;
  esiEmployer: Decimal;
  professionalTax: Decimal;
  lwfEmployee: Decimal;
  lwfEmployer: Decimal;
  tds: Decimal;
  /** Kept on the payslip so a figure can be explained, and for Form 16 later. */
  taxComputation: Record<string, unknown> | null;
  /** What the employee has deducted from their pay. */
  totalEmployeeDeductions: Decimal;
}

const ZERO = new Decimal(0);

/**
 * The declaration fields evidence can support, taken from the shared contract
 * rather than listed again here. Everything else on a declaration — the
 * employer's own NPS contribution under 80CCD(2), and declared other income —
 * has no proof head and so keeps coming from the declaration whatever the
 * verification setting says.
 */
const PROOF_BACKED_FIELDS: readonly ProofBackedField[] = Object.values(
  PROOF_SECTION_TO_DECLARATION_FIELD,
);

function emptyResult(): StatutoryResult {
  return {
    pfWages: ZERO,
    pfEmployee: ZERO,
    pfEmployer: ZERO,
    epsEmployer: ZERO,
    edliEmployer: ZERO,
    pfAdminEmployer: ZERO,
    esiWages: ZERO,
    esiEmployee: ZERO,
    esiEmployer: ZERO,
    professionalTax: ZERO,
    lwfEmployee: ZERO,
    lwfEmployer: ZERO,
    tds: ZERO,
    taxComputation: null,
    totalEmployeeDeductions: ZERO,
  };
}

/**
 * The Indian financial year a calendar month belongs to.
 * April 2026 and March 2027 both belong to FY 2026-27, returned as 2026.
 */
export function financialYearOf(month: number, year: number): number {
  return month >= 4 ? year : year - 1;
}

/** Months left in the financial year, counting the current one. */
export function monthsRemainingInFy(month: number): number {
  return month >= 4 ? 16 - month : 4 - month;
}

/**
 * The ESI contribution period a month falls in: April to September, or
 * October to March. Coverage is decided per period, not per month.
 */
export function esiContributionPeriod(
  month: number,
  year: number,
): { startMonth: number; startYear: number; endMonth: number; endYear: number } {
  if (month >= 4 && month <= 9) {
    return { startMonth: 4, startYear: year, endMonth: 9, endYear: year };
  }
  if (month >= 10) {
    return { startMonth: 10, startYear: year, endMonth: 3, endYear: year + 1 };
  }
  return { startMonth: 10, startYear: year - 1, endMonth: 3, endYear: year };
}

/**
 * Resolves a tenant's statutory configuration and applies it to one employee
 * for one month.
 *
 * Nothing is hardcoded here: if a tenant has no StatutoryConfig row, no
 * statutory deduction is made at all, which keeps existing installations
 * behaving exactly as they did before this feature landed.
 */
@Injectable()
export class StatutoryService {
  private readonly logger = new Logger(StatutoryService.name);

  constructor(private prisma: PrismaService) {}

  /** Null when the tenant has not opted in; no statutory deduction is then made. */
  async getConfig(tenantId: string) {
    return this.prisma.statutoryConfig.findUnique({ where: { tenantId } });
  }

  /** Patches the configuration, creating it on first use with schema defaults. */
  async upsertConfig(tenantId: string, dto: UpdateStatutoryConfigDto) {
    return this.prisma.statutoryConfig.upsert({
      where: { tenantId },
      update: dto,
      create: { tenantId, ...dto } as never,
    });
  }

  async listPtSlabs(tenantId: string, state?: string) {
    return this.prisma.professionalTaxSlab.findMany({
      where: { tenantId, ...(state ? { state } : {}) },
      orderBy: [{ state: 'asc' }, { fromAmount: 'asc' }],
    });
  }

  async listIncomeTaxConfigs(tenantId: string, financialYear?: number) {
    return this.prisma.incomeTaxConfig.findMany({
      where: { tenantId, ...(financialYear ? { financialYear } : {}) },
      include: { slabs: { orderBy: { fromAmount: 'asc' } } },
      orderBy: [{ financialYear: 'desc' }, { regime: 'asc' }],
    });
  }

  async getDeclaration(tenantId: string, employeeId: string, financialYear?: number) {
    const now = new Date();
    const fy = financialYear ?? financialYearOf(now.getMonth() + 1, now.getFullYear());

    return this.prisma.employeeTaxDeclaration.findUnique({
      where: {
        tenantId_employeeId_financialYear: { tenantId, employeeId, financialYear: fy },
      },
    });
  }

  async upsertDeclaration(
    tenantId: string,
    employeeId: string,
    dto: UpsertTaxDeclarationDto,
  ) {
    const now = new Date();
    const financialYear =
      dto.financialYear ?? financialYearOf(now.getMonth() + 1, now.getFullYear());

    const config = await this.getConfig(tenantId);
    const regime = dto.regime ?? config?.defaultTaxRegime ?? TaxRegime.NEW;

    const { financialYear: _fy, regime: _r, ...amounts } = dto;

    return this.prisma.employeeTaxDeclaration.upsert({
      where: {
        tenantId_employeeId_financialYear: { tenantId, employeeId, financialYear },
      },
      update: { regime, ...amounts },
      create: { tenantId, employeeId, financialYear, regime, ...amounts } as never,
    });
  }

  async compute(input: StatutoryInput): Promise<StatutoryResult> {
    const config = await this.prisma.statutoryConfig.findUnique({
      where: { tenantId: input.tenantId },
    });

    // No configuration means the tenant has not opted in. Deduct nothing
    // rather than guessing at rates on their behalf.
    if (!config) return emptyResult();

    const pf = calculatePf(input.pfWages, config, input.pfOptOut);

    const esi = calculateEsi(
      input.grossPay,
      config,
      await this.wasCoveredEarlierInEsiPeriod(input),
    );

    const professionalTax = config.ptEnabled
      ? calculateProfessionalTax(
          input.grossPay,
          await this.loadPtSlabs(input.tenantId, config.ptState),
          input.month,
          input.gender,
        )
      : ZERO;

    const lwf = calculateLwf(config, input.month);

    const { tds, taxComputation } = config.tdsEnabled
      ? await this.computeTds(input, config, professionalTax)
      : { tds: ZERO, taxComputation: null };

    const totalEmployeeDeductions = pf.employee
      .add(esi.employee)
      .add(professionalTax)
      .add(lwf.employee)
      .add(tds);

    return {
      pfWages: pf.pfWages,
      pfEmployee: pf.employee,
      pfEmployer: pf.employerPf,
      epsEmployer: pf.eps,
      edliEmployer: pf.edli,
      pfAdminEmployer: pf.admin,
      esiWages: esi.esiWages,
      esiEmployee: esi.employee,
      esiEmployer: esi.employer,
      professionalTax,
      lwfEmployee: lwf.employee,
      lwfEmployer: lwf.employer,
      tds,
      taxComputation,
      totalEmployeeDeductions,
    };
  }

  private async loadPtSlabs(tenantId: string, state: string | null): Promise<PtSlab[]> {
    if (!state) return [];
    const rows = await this.prisma.professionalTaxSlab.findMany({
      where: { tenantId, state },
      orderBy: { fromAmount: 'asc' },
    });
    return rows.map((r) => ({
      fromAmount: new Decimal(r.fromAmount),
      toAmount: r.toAmount === null ? null : new Decimal(r.toAmount),
      amount: new Decimal(r.amount),
      februaryAmount: r.februaryAmount === null ? null : new Decimal(r.februaryAmount),
      gender: r.gender,
    }));
  }

  /**
   * Whether the employee already contributed to ESI earlier in this
   * contribution period. If they did, coverage continues to the end of the
   * period even once their wages rise above the limit.
   */
  private async wasCoveredEarlierInEsiPeriod(input: StatutoryInput): Promise<boolean> {
    const period = esiContributionPeriod(input.month, input.year);

    const earlier = await this.prisma.payslip.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        esiEmployee: { gt: 0 },
        payrollRun: {
          OR: [
            { year: period.startYear, month: { gte: period.startMonth } },
            { year: period.endYear, month: { lte: period.endMonth } },
          ],
        },
      },
      select: { id: true },
    });

    return earlier !== null;
  }

  /**
   * Projects the year's tax and returns this month's share of it.
   *
   * The projection is what has actually been earned so far this financial year
   * plus the current month repeated across the months that remain, which
   * tracks a mid-year raise better than simply multiplying by twelve.
   */
  private async computeTds(
    input: StatutoryInput,
    config: {
      defaultTaxRegime: TaxRegime;
      proofVerificationRequired: boolean;
      proofCutoffMonth: number;
    },
    professionalTaxThisMonth: Decimal,
  ): Promise<{ tds: Decimal; taxComputation: Record<string, unknown> | null }> {
    const financialYear = financialYearOf(input.month, input.year);
    const remainingMonths = monthsRemainingInFy(input.month);

    const declaration = await this.prisma.employeeTaxDeclaration.findUnique({
      where: {
        tenantId_employeeId_financialYear: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          financialYear,
        },
      },
    });

    const regime = input.employeeRegime ?? declaration?.regime ?? config.defaultTaxRegime;

    const taxConfig = await this.prisma.incomeTaxConfig.findUnique({
      where: {
        tenantId_financialYear_regime: {
          tenantId: input.tenantId,
          financialYear,
          regime,
        },
      },
      include: { slabs: { orderBy: { fromAmount: 'asc' } } },
    });

    // Without slabs for this year there is nothing defensible to deduct.
    if (!taxConfig || taxConfig.slabs.length === 0) {
      this.logger.warn(
        `No income tax configuration for tenant ${input.tenantId}, FY ${financialYear}, ${regime} regime; deducting no TDS.`,
      );
      return { tds: ZERO, taxComputation: null };
    }

    const ytd = await this.yearToDateTotals(input, financialYear);

    const annualGross = ytd.gross.add(input.grossPay.mul(remainingMonths));
    const annualProfessionalTax = ytd.professionalTax.add(
      professionalTaxThisMonth.mul(remainingMonths),
    );

    const declared = {
      section80C: new Decimal(declaration?.section80C ?? 0),
      section80D: new Decimal(declaration?.section80D ?? 0),
      section80CCD1B: new Decimal(declaration?.section80CCD1B ?? 0),
      section80CCD2: new Decimal(declaration?.section80CCD2 ?? 0),
      hraExemption: new Decimal(declaration?.hraExemption ?? 0),
      homeLoanInterest: new Decimal(declaration?.homeLoanInterest ?? 0),
      otherDeductions: new Decimal(declaration?.otherDeductions ?? 0),
      otherIncome: new Decimal(declaration?.otherIncome ?? 0),
      previousEmployerTds: new Decimal(declaration?.previousEmployerTds ?? 0),
    };

    // Off by default, so a tenant that has not opted in is answered without a
    // query and computed from exactly the figures it was computed from before.
    const useVerified = verificationApplies({
      proofVerificationRequired: config.proofVerificationRequired ?? false,
      proofCutoffMonth: config.proofCutoffMonth ?? 1,
      payrollMonth: input.month,
    });

    const verified = useVerified
      ? await this.approvedProofTotals(input, financialYear)
      : null;

    // Where verification is in force, a proof-backed head is worth what the
    // approved proofs prove and nothing more. No approved proof means nothing
    // is allowed under that head — not the declared figure — which is the whole
    // point of switching verification on.
    const declarations = { ...declared };
    if (verified) {
      for (const field of PROOF_BACKED_FIELDS) {
        declarations[field] = new Decimal(verified[field] ?? 0);
      }
    }

    const computed: IncomeTaxResult = calculateIncomeTax(
      annualGross,
      {
        regime,
        standardDeduction: new Decimal(taxConfig.standardDeduction),
        rebateIncomeLimit: new Decimal(taxConfig.rebateIncomeLimit),
        rebateMaxAmount: new Decimal(taxConfig.rebateMaxAmount),
        cessRate: new Decimal(taxConfig.cessRate),
        surchargeSlabs: (taxConfig.surchargeSlabs as unknown as {
          threshold: number;
          rate: number;
        }[]) ?? [],
        slabs: taxConfig.slabs.map((s) => ({
          fromAmount: new Decimal(s.fromAmount),
          toAmount: s.toAmount === null ? null : new Decimal(s.toAmount),
          rate: new Decimal(s.rate),
        })),
      },
      declarations,
      annualProfessionalTax,
    );

    // Tax already collected this year, whether by us or a previous employer.
    const alreadyDeducted = ytd.tds.add(declarations.previousEmployerTds);
    const tds = monthlyTdsInstalment(computed.totalTax, alreadyDeducted, remainingMonths);

    return {
      tds,
      taxComputation: {
        financialYear,
        regime,
        projectedAnnualGross: annualGross.toFixed(2),
        taxableIncome: computed.taxableIncome.toFixed(2),
        totalDeductions: computed.totalDeductions.toFixed(2),
        taxBeforeRebate: computed.taxBeforeRebate.toFixed(2),
        rebate: computed.rebate.toFixed(2),
        surcharge: computed.surcharge.toFixed(2),
        cess: computed.cess.toFixed(2),
        annualTax: computed.totalTax.toFixed(2),
        alreadyDeducted: alreadyDeducted.toFixed(2),
        remainingMonths,
        // Whoever has to explain why this employee's TDS jumped in January
        // needs the answer here rather than in someone's memory.
        verifiedAmountsUsed: useVerified,
        proofCutoffMonth: config.proofCutoffMonth ?? 1,
        ...(verified
          ? {
              verifiedDeductions: Object.fromEntries(
                PROOF_BACKED_FIELDS.map((f) => [f, declarations[f].toFixed(2)]),
              ),
              declaredDeductions: Object.fromEntries(
                PROOF_BACKED_FIELDS.map((f) => [f, declared[f].toFixed(2)]),
              ),
            }
          : {}),
      },
    };
  }

  /**
   * The sum of the employee's approved proofs for the year, by declaration
   * field. Only approved rows count: a pending proof has not been accepted and
   * a rejected one never will be.
   *
   * An approved row with no verified amount recorded contributes nothing. The
   * claimed figure is what the employee asserted, and standing in for a missing
   * decision with it would defeat the verification it is meant to represent.
   */
  private async approvedProofTotals(
    input: StatutoryInput,
    financialYear: number,
  ): Promise<VerifiedTotals> {
    const proofs = await this.prisma.investmentProof.findMany({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        financialYear,
        status: InvestmentProofStatus.APPROVED,
      },
      select: { section: true, verifiedAmount: true },
    });

    const totals: Partial<Record<ProofBackedField, Decimal>> = {};

    for (const proof of proofs) {
      const field = PROOF_SECTION_TO_DECLARATION_FIELD[proof.section];
      // A head the contract does not map is not one this calculation can use.
      if (!field) continue;

      const amount =
        proof.verifiedAmount === null ? ZERO : new Decimal(proof.verifiedAmount);
      totals[field] = (totals[field] ?? ZERO).add(amount);
    }

    return Object.fromEntries(
      Object.entries(totals).map(([field, amount]) => [field, amount.toString()]),
    ) as VerifiedTotals;
  }

  /** Gross, professional tax and TDS already recorded this financial year. */
  private async yearToDateTotals(
    input: StatutoryInput,
    financialYear: number,
  ): Promise<{ gross: Decimal; professionalTax: Decimal; tds: Decimal }> {
    const payslips = await this.prisma.payslip.findMany({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        payrollRun: {
          OR: [
            { year: financialYear, month: { gte: 4 } },
            { year: financialYear + 1, month: { lte: 3 } },
          ],
        },
      },
      select: { grossPay: true, professionalTax: true, tds: true },
    });

    return payslips.reduce(
      (acc, p) => ({
        gross: acc.gross.add(new Decimal(p.grossPay)),
        professionalTax: acc.professionalTax.add(new Decimal(p.professionalTax)),
        tds: acc.tds.add(new Decimal(p.tds)),
      }),
      { gross: ZERO, professionalTax: ZERO, tds: ZERO },
    );
  }
}
