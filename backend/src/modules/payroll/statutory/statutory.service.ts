import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InvestmentProofStatus, TaxAgeBand, TaxRegime } from '@prisma/client';
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
  Section10AllowanceLimits,
} from './statutory.calculators';
import { ageBandOn31March, collectsProfessionalTaxIn, DeductionLimits } from './tax-correctness.types';

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
  /**
   * Used to select the old regime's basic-exemption band via
   * `ageBandOn31March`. Optional because not every caller has wired it
   * through yet; a missing value is read the same as a missing date of birth
   * and lands on the safe GENERAL band rather than failing the run.
   */
  dateOfBirth?: Date | null;
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

/** What resolving an income tax configuration by age band found. */
export interface ResolvedIncomeTaxConfig {
  taxConfig: {
    standardDeduction: Decimal;
    rebateIncomeLimit: Decimal;
    rebateMaxAmount: Decimal;
    cessRate: Decimal;
    surchargeSlabs: unknown;
    section80CLimit: Decimal;
    section80DLimit: Decimal;
    section80CCD1BLimit: Decimal;
    /**
     * The section 10(14) ceilings. Optional because a row seeded before these
     * columns existed carries none, and the callers fall back to the statutory
     * figures — which are also the schema's defaults — rather than exempting
     * an uncapped amount.
     */
    childrenEducationMonthlyLimit?: Decimal;
    hostelAllowanceMonthlyLimit?: Decimal;
    childrenAllowanceMaxChildren?: number;
    marginalReliefEnabled: boolean;
    slabs: { fromAmount: Decimal; toAmount: Decimal | null; rate: Decimal }[];
  };
  /** The band whose slabs were actually used. */
  ageBandUsed: TaxAgeBand;
  /** The band selected by the employee's age, before any fallback. */
  ageBandRequested: TaxAgeBand;
  /** True when the requested band had no seeded row and GENERAL was used instead. */
  ageBandFallback: boolean;
}

/**
 * Loads the income tax configuration for a tenant, year and regime, banded by
 * age.
 *
 * A missing band must not mean no tax: if a tenant has seeded only GENERAL
 * rows and the employee is a senior citizen, the SENIOR lookup finds nothing.
 * Falling through to "no slabs configured" would silently stop deducting tax
 * from that employee, which is worse than taxing them on the general slabs
 * (the general slabs have a lower basic exemption, so this over-collects
 * rather than under-collects; the difference is settled on assessment). So a
 * missing non-GENERAL row falls back to GENERAL, and the caller is told that
 * happened via `ageBandFallback` so it can be recorded in the working.
 *
 * Shared between `StatutoryService` (monthly TDS) and `Form16Service` (the
 * year-end certificate) so the two cannot select different configurations for
 * the same employee and year.
 */
export async function resolveIncomeTaxConfig(
  prisma: PrismaService,
  tenantId: string,
  financialYear: number,
  regime: TaxRegime,
  ageBand: TaxAgeBand,
  onFallback?: (requestedBand: TaxAgeBand) => void,
): Promise<ResolvedIncomeTaxConfig | null> {
  const primary = await prisma.incomeTaxConfig.findUnique({
    where: {
      tenantId_financialYear_regime_ageBand: { tenantId, financialYear, regime, ageBand },
    },
    include: { slabs: { orderBy: { fromAmount: 'asc' } } },
  });

  if (primary && primary.slabs.length > 0) {
    return { taxConfig: primary, ageBandUsed: ageBand, ageBandRequested: ageBand, ageBandFallback: false };
  }

  // Nothing to fall back to: GENERAL already was the request.
  if (ageBand === TaxAgeBand.GENERAL) return null;

  onFallback?.(ageBand);

  const fallback = await prisma.incomeTaxConfig.findUnique({
    where: {
      tenantId_financialYear_regime_ageBand: {
        tenantId,
        financialYear,
        regime,
        ageBand: TaxAgeBand.GENERAL,
      },
    },
    include: { slabs: { orderBy: { fromAmount: 'asc' } } },
  });

  if (!fallback || fallback.slabs.length === 0) return null;

  return {
    taxConfig: fallback,
    ageBandUsed: TaxAgeBand.GENERAL,
    ageBandRequested: ageBand,
    ageBandFallback: true,
  };
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

    // An empty (or unset) ptMonths means every month, which is what every
    // tenant that predates the column gets, so their deduction cannot move.
    const professionalTax =
      config.ptEnabled && collectsProfessionalTaxIn(input.month, config.ptMonths)
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

    // Age is read as at 31 March of the financial year, not the payroll date;
    // see ageBandOn31March for why. A missing date of birth reads as GENERAL,
    // the safe direction.
    const ageBandRequested = ageBandOn31March(input.dateOfBirth, financialYear);

    const resolved = await resolveIncomeTaxConfig(
      this.prisma,
      input.tenantId,
      financialYear,
      regime,
      ageBandRequested,
      (requestedBand) => {
        this.logger.warn(
          `No ${requestedBand} income tax configuration for tenant ${input.tenantId}, FY ${financialYear}, ` +
            `${regime} regime; falling back to GENERAL slabs so TDS is not silently skipped.`,
        );
      },
    );

    // Without slabs for this year (in the requested band or the GENERAL
    // fallback) there is nothing defensible to deduct.
    if (!resolved) {
      this.logger.warn(
        `No income tax configuration for tenant ${input.tenantId}, FY ${financialYear}, ${regime} regime; deducting no TDS.`,
      );
      return { tds: ZERO, taxComputation: null };
    }

    const { taxConfig, ageBandUsed, ageBandFallback } = resolved;

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
      // The section 10 heads. Absent on a declaration written before the
      // columns existed, which reads as nought and so moves nobody's tax.
      ltaExemption: new Decimal(declaration?.ltaExemption ?? 0),
      childrenEducationAllowance: new Decimal(declaration?.childrenEducationAllowance ?? 0),
      hostelAllowance: new Decimal(declaration?.hostelAllowance ?? 0),
      homeLoanInterest: new Decimal(declaration?.homeLoanInterest ?? 0),
      otherDeductions: new Decimal(declaration?.otherDeductions ?? 0),
      otherIncome: new Decimal(declaration?.otherIncome ?? 0),
      previousEmployerTds: new Decimal(declaration?.previousEmployerTds ?? 0),
    };

    // Not a money figure and not a proof-backed one: a school fee receipt says
    // what was paid, not how many children there are. So it comes from the
    // declaration whatever the verification setting says, and the calculation
    // caps it at the year's maximum.
    const childrenCount = declaration?.childrenCount ?? 0;

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

    // The statutory ceilings for the year and regime. The calculator caps
    // declared/verified figures against these; capping is not repeated here,
    // so there is exactly one place the rule lives.
    const limits: DeductionLimits = {
      section80C: new Decimal(taxConfig.section80CLimit ?? 150000),
      section80D: new Decimal(taxConfig.section80DLimit ?? 25000),
      section80CCD1B: new Decimal(taxConfig.section80CCD1BLimit ?? 50000),
    };
    const marginalReliefEnabled = taxConfig.marginalReliefEnabled ?? true;

    // The year's section 10(14) ceilings, per child per month, and the most
    // children they may be claimed for. Passed down for the same reason the
    // chapter VI-A ceilings are: the calculator caps, so the rule lives in one
    // place, and a year that moves the figures needs no code change.
    const section10Limits: Section10AllowanceLimits = {
      childrenEducationMonthlyLimit: new Decimal(
        taxConfig.childrenEducationMonthlyLimit ?? 100,
      ),
      hostelAllowanceMonthlyLimit: new Decimal(taxConfig.hostelAllowanceMonthlyLimit ?? 300),
      maxChildren: taxConfig.childrenAllowanceMaxChildren ?? 2,
    };

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
        ageBand: ageBandUsed,
        limits,
        section10Limits,
        marginalReliefEnabled,
      },
      { ...declarations, childrenCount },
      annualProfessionalTax,
    );

    // The calculator capped these against `limits`; it is the one place that
    // rule lives, so the working reports back what it did rather than
    // recomputing "allowed" here. Keyed by the calculator's own section
    // labels ('80C', '80D', '80CCD(1B)') and empty under the new regime.
    const chapterVIACaps = Object.fromEntries(
      computed.chapterVIACaps.map((cap) => [
        cap.section,
        {
          declared: cap.declared.toFixed(2),
          limit: cap.limit.toFixed(2),
          allowed: cap.allowed.toFixed(2),
          disallowed: cap.disallowed.toFixed(2),
        },
      ]),
    );

    // Likewise from the calculator, which is where the per-child ceilings are
    // applied: what was claimed under each section 10 head against what the
    // section actually allowed. Keyed by the calculator's own head labels and
    // empty under the new regime, which withdraws all of them.
    const section10Exemptions = Object.fromEntries(
      computed.section10Exemptions.map((e) => [
        e.head,
        {
          declared: e.declared.toFixed(2),
          limit: e.limit === null ? null : e.limit.toFixed(2),
          allowed: e.allowed.toFixed(2),
          disallowed: e.disallowed.toFixed(2),
        },
      ]),
    );

    // Tax already collected this year, whether by us or a previous employer.
    const alreadyDeducted = ytd.tds.add(declarations.previousEmployerTds);
    const tds = monthlyTdsInstalment(computed.totalTax, alreadyDeducted, remainingMonths);

    return {
      tds,
      taxComputation: {
        financialYear,
        regime,
        // Which age band's slabs were actually used, whether that required
        // falling back to GENERAL, and what was requested before the
        // fallback — the answer to "why did this employee's exemption change".
        ageBand: ageBandUsed,
        ageBandRequested,
        ageBandFallbackApplied: ageBandFallback,
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
        // The Chapter VI-A ceilings applied for the year, and — from the
        // calculator, which is the one place capping happens — what was
        // declared against what was actually allowed for each capped head.
        deductionLimits: {
          section80C: limits.section80C.toFixed(2),
          section80D: limits.section80D.toFixed(2),
          section80CCD1B: limits.section80CCD1B.toFixed(2),
        },
        chapterVIACaps,
        // The section 10 exemptions, which reduce salary rather than total
        // income: house rent, leave travel and the two allowances for
        // children. The ceilings applied to the last two, the number of
        // children they were allowed for, and what each head claimed against
        // what it got — the answer to "why did ₹5,000 of school fees exempt
        // ₹1,200".
        section10Limits: {
          childrenEducationMonthlyLimit: section10Limits.childrenEducationMonthlyLimit.toFixed(2),
          hostelAllowanceMonthlyLimit: section10Limits.hostelAllowanceMonthlyLimit.toFixed(2),
          maxChildren: section10Limits.maxChildren,
        },
        childrenCount,
        childrenAllowed: Math.max(0, Math.min(childrenCount, section10Limits.maxChildren)),
        section10Exemptions,
        totalSection10Exemption: computed.totalSection10Exemption.toFixed(2),
        marginalReliefEnabled,
        marginalReliefApplied: computed.marginalRelief.gt(0),
        marginalRelief: computed.marginalRelief.toFixed(2),
        surchargeBeforeRelief: computed.surchargeBeforeRelief.toFixed(2),
        reliefThreshold: computed.reliefThreshold ? computed.reliefThreshold.toFixed(2) : null,
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
  private approvedProofTotals(
    input: StatutoryInput,
    financialYear: number,
  ): Promise<VerifiedTotals> {
    return readApprovedProofTotals(
      this.prisma,
      input.tenantId,
      input.employeeId,
      financialYear,
    );
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

/**
 * The sum of an employee's approved proofs, per declaration field.
 *
 * Exported rather than private because Form 16 needs the same figures. A
 * certificate built from the declaration while the year's payslips were
 * computed from approved proofs would show more exempt than was actually
 * allowed, and the two disagreeing is worse than either being wrong alone.
 */
export async function readApprovedProofTotals(
  prisma: PrismaService,
  tenantId: string,
  employeeId: string,
  financialYear: number,
): Promise<VerifiedTotals> {
  const proofs = await prisma.investmentProof.findMany({
    where: {
      tenantId,
      employeeId,
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
