import { Decimal } from '@prisma/client/runtime/library';
import { AccountingCostCenterMode } from '@prisma/client';
import { classifyPayslipLine, PayslipLine, PayslipLineKind } from '../payroll-lines.types';
import { GlKeyCategory, GlSystemKey, JournalLine, JournalSide } from './accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7): pure journal-building logic. No Prisma, no
 * NestJS — everything the service layer needs to fetch is passed in, so this
 * is exercised entirely with specs constructing plain objects.
 */

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toDecimal(value: Decimal | number | string): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Metadata for every system key: what it is, and which side of the journal it lives on. */
export const GL_SYSTEM_KEY_META: Record<GlSystemKey, { label: string; category: GlKeyCategory; side: JournalSide }> = {
  BASIC: { label: 'Basic pay', category: 'EARNING', side: 'DEBIT' },
  OT_PAY: { label: 'Overtime pay', category: 'EARNING', side: 'DEBIT' },
  ARREARS: { label: 'Arrears', category: 'EARNING', side: 'DEBIT' },
  REIMBURSEMENT: { label: 'Reimbursements', category: 'EARNING', side: 'DEBIT' },
  HOLD_RELEASE: { label: 'Held salary release', category: 'EARNING', side: 'DEBIT' },
  ONE_TIME_EARNING: { label: 'One-time earning (unmapped)', category: 'EARNING', side: 'DEBIT' },
  SETTLEMENT_EARNING: { label: 'Settlement earning (unmapped)', category: 'EARNING', side: 'DEBIT' },
  ARREARS_RECOVERY: { label: 'Arrears recovery', category: 'DEDUCTION', side: 'CREDIT' },
  ONE_TIME_DEDUCTION: { label: 'One-time deduction (unmapped)', category: 'DEDUCTION', side: 'CREDIT' },
  SETTLEMENT_RECOVERY: { label: 'Settlement recovery (unmapped)', category: 'DEDUCTION', side: 'CREDIT' },
  PF_EMPLOYEE: { label: 'Provident fund (employee)', category: 'DEDUCTION', side: 'CREDIT' },
  ESI_EMPLOYEE: { label: 'ESI (employee)', category: 'DEDUCTION', side: 'CREDIT' },
  PROFESSIONAL_TAX: { label: 'Professional tax', category: 'DEDUCTION', side: 'CREDIT' },
  LWF_EMPLOYEE: { label: 'Labour welfare fund (employee)', category: 'DEDUCTION', side: 'CREDIT' },
  TDS: { label: 'TDS', category: 'DEDUCTION', side: 'CREDIT' },
  LOAN_RECOVERY: { label: 'Loan / advance recovery', category: 'DEDUCTION', side: 'CREDIT' },
  PF_EMPLOYER: { label: 'Provident fund (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  PF_EMPLOYER_PAYABLE: { label: 'Provident fund payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  EPS_EMPLOYER: { label: 'EPS (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  EPS_EMPLOYER_PAYABLE: { label: 'EPS payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  EDLI_EMPLOYER: { label: 'EDLI (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  EDLI_EMPLOYER_PAYABLE: { label: 'EDLI payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  PF_ADMIN_EMPLOYER: { label: 'PF admin charges (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  PF_ADMIN_EMPLOYER_PAYABLE: { label: 'PF admin charges payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  ESI_EMPLOYER: { label: 'ESI (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  ESI_EMPLOYER_PAYABLE: { label: 'ESI payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  LWF_EMPLOYER: { label: 'Labour welfare fund (employer)', category: 'EMPLOYER_EXPENSE', side: 'DEBIT' },
  LWF_EMPLOYER_PAYABLE: { label: 'Labour welfare fund payable (employer)', category: 'EMPLOYER_PAYABLE', side: 'CREDIT' },
  NET_PAY: { label: 'Net pay', category: 'NET', side: 'CREDIT' },
  HELD_SALARY: { label: 'Held salary', category: 'NET', side: 'CREDIT' },
};

/**
 * The candidate GL keys to try, in order, for one payslip line, plus the key
 * to report when none of them are mapped. See spec C7's journal table:
 * COMPONENT/ONE_TIME/SETTLEMENT resolve by line name first (ONE_TIME and
 * SETTLEMENT fall back to a system key); ARREAR/REIMBURSEMENT/HOLD_RELEASE/LOAN
 * always resolve to a fixed system key, never by name.
 */
export function lineCandidates(
  kind: PayslipLineKind,
  side: 'earning' | 'deduction',
  name: string,
): { candidates: string[]; reportKey: string; category: GlKeyCategory } {
  const category: GlKeyCategory = side === 'earning' ? 'EARNING' : 'DEDUCTION';
  switch (kind) {
    case 'COMPONENT':
      return { candidates: [name], reportKey: name, category };
    case 'ARREAR': {
      const key = side === 'earning' ? 'ARREARS' : 'ARREARS_RECOVERY';
      return { candidates: [key], reportKey: key, category };
    }
    case 'ONE_TIME': {
      const fallback = side === 'earning' ? 'ONE_TIME_EARNING' : 'ONE_TIME_DEDUCTION';
      return { candidates: [name, fallback], reportKey: fallback, category };
    }
    case 'REIMBURSEMENT':
      return { candidates: ['REIMBURSEMENT'], reportKey: 'REIMBURSEMENT', category };
    case 'HOLD_RELEASE':
      return { candidates: ['HOLD_RELEASE'], reportKey: 'HOLD_RELEASE', category };
    case 'SETTLEMENT': {
      const fallback = side === 'earning' ? 'SETTLEMENT_EARNING' : 'SETTLEMENT_RECOVERY';
      return { candidates: [name, fallback], reportKey: fallback, category };
    }
    case 'LOAN':
      return { candidates: ['LOAN_RECOVERY'], reportKey: 'LOAN_RECOVERY', category };
    case 'STATUTORY':
      // Never reached: statutory deduction lines are skipped by the caller in
      // favour of the dedicated Payslip columns, which are the source of truth.
      return { candidates: [], reportKey: name, category };
    default:
      return { candidates: [name], reportKey: name, category };
  }
}

export interface GlMapping {
  glCode: string;
  glName: string;
}

export interface JournalMappingConfig {
  /** componentKey -> GL account. */
  mappings: Map<string, GlMapping>;
  suspense: GlMapping | null;
  costCenterMode: AccountingCostCenterMode;
  allowUnmapped: boolean;
}

/** One payslip's inputs to the journal, already resolved from Prisma rows. */
export interface JournalPayslipInput {
  employeeId: string;
  departmentName: string | null;
  branchName: string | null;
  basePay: Decimal | number;
  otPay: Decimal | number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  netPay: Decimal | number;
  pfEmployee: Decimal | number;
  esiEmployee: Decimal | number;
  professionalTax: Decimal | number;
  lwfEmployee: Decimal | number;
  tds: Decimal | number;
  pfEmployer: Decimal | number;
  epsEmployer: Decimal | number;
  edliEmployer: Decimal | number;
  pfAdminEmployer: Decimal | number;
  esiEmployer: Decimal | number;
  lwfEmployer: Decimal | number;
  /** True when a SalaryHold (HELD, VOIDED or RELEASED) exists for this employee in this run. */
  held: boolean;
}

export interface BuiltJournal {
  lines: JournalLine[];
  totalDebit: Decimal;
  totalCredit: Decimal;
  balanced: boolean;
  unmappedKeys: string[];
}

interface Accumulator {
  glCode: string;
  glName: string;
  costCenter: string | null;
  side: JournalSide;
  debit: Decimal;
  credit: Decimal;
  componentKeys: Set<string>;
}

const EMPLOYER_CONTRIBUTIONS: { column: keyof JournalPayslipInput; expenseKey: GlSystemKey; payableKey: GlSystemKey }[] = [
  { column: 'pfEmployer', expenseKey: 'PF_EMPLOYER', payableKey: 'PF_EMPLOYER_PAYABLE' },
  { column: 'epsEmployer', expenseKey: 'EPS_EMPLOYER', payableKey: 'EPS_EMPLOYER_PAYABLE' },
  { column: 'edliEmployer', expenseKey: 'EDLI_EMPLOYER', payableKey: 'EDLI_EMPLOYER_PAYABLE' },
  { column: 'pfAdminEmployer', expenseKey: 'PF_ADMIN_EMPLOYER', payableKey: 'PF_ADMIN_EMPLOYER_PAYABLE' },
  { column: 'esiEmployer', expenseKey: 'ESI_EMPLOYER', payableKey: 'ESI_EMPLOYER_PAYABLE' },
  { column: 'lwfEmployer', expenseKey: 'LWF_EMPLOYER', payableKey: 'LWF_EMPLOYER_PAYABLE' },
];

const STATUTORY_COLUMNS: { column: keyof JournalPayslipInput; key: GlSystemKey }[] = [
  { column: 'pfEmployee', key: 'PF_EMPLOYEE' },
  { column: 'esiEmployee', key: 'ESI_EMPLOYEE' },
  { column: 'professionalTax', key: 'PROFESSIONAL_TAX' },
  { column: 'lwfEmployee', key: 'LWF_EMPLOYEE' },
  { column: 'tds', key: 'TDS' },
];

/**
 * Builds the aggregated journal for one payroll run. Pure function: no I/O,
 * everything is passed in already loaded. See spec C7 for the resolution and
 * aggregation rules.
 */
export function buildJournal(
  payslips: JournalPayslipInput[],
  config: JournalMappingConfig,
): BuiltJournal {
  const lines = new Map<string, Accumulator>();
  const unmappedKeys = new Set<string>();

  const costCenterFor = (payslip: JournalPayslipInput): string | null => {
    if (config.costCenterMode === 'NONE') return null;
    if (config.costCenterMode === 'DEPARTMENT') return payslip.departmentName ?? 'Unassigned';
    return payslip.branchName ?? 'Unassigned';
  };

  const addEntry = (
    candidates: string[],
    reportKey: string,
    side: JournalSide,
    amount: Decimal,
    costCenter: string | null,
  ) => {
    if (amount.isZero()) return;

    let glCode: string | null = null;
    let glName: string | null = null;
    let usedKey: string | null = null;
    for (const candidate of candidates) {
      const mapping = config.mappings.get(candidate);
      if (mapping) {
        glCode = mapping.glCode;
        glName = mapping.glName;
        usedKey = candidate;
        break;
      }
    }

    if (!usedKey) {
      unmappedKeys.add(reportKey);
      if (config.suspense && config.allowUnmapped) {
        glCode = config.suspense.glCode;
        glName = config.suspense.glName;
        usedKey = reportKey;
      } else {
        return;
      }
    }

    const mapKey = `${glCode}::${costCenter ?? ''}::${side}`;
    let entry = lines.get(mapKey);
    if (!entry) {
      entry = {
        glCode: glCode!,
        glName: glName!,
        costCenter,
        side,
        debit: new Decimal(0),
        credit: new Decimal(0),
        componentKeys: new Set(),
      };
      lines.set(mapKey, entry);
    }
    if (side === 'DEBIT') entry.debit = entry.debit.add(amount);
    else entry.credit = entry.credit.add(amount);
    entry.componentKeys.add(usedKey);
  };

  const addSystemEntry = (key: GlSystemKey, amount: Decimal, costCenter: string | null) => {
    const meta = GL_SYSTEM_KEY_META[key];
    addEntry([key], key, meta.side, amount, costCenter);
  };

  for (const payslip of payslips) {
    const costCenter = costCenterFor(payslip);

    addSystemEntry('BASIC', money(toDecimal(payslip.basePay)), costCenter);
    addSystemEntry('OT_PAY', money(toDecimal(payslip.otPay)), costCenter);

    for (const line of payslip.earnings) {
      const kind = classifyPayslipLine(line, 'earning');
      const { candidates, reportKey } = lineCandidates(kind, 'earning', line.name);
      addEntry(candidates, reportKey, 'DEBIT', money(new Decimal(line.amount)), costCenter);
    }

    for (const line of payslip.deductions) {
      const kind = classifyPayslipLine(line, 'deduction');
      // Statutory lines duplicate the dedicated Payslip columns below; skip
      // them here to avoid counting the same deduction twice.
      if (kind === 'STATUTORY') continue;
      const { candidates, reportKey } = lineCandidates(kind, 'deduction', line.name);
      addEntry(candidates, reportKey, 'CREDIT', money(new Decimal(line.amount)), costCenter);
    }

    for (const { column, key } of STATUTORY_COLUMNS) {
      addSystemEntry(key, money(toDecimal(payslip[column] as Decimal | number)), costCenter);
    }

    for (const { column, expenseKey, payableKey } of EMPLOYER_CONTRIBUTIONS) {
      const amount = money(toDecimal(payslip[column] as Decimal | number));
      if (amount.isZero()) continue;
      addSystemEntry(expenseKey, amount, costCenter);
      addSystemEntry(payableKey, amount, costCenter);
    }

    const netKey: GlSystemKey = payslip.held ? 'HELD_SALARY' : 'NET_PAY';
    addSystemEntry(netKey, money(toDecimal(payslip.netPay)), costCenter);
  }

  const journalLines: JournalLine[] = Array.from(lines.values()).map((entry) => ({
    glCode: entry.glCode,
    glName: entry.glName,
    costCenter: entry.costCenter,
    side: entry.side,
    debit: entry.debit.toNumber(),
    credit: entry.credit.toNumber(),
    componentKeys: Array.from(entry.componentKeys).sort(),
  }));

  const totalDebit = journalLines.reduce((sum, l) => sum.add(new Decimal(l.debit)), new Decimal(0));
  const totalCredit = journalLines.reduce((sum, l) => sum.add(new Decimal(l.credit)), new Decimal(0));

  return {
    lines: journalLines,
    totalDebit,
    totalCredit,
    balanced: totalDebit.equals(totalCredit),
    unmappedKeys: Array.from(unmappedKeys).sort(),
  };
}
