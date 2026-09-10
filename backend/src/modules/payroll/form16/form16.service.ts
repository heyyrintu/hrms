import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand, TaxRegime, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PROOF_BACKED_FIELDS,
  readApprovedProofTotals,
} from '../statutory/statutory.service';
import { verificationApplies } from '../proofs/proofs.types';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import {
  calculateIncomeTax,
  calculateSection10Exemptions,
  IncomeTaxResult,
  Section10AllowanceLimits,
  Section10ExemptionEntry,
} from '../statutory/statutory.calculators';
import { resolveIncomeTaxConfig } from '../statutory/statutory.service';
import { ageBandOn31March, DeductionLimits } from '../statutory/tax-correctness.types';

/**
 * Form 16 support.
 *
 * WHAT THIS IS NOT. Form 16 has two parts and only one of them can honestly
 * come from here. Part A — the certificate of tax deducted, carrying the
 * quarterly challan and receipt numbers — is generated and digitally signed by
 * the Income Tax Department's TRACES portal after the employer files its
 * quarterly Form 24Q returns. An employer's own payroll system cannot produce
 * it, and a document that imitated it would be a forgery. Nothing in this file
 * attempts to.
 *
 * What this file produces is Part B, the annexure to the certificate, which the
 * employer does prepare from its own records, plus a working summary of what
 * was deducted in each quarter. The quarterly figures here are what payroll
 * deducted; they are an input to the return, not a substitute for the receipt
 * numbers TRACES issues against it. The employee's Form 16 is the TRACES Part A
 * with this Part B attached, and only the download from TRACES carries the
 * department's signature.
 *
 * Money is Decimal throughout, and the liability is computed by the same
 * `calculateIncomeTax` the monthly TDS engine uses, so the certificate and the
 * payslips cannot drift apart into two different opinions of the same year.
 */

const ZERO = new Decimal(0);

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The department writes FY 2025 as "2025-26". */
export function financialYearLabel(financialYear: number): string {
  return `${financialYear}-${String((financialYear + 1) % 100).padStart(2, '0')}`;
}

/** Income earned in FY 2025-26 is assessed in AY 2026-27. */
export function assessmentYearLabel(financialYear: number): string {
  return financialYearLabel(financialYear + 1);
}

/**
 * The TDS return quarter a calendar month falls in.
 *
 * Quarters run from April, not January, so Q4 is January to March. Getting
 * this wrong misfiles the whole year, which is why it is a named function with
 * its own test rather than arithmetic buried in a reducer.
 */
export function quarterOfFy(month: number): 1 | 2 | 3 | 4 {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [4, 5, 6],
  2: [7, 8, 9],
  3: [10, 11, 12],
  4: [1, 2, 3],
};

/**
 * The standing caveat. Present on every response this service returns, because
 * the one thing a reader must not conclude is that they are holding a Form 16.
 */
const TRACES_NOTE =
  'This is the Part B annexure and a working summary prepared from employer payroll records. ' +
  'It is not Form 16 Part A, which is generated and digitally signed by the Income Tax ' +
  'Department on TRACES after the quarterly Form 24Q returns are filed, and it is not a ' +
  'substitute for the TRACES-issued certificate.';

export interface Form16Employer {
  name: string;
  address: string;
  tan: string | null;
  pan: string | null;
}

export interface Form16Employee {
  id: string;
  name: string;
  employeeCode: string;
  pan: string | null;
  designation: string | null;
}

export interface Form16Section16 {
  standardDeduction: Decimal;
  /** Section 16(iii): professional tax actually paid. Old regime only. */
  professionalTax: Decimal;
  total: Decimal;
}

export interface Form16ChapterVIA {
  section80C: Decimal;
  section80D: Decimal;
  section80CCD1B: Decimal;
  /** Employer's NPS contribution, allowed under both regimes. */
  section80CCD2: Decimal;
  otherDeductions: Decimal;
  total: Decimal;
}

export interface Form16Quarter {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  months: string[];
  amountPaid: Decimal;
  taxDeducted: Decimal;
  payslipCount: number;
  /**
   * Always null. The receipt number is issued by TRACES against a filed Form
   * 24Q and cannot be known here; the field exists so its absence is explicit
   * rather than looking like an oversight.
   */
  tracesReceiptNumber: null;
}

export interface QuarterlyTdsSummary {
  financialYear: number;
  financialYearLabel: string;
  employee: Form16Employee;
  quarters: Form16Quarter[];
  totalAmountPaid: Decimal;
  totalTaxDeducted: Decimal;
  notes: string[];
}

export interface Form16PartB {
  financialYear: number;
  financialYearLabel: string;
  assessmentYear: string;
  /** ISO dates for the certificate period, clamped to the employment dates. */
  periodFrom: string;
  periodTo: string;
  regime: TaxRegime;
  /**
   * The old regime's basic-exemption band, read from date of birth as at 31
   * March of the financial year. GENERAL for every new-regime certificate.
   *
   * Optional only so that a `Partial<Form16PartB>`-built fixture elsewhere
   * (this file always sets it) still type-checks; every certificate this
   * service actually returns carries it.
   */
  ageBand?: TaxAgeBand;
  /** True when the employee's own band had no seeded slabs and GENERAL was used instead. */
  ageBandFallbackApplied?: boolean;
  employer: Form16Employer;
  employee: Form16Employee;

  /** False when the employee had no payslip in the year; every figure is nil. */
  hasPayslipsInYear: boolean;
  payslipCount: number;

  // The numbered Part B lines.
  /** 1. Gross salary. */
  grossSalary: Decimal;
  /** 2. Less: allowances exempt under section 10. */
  allowancesExemptSection10: Decimal;
  /**
   * The heads that make up line 2, claimed against allowed.
   *
   * Empty on a new-regime certificate, which exempts none of them. Optional
   * only so a `Partial<Form16PartB>`-built fixture elsewhere still type-checks;
   * every certificate this service returns carries it.
   */
  allowancesExemptSection10Breakdown?: Section10ExemptionEntry[];
  /** 3. Balance. */
  balance: Decimal;
  /** 4. Deductions under section 16. */
  deductionsSection16: Form16Section16;
  /** 5. Income chargeable under the head "Salaries". */
  incomeChargeableUnderSalaries: Decimal;
  /** 6a. Income under any other head offered for TDS. */
  otherIncome: Decimal;
  /** 6b. Income from house property, negative when interest is claimed. */
  incomeFromHouseProperty: Decimal;
  /** 7. Gross total income. */
  grossTotalIncome: Decimal;
  /** 8. Deductions under Chapter VI-A. */
  deductionsChapterVIA: Form16ChapterVIA;
  /** 9. Total income. */
  totalIncome: Decimal;
  /** 10. Tax on total income. */
  taxOnTotalIncome: Decimal;
  /** 11. Rebate under section 87A. */
  rebateSection87A: Decimal;
  /** 12. Surcharge, where applicable. */
  surcharge: Decimal;
  /** 13. Health and education cess. */
  healthAndEducationCess: Decimal;
  /** 14. Total tax payable. */
  totalTaxPayable: Decimal;
  /** 15a. Tax deducted at source by this employer. */
  taxDeductedByEmployer: Decimal;
  /** 15b. Tax reported as deducted by a previous employer. */
  taxDeductedByPreviousEmployer: Decimal;
  /** 15. Total tax deducted. */
  totalTaxDeducted: Decimal;

  balanceTaxPayable: Decimal;
  refundDue: Decimal;

  /** Informational: the employee's own PF, which often qualifies under 80C. */
  providentFundEmployeeContribution: Decimal;

  quarterlyTds: Form16Quarter[];
  notes: string[];
}

/** What the FY payslip read returns; narrowed so the aggregation stays honest. */
interface PayslipRow {
  grossPay: Decimal | number | string;
  professionalTax: Decimal | number | string;
  tds: Decimal | number | string;
  pfEmployee: Decimal | number | string;
  payrollRun: { month: number; year: number } | null;
}

@Injectable()
export class Form16Service {
  private readonly logger = new Logger(Form16Service.name);

  constructor(private prisma: PrismaService) {}

  /**
   * The Part B computation for one employee for one financial year.
   *
   * The liability comes from `calculateIncomeTax`, the same function the
   * monthly TDS engine calls, fed with the year's actual totals instead of a
   * projection. The numbered lines below are a re-presentation of that single
   * computation in the layout the form uses, not a second computation: the sum
   * of lines 2, 4 and 8 is exactly the deduction total the calculator applied,
   * so line 9 and the calculator's taxable income are the same number.
   *
   * A year with no payslips yields a nil certificate with a note rather than an
   * error, because "this employee earned nothing from us this year" is a real
   * and reportable answer, not a failure.
   */
  async computePartB(
    tenantId: string,
    employeeId: string,
    financialYear: number,
    requester: Pick<AuthenticatedUser, 'role' | 'employeeId'>,
  ): Promise<Form16PartB> {
    this.assertMayRead(requester, employeeId);

    const notes: string[] = [TRACES_NOTE];

    const employee = await this.loadEmployee(tenantId, employeeId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        legalName: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        pinCode: true,
        country: true,
        pan: true,
        tan: true,
      },
    });

    const payslips = await this.loadFyPayslips(tenantId, employeeId, financialYear);

    const declaration = await this.prisma.employeeTaxDeclaration.findUnique({
      where: {
        tenantId_employeeId_financialYear: { tenantId, employeeId, financialYear },
      },
    });

    const statutoryConfig = await this.prisma.statutoryConfig.findUnique({
      where: { tenantId },
      select: {
        defaultTaxRegime: true,
        proofVerificationRequired: true,
        proofCutoffMonth: true,
      },
    });

    // The employee's own election wins, then whatever they declared, then the
    // tenant default. The same order the monthly TDS engine resolves.
    const regime: TaxRegime =
      (employee.taxRegime as TaxRegime | null) ??
      (declaration?.regime as TaxRegime | undefined) ??
      (statutoryConfig?.defaultTaxRegime as TaxRegime | undefined) ??
      TaxRegime.NEW;

    const isOldRegime = regime === TaxRegime.OLD;

    // ---- Aggregate the year -------------------------------------------------
    const totals = payslips.reduce(
      (acc, p) => ({
        gross: acc.gross.add(new Decimal(p.grossPay as never)),
        professionalTax: acc.professionalTax.add(new Decimal(p.professionalTax as never)),
        tds: acc.tds.add(new Decimal(p.tds as never)),
        pfEmployee: acc.pfEmployee.add(new Decimal(p.pfEmployee as never)),
      }),
      { gross: ZERO, professionalTax: ZERO, tds: ZERO, pfEmployee: ZERO },
    );

    const declared = {
      section80C: new Decimal(declaration?.section80C ?? 0),
      section80D: new Decimal(declaration?.section80D ?? 0),
      section80CCD1B: new Decimal(declaration?.section80CCD1B ?? 0),
      section80CCD2: new Decimal(declaration?.section80CCD2 ?? 0),
      hraExemption: new Decimal(declaration?.hraExemption ?? 0),
      // The section 10 heads, read exactly as the monthly TDS engine reads
      // them, so the certificate and the payslips are fed the same figures.
      ltaExemption: new Decimal(declaration?.ltaExemption ?? 0),
      childrenEducationAllowance: new Decimal(declaration?.childrenEducationAllowance ?? 0),
      hostelAllowance: new Decimal(declaration?.hostelAllowance ?? 0),
      childrenCount: declaration?.childrenCount ?? 0,
      homeLoanInterest: new Decimal(declaration?.homeLoanInterest ?? 0),
      otherDeductions: new Decimal(declaration?.otherDeductions ?? 0),
      otherIncome: new Decimal(declaration?.otherIncome ?? 0),
      previousEmployerTds: new Decimal(declaration?.previousEmployerTds ?? 0),
    };

    // Once the employer requires proofs, the year's TDS was computed from what
    // was approved rather than from what was declared. A certificate built on
    // the declaration would show more exempt than the payslips allowed, and a
    // certificate that disagrees with the year's payslips is worse than either
    // being wrong on its own. Verification is judged at March, the last month
    // of the financial year, because that is the position the year closed on.
    if (statutoryConfig?.proofVerificationRequired) {
      const inForceByYearEnd = verificationApplies({
        proofVerificationRequired: true,
        proofCutoffMonth: statutoryConfig.proofCutoffMonth ?? 1,
        payrollMonth: 3,
      });

      if (inForceByYearEnd) {
        const verified = await readApprovedProofTotals(
          this.prisma,
          tenantId,
          employeeId,
          financialYear,
        );
        // Every proof-backed head, not only the ones with a proof: an
        // unproved head allows nothing, exactly as it did on the payslips.
        for (const field of PROOF_BACKED_FIELDS) {
          const amount = verified[field] ?? 0;
          // Only the money fields are proof-backed; childrenCount is a count
          // and stays declared, because a fee receipt says what was paid, not
          // how many children there are.
          (declared as unknown as Record<string, Decimal>)[field] = new Decimal(
            amount,
          );
        }
        notes.push(
          'Your employer requires proof of a claimed deduction, so the figures here are what was accepted on the evidence you filed, not what you declared.',
        );
      }
    }

    // Age is read as at 31 March of the financial year, matching the monthly
    // TDS engine exactly, so a certificate cannot disagree with the payslips
    // it is meant to summarise over which band applied.
    const ageBandRequested = ageBandOn31March(employee.dateOfBirth, financialYear);

    const resolvedTaxConfig = await resolveIncomeTaxConfig(
      this.prisma,
      tenantId,
      financialYear,
      regime,
      ageBandRequested,
      (requestedBand) => {
        this.logger.warn(
          `No ${requestedBand} income tax configuration for tenant ${tenantId}, FY ${financialYear}, ` +
            `${regime} regime; Form 16 falling back to GENERAL slabs.`,
        );
        notes.push(
          `No ${requestedBand} income tax configuration is seeded for FY ${financialYearLabel(financialYear)} ` +
            `under the ${regime} regime, so GENERAL slabs were used for this certificate instead. That may ` +
            'deduct more than a band-specific slab would have; it is not a shortfall in the employee\'s favour.',
        );
      },
    );
    const taxConfig = resolvedTaxConfig?.taxConfig ?? null;
    const ageBand = resolvedTaxConfig?.ageBandUsed ?? ageBandRequested;
    const ageBandFallbackApplied = resolvedTaxConfig?.ageBandFallback ?? false;

    // ---- Line 4: deductions under section 16 --------------------------------
    // Entertainment allowance under 16(ii) is not modelled: it is available
    // only to government employees.
    const standardDeduction = new Decimal(taxConfig?.standardDeduction ?? 0);
    const section16ProfessionalTax = isOldRegime ? totals.professionalTax : ZERO;
    const section16Total = standardDeduction.add(section16ProfessionalTax);

    // ---- Line 2: exemptions under section 10 --------------------------------
    // House rent, leave travel and the two allowances for children. The last
    // two are ceilinged per child per month, and the ceilings come from the
    // year's row; a row seeded before those columns existed falls back to the
    // statutory figures, which are also the schema's defaults.
    //
    // Computed by the calculator's own function rather than added up here, so
    // line 2 is arithmetically the same figure the calculator deducted — and
    // so a certificate with no slabs to price still caps what it reports.
    // Gratuity and leave encashment exemptions are settled on exit rather than
    // in payroll and are not carried here; see the caveats note.
    const section10Limits: Section10AllowanceLimits | undefined = taxConfig
      ? {
          childrenEducationMonthlyLimit: new Decimal(
            taxConfig.childrenEducationMonthlyLimit ?? 100,
          ),
          hostelAllowanceMonthlyLimit: new Decimal(taxConfig.hostelAllowanceMonthlyLimit ?? 300),
          maxChildren: taxConfig.childrenAllowanceMaxChildren ?? 2,
        }
      : undefined;

    const section10Exemptions = calculateSection10Exemptions(
      declared,
      isOldRegime,
      section10Limits,
    );
    const allowancesExempt = section10Exemptions.reduce((sum, e) => sum.add(e.allowed), ZERO);

    // ---- Line 6: other heads -------------------------------------------------
    // Home loan interest is a loss from house property, so it enters as a
    // negative income rather than as a Chapter VI-A deduction.
    const incomeFromHouseProperty = isOldRegime ? declared.homeLoanInterest.neg() : ZERO;

    // ---- Lines 10 to 14: the liability ---------------------------------------
    // Computed before lines 2-9 are laid out, not after: line 8's chapter
    // VI-A figures must be what the calculator actually allowed (capped at
    // the year's ceilings), not the raw declaration, or this certificate
    // could show a total income the payslips' own TDS was never computed
    // against. See the module note on why one calculation feeds both.
    let computed: IncomeTaxResult | null = null;

    if (!taxConfig || taxConfig.slabs.length === 0) {
      // Without slabs there is no defensible liability to state. The salary and
      // the tax actually deducted are still reported; only the liability is
      // unknown, and the reader is told why.
      this.logger.warn(
        `No income tax configuration for tenant ${tenantId}, FY ${financialYear}, ${regime} regime; Form 16 Part B liability left nil.`,
      );
      notes.push(
        `No income tax slabs are configured for FY ${financialYearLabel(financialYear)} under the ` +
          `${regime} regime, so the tax on total income could not be computed and lines 10 to 14 ` +
          'are shown as nil. Configure the year\'s income tax configuration and regenerate.',
      );
    } else {
      // Same vocabulary as the monthly TDS engine: the ceilings cap what the
      // calculator allows, not what this file computes, so a certificate and
      // its payslips cannot disagree over where a ceiling bound.
      const limits: DeductionLimits = {
        section80C: new Decimal(taxConfig.section80CLimit ?? 150000),
        section80D: new Decimal(taxConfig.section80DLimit ?? 25000),
        section80CCD1B: new Decimal(taxConfig.section80CCD1BLimit ?? 50000),
      };
      const marginalReliefEnabled = taxConfig.marginalReliefEnabled ?? true;

      // A plain variable, not a fresh object literal at the call site, so
      // this keeps compiling while the calculator's own parameter shape is
      // still being extended to read `limits` and `marginalReliefEnabled`.
      const taxConfigInput = {
        regime,
        standardDeduction,
        rebateIncomeLimit: new Decimal(taxConfig.rebateIncomeLimit),
        rebateMaxAmount: new Decimal(taxConfig.rebateMaxAmount),
        cessRate: new Decimal(taxConfig.cessRate),
        surchargeSlabs:
          (taxConfig.surchargeSlabs as unknown as { threshold: number; rate: number }[]) ?? [],
        slabs: taxConfig.slabs.map((s) => ({
          fromAmount: new Decimal(s.fromAmount),
          toAmount: s.toAmount === null ? null : new Decimal(s.toAmount),
          rate: new Decimal(s.rate),
        })),
        ageBand,
        limits,
        // The same ceilings line 2 was built from, so the calculator's own
        // section 10 total and this certificate's line 2 cannot differ.
        section10Limits,
        marginalReliefEnabled,
      };

      computed = calculateIncomeTax(totals.gross, taxConfigInput, declared, totals.professionalTax);
    }

    // ---- Line 8: Chapter VI-A ------------------------------------------------
    // 80C, 80D and 80CCD(1B) come from what the calculator actually allowed
    // after capping at the year's ceilings, not the raw declaration — the sum
    // of lines 2, 4 and 8 must be exactly the deduction total the calculator
    // applied, or this certificate could disagree with the payslips it
    // summarises. Without a computation to draw on (no slabs configured) the
    // raw declared figures are shown instead, uncapped, matching what the
    // nil-liability certificate has always presented.
    const capByStatute = new Map(computed?.chapterVIACaps.map((c) => [c.section, c]) ?? []);
    const chapterVIA: Form16ChapterVIA = {
      section80C: computed
        ? (capByStatute.get('80C')?.allowed ?? ZERO)
        : isOldRegime ? declared.section80C : ZERO,
      section80D: computed
        ? (capByStatute.get('80D')?.allowed ?? ZERO)
        : isOldRegime ? declared.section80D : ZERO,
      section80CCD1B: computed
        ? (capByStatute.get('80CCD(1B)')?.allowed ?? ZERO)
        : isOldRegime ? declared.section80CCD1B : ZERO,
      // Allowed under both regimes, and has no statutory ceiling of its own.
      section80CCD2: declared.section80CCD2,
      otherDeductions: isOldRegime ? declared.otherDeductions : ZERO,
      total: ZERO,
    };
    chapterVIA.total = chapterVIA.section80C
      .add(chapterVIA.section80D)
      .add(chapterVIA.section80CCD1B)
      .add(chapterVIA.section80CCD2)
      .add(chapterVIA.otherDeductions);

    const balance = totals.gross.sub(allowancesExempt);
    const incomeChargeableUnderSalaries = balance.sub(section16Total);
    const grossTotalIncome = incomeChargeableUnderSalaries
      .add(declared.otherIncome)
      .add(incomeFromHouseProperty);
    const totalIncome = Decimal.max(grossTotalIncome.sub(chapterVIA.total), ZERO);

    // The two routes to taxable income must agree by construction now that
    // line 8 is built from the same capped figures the calculator used. Kept
    // as a check anyway: it is a cheap regression guard if that ever stops
    // being true, and the certificate says so rather than printing silently.
    if (computed && !computed.taxableIncome.equals(totalIncome)) {
      this.logger.warn(
        `Form 16 Part B line 9 (${totalIncome.toFixed(2)}) differs from the computed taxable ` +
          `income (${computed.taxableIncome.toFixed(2)}) for employee ${employeeId}, FY ${financialYear}.`,
      );
      notes.push(
        `Line 9 (${totalIncome.toFixed(2)}) does not reconcile with the taxable income the tax ` +
          `engine used (${computed.taxableIncome.toFixed(2)}). Have this checked before issuing.`,
      );
    }

    const taxOnTotalIncome = computed?.taxBeforeRebate ?? ZERO;
    const rebate = computed?.rebate ?? ZERO;
    const surcharge = computed?.surcharge ?? ZERO;
    const cess = computed?.cess ?? ZERO;
    const totalTaxPayable = computed?.totalTax ?? ZERO;

    const totalTaxDeducted = totals.tds.add(declared.previousEmployerTds);
    const shortfall = totalTaxPayable.sub(totalTaxDeducted);

    // ---- Notes ---------------------------------------------------------------
    if (payslips.length === 0) {
      notes.push(
        `There is no payslip for this employee in FY ${financialYearLabel(financialYear)}, so a nil ` +
          'certificate is returned. Nothing was paid and nothing was deducted by this employer in ' +
          'that year.',
      );
    } else if (payslips.length < 12) {
      notes.push(
        `Only ${payslips.length} of the 12 months in FY ${financialYearLabel(financialYear)} have a ` +
          'payslip. Confirm this matches the employment period before issuing.',
      );
    }

    if (!tenant?.tan) {
      notes.push(
        'The employer TAN is not set on the tenant. A Form 16 cannot be issued without it.',
      );
    }
    if (!tenant?.pan) {
      notes.push('The employer PAN is not set on the tenant.');
    }
    if (!employee.pan) {
      notes.push(
        'The employee PAN is not on record. Without it the deduction is liable to the higher rate ' +
          'under section 206AA and the credit will not reach the employee.',
      );
    }
    if (!declaration) {
      notes.push(
        `No tax declaration is on record for FY ${financialYearLabel(financialYear)}; every ` +
          'exemption and Chapter VI-A deduction is therefore nil.',
      );
    }
    if (isOldRegime && totals.pfEmployee.gt(0)) {
      notes.push(
        `The employee contributed ${totals.pfEmployee.toFixed(2)} to provident fund this year. ` +
          'That qualifies under section 80C but is NOT added automatically; it counts only to the ' +
          'extent the declared 80C figure already includes it.',
      );
    }
    notes.push(
      'Declared amounts are passed to the same tax calculator the monthly TDS engine uses, which ' +
        "applies the year's Chapter VI-A ceilings, the section 10(14) per-child ceilings and any " +
        'marginal relief on surcharge; this certificate does not compute any of them itself. Line 2 ' +
        'covers house rent, leave travel and the two allowances for children; exemptions settled on ' +
        'exit, such as gratuity and leave encashment, are not tracked here.',
    );

    const trimmed = section10Exemptions.filter((e) => e.disallowed.gt(0));
    if (trimmed.length > 0) {
      notes.push(
        'Line 2 allows less than was claimed under ' +
          trimmed
            .map(
              (e) =>
                `${e.head} (claimed ${e.declared.toFixed(2)}, allowed ${e.allowed.toFixed(2)})`,
            )
            .join(', ') +
          '. The section 10(14) allowances are capped per child, per month, for at most ' +
          `${section10Limits?.maxChildren ?? 2} children.`,
      );
    }

    return {
      financialYear,
      financialYearLabel: financialYearLabel(financialYear),
      assessmentYear: assessmentYearLabel(financialYear),
      ...this.certificatePeriod(financialYear, employee.joinDate),
      regime,
      ageBand,
      ageBandFallbackApplied,
      employer: {
        name: tenant?.legalName ?? tenant?.name ?? '',
        address: this.formatAddress(tenant),
        tan: tenant?.tan ?? null,
        pan: tenant?.pan ?? null,
      },
      employee: this.employeeBlock(employee),

      hasPayslipsInYear: payslips.length > 0,
      payslipCount: payslips.length,

      grossSalary: totals.gross,
      allowancesExemptSection10: allowancesExempt,
      allowancesExemptSection10Breakdown: section10Exemptions,
      balance,
      deductionsSection16: {
        standardDeduction,
        professionalTax: section16ProfessionalTax,
        total: section16Total,
      },
      incomeChargeableUnderSalaries,
      otherIncome: declared.otherIncome,
      incomeFromHouseProperty,
      grossTotalIncome,
      deductionsChapterVIA: chapterVIA,
      totalIncome,
      taxOnTotalIncome,
      rebateSection87A: rebate,
      surcharge,
      healthAndEducationCess: cess,
      totalTaxPayable,
      taxDeductedByEmployer: totals.tds,
      taxDeductedByPreviousEmployer: declared.previousEmployerTds,
      totalTaxDeducted,

      balanceTaxPayable: Decimal.max(shortfall, ZERO),
      refundDue: Decimal.max(shortfall.neg(), ZERO),

      providentFundEmployeeContribution: totals.pfEmployee,

      quarterlyTds: this.bucketByQuarter(payslips),
      notes,
    };
  }

  /**
   * Tax deducted in each quarter of the financial year.
   *
   * This exists because Part A — where these figures normally appear alongside
   * the challan and TRACES receipt numbers — is not ours to produce. What is
   * ours is the deduction itself, so the summary reports that and leaves the
   * receipt numbers explicitly null rather than inventing plausible ones.
   */
  async getQuarterlyTdsSummary(
    tenantId: string,
    employeeId: string,
    financialYear: number,
    requester: Pick<AuthenticatedUser, 'role' | 'employeeId'>,
  ): Promise<QuarterlyTdsSummary> {
    this.assertMayRead(requester, employeeId);

    const employee = await this.loadEmployee(tenantId, employeeId);
    const payslips = await this.loadFyPayslips(tenantId, employeeId, financialYear);
    const quarters = this.bucketByQuarter(payslips);

    const notes = [
      TRACES_NOTE,
      'The quarterly receipt numbers are issued by TRACES against a filed Form 24Q and are ' +
        'therefore null here. Reconcile these figures against the filed returns before relying ' +
        'on them.',
    ];

    if (payslips.length === 0) {
      notes.push(
        `There is no payslip for this employee in FY ${financialYearLabel(financialYear)}; every ` +
          'quarter is nil.',
      );
    }

    return {
      financialYear,
      financialYearLabel: financialYearLabel(financialYear),
      employee: this.employeeBlock(employee),
      quarters,
      totalAmountPaid: quarters.reduce((sum, q) => sum.add(q.amountPaid), ZERO),
      totalTaxDeducted: quarters.reduce((sum, q) => sum.add(q.taxDeducted), ZERO),
      notes,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Admins read anyone in their tenant; everybody else reads only themselves.
   *
   * Checked before any query runs, so a caller probing for a colleague's
   * certificate cannot learn from the response whether that employee exists.
   * Managers are deliberately not given team scope: a subordinate's tax
   * position is not a line-management concern.
   */
  private assertMayRead(
    requester: Pick<AuthenticatedUser, 'role' | 'employeeId'>,
    employeeId: string,
  ): void {
    const isAdmin =
      requester.role === UserRole.SUPER_ADMIN || requester.role === UserRole.HR_ADMIN;

    if (isAdmin) return;

    if (!requester.employeeId || requester.employeeId !== employeeId) {
      throw new ForbiddenException('You can only access your own Form 16');
    }
  }

  private async loadEmployee(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        pan: true,
        designation: { select: { name: true } },
        taxRegime: true,
        joinDate: true,
        dateOfBirth: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  /**
   * Every payslip whose payroll run falls in the April-to-March window.
   *
   * The run's month and year decide the year, not the payslip's own timestamps,
   * because a March run processed in April still belongs to the closing year.
   */
  private async loadFyPayslips(
    tenantId: string,
    employeeId: string,
    financialYear: number,
  ): Promise<PayslipRow[]> {
    return this.prisma.payslip.findMany({
      where: {
        tenantId,
        employeeId,
        payrollRun: {
          OR: [
            { year: financialYear, month: { gte: 4 } },
            { year: financialYear + 1, month: { lte: 3 } },
          ],
        },
      },
      select: {
        grossPay: true,
        professionalTax: true,
        tds: true,
        pfEmployee: true,
        payrollRun: { select: { month: true, year: true } },
      },
    }) as unknown as Promise<PayslipRow[]>;
  }

  /** All four quarters, always, so an empty one reads as nil rather than missing. */
  private bucketByQuarter(payslips: PayslipRow[]): Form16Quarter[] {
    return ([1, 2, 3, 4] as const).map((q) => {
      const inQuarter = payslips.filter(
        (p) => p.payrollRun !== null && quarterOfFy(p.payrollRun.month) === q,
      );

      return {
        quarter: `Q${q}` as Form16Quarter['quarter'],
        months: QUARTER_MONTHS[q].map((m) => MONTH_NAMES[m]),
        amountPaid: inQuarter.reduce((s, p) => s.add(new Decimal(p.grossPay as never)), ZERO),
        taxDeducted: inQuarter.reduce((s, p) => s.add(new Decimal(p.tds as never)), ZERO),
        payslipCount: inQuarter.length,
        tracesReceiptNumber: null,
      };
    });
  }

  private employeeBlock(employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    pan: string | null;
    designation: { name: string } | null;
  }): Form16Employee {
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      pan: employee.pan ?? null,
      designation: employee.designation?.name ?? null,
    };
  }

  /**
   * The period the certificate covers: the financial year, or the part of it
   * the employee was on the payroll for if they joined part-way through.
   */
  private certificatePeriod(
    financialYear: number,
    joinDate: Date | null | undefined,
  ): { periodFrom: string; periodTo: string } {
    const fyStart = new Date(Date.UTC(financialYear, 3, 1));
    const fyEnd = new Date(Date.UTC(financialYear + 1, 2, 31));

    const from = joinDate && joinDate > fyStart && joinDate < fyEnd ? joinDate : fyStart;

    return { periodFrom: isoDate(from), periodTo: isoDate(fyEnd) };
  }

  private formatAddress(
    tenant: {
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: string | null;
      pinCode: string | null;
      country: string | null;
    } | null,
  ): string {
    if (!tenant) return '';
    return [
      tenant.addressLine1,
      tenant.addressLine2,
      tenant.city,
      tenant.state,
      tenant.pinCode,
      tenant.country,
    ]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');
  }
}

/** YYYY-MM-DD in UTC, so a certificate period never shifts a day by timezone. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
