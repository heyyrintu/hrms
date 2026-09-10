/**
 * The shape of an employee tax declaration as a form: one row per figure, with
 * the wording that goes beside it.
 *
 * Both the employee's own editable declaration and payroll's read-only view of
 * an employee's declaration are built from this list, so the two cannot drift
 * apart and label the same figure differently.
 */

import { ALLOWED_UNDER_NEW_REGIME } from '@/types';
import type { EmployeeTaxDeclaration, UpsertTaxDeclarationPayload } from '@/types';

/**
 * The twelve rupee figures a declaration carries. Regime and year are not
 * amounts, and neither is `childrenCount`: it is a count of children, not
 * money, and is handled separately below rather than folded in here.
 */
export type DeclarationAmountKey =
  | 'section80C'
  | 'section80D'
  | 'section80CCD1B'
  | 'section80CCD2'
  | 'hraExemption'
  | 'ltaExemption'
  | 'childrenEducationAllowance'
  | 'hostelAllowance'
  | 'homeLoanInterest'
  | 'otherDeductions'
  | 'otherIncome'
  | 'previousEmployerTds';

export interface DeclarationFieldSpec {
  key: DeclarationAmountKey;
  /** Used in labels and, verbatim, in the message when the entry is refused. */
  label: string;
  hint: string;
  /**
   * The statutory ceiling the figure is subject to, where there is one.
   *
   * Nothing enforces it. It exists so the form can say, at the point of entry,
   * that a larger figure will be accepted and will not help.
   */
  ceiling?: number;
}

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** "₹1,50,000" for 150000. Ceilings are constants written here, never parsed. */
export function formatCeiling(ceiling: number): string {
  return inrWhole.format(ceiling);
}

/**
 * Section 10(14) monthly ceilings, per child, for at most two children.
 *
 * Unlike the flat ceilings above, these cannot sit on a `DeclarationFieldSpec`
 * as a single number: the annual cap they imply depends on how many children
 * were declared, which is `childrenCount`, not a constant. The page computes
 * the effective ceiling for the year from these and shows it the same way.
 */
export const CHILDREN_EDUCATION_ALLOWANCE_MONTHLY_CEILING = 100;
export const HOSTEL_ALLOWANCE_MONTHLY_CEILING = 300;
export const CHILDREN_ALLOWANCE_MAX_CHILDREN = 2;

export const DECLARATION_FIELDS: readonly DeclarationFieldSpec[] = [
  {
    key: 'section80C',
    label: 'Section 80C',
    hint: 'Provident fund, life insurance premium, ELSS, principal on a home loan, tuition fees, and the rest of section 80C.',
    ceiling: 150000,
  },
  {
    key: 'section80D',
    label: 'Section 80D',
    hint: 'Health insurance premium for yourself, your family and your parents.',
  },
  {
    key: 'section80CCD1B',
    label: 'Section 80CCD(1B)',
    hint: 'Your own contribution to the National Pension System, over and above section 80C.',
    ceiling: 50000,
  },
  {
    key: 'section80CCD2',
    label: 'Section 80CCD(2)',
    hint: "Your employer's contribution to the National Pension System. This one applies under both regimes.",
  },
  {
    key: 'hraExemption',
    label: 'HRA exemption',
    hint: 'The exempt part of house rent allowance under section 10(13A), based on the rent you actually pay.',
  },
  {
    key: 'ltaExemption',
    label: 'LTA exemption',
    hint: 'Leave travel allowance under section 10(5): what you actually spent travelling, on a claim allowed twice in a block of four years.',
  },
  {
    key: 'childrenEducationAllowance',
    label: "Children's education allowance",
    hint: `Section 10(14): tuition-related allowance, capped at ${formatCeiling(
      CHILDREN_EDUCATION_ALLOWANCE_MONTHLY_CEILING,
    )} a month per child, for at most ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children. Set how many children below; a figure above the cap is accepted but does not reduce your tax.`,
  },
  {
    key: 'hostelAllowance',
    label: 'Hostel allowance',
    hint: `Section 10(14): allowance for a child in a boarding hostel, capped at ${formatCeiling(
      HOSTEL_ALLOWANCE_MONTHLY_CEILING,
    )} a month per child, for at most ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children. Set how many children below; a figure above the cap is accepted but does not reduce your tax.`,
  },
  {
    key: 'homeLoanInterest',
    label: 'Home loan interest',
    hint: 'Interest on a housing loan for a self-occupied property, under section 24(b).',
  },
  {
    key: 'otherDeductions',
    label: 'Other deductions',
    hint: 'Anything else under Chapter VI-A: 80E, 80G, 80TTA and the like.',
  },
  {
    key: 'otherIncome',
    label: 'Other income',
    hint: 'Income from elsewhere you want taken into account, such as bank interest. This raises the tax deducted, it does not lower it.',
  },
  {
    key: 'previousEmployerTds',
    label: 'Tax deducted by a previous employer',
    hint: 'Tax already deducted on salary paid by an earlier employer in this financial year.',
  },
];

/**
 * Whether the new regime simply disregards this figure.
 *
 * Derived from `ALLOWED_UNDER_NEW_REGIME` rather than restated, so a change to
 * what the regime allows reaches both pages without either being edited.
 */
export function isIgnoredUnderNewRegime(key: DeclarationAmountKey): boolean {
  return !ALLOWED_UNDER_NEW_REGIME.includes(key as keyof UpsertTaxDeclarationPayload);
}

/**
 * The stored figure for a field, as the decimal string the API sent.
 *
 * Nothing here parses it. The backend holds these as Prisma `Decimal` and a
 * rupee figure that has been through a float is no longer the figure stored.
 */
export function storedAmount(
  declaration: EmployeeTaxDeclaration,
  key: DeclarationAmountKey,
): string {
  return declaration[key];
}

// ---------------------------------------------------------------------------
// `childrenCount`: a count, not an amount
// ---------------------------------------------------------------------------

/**
 * How many children the employee has declared for section 10(14).
 *
 * Kept out of `DeclarationAmountKey` and `DECLARATION_FIELDS` deliberately: it
 * is a whole number of children, not a rupee figure, and formatting it as
 * money or parsing it as a decimal the way the fields above are would be
 * wrong on both ends. It drives the ceiling on `childrenEducationAllowance`
 * and `hostelAllowance` above rather than being a claim in its own right.
 */
export const CHILDREN_COUNT_FIELD = {
  key: 'childrenCount' as const,
  label: 'Number of children',
  hint: `Caps the education and hostel allowances above at, at most, ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children — declaring more children than that does not raise the cap.`,
};

export type ParsedChildrenCount = { ok: true; value: number } | { ok: false; message: string };

/**
 * Reads a declared children count.
 *
 * Blank is nil, exactly as a blank rupee figure is: nothing has been
 * declared, which is sent as zero. Anything else must be a whole,
 * non-negative number — half a child or a negative one is refused rather than
 * silently floored or clamped, the same discipline `parseDeclaredAmount`
 * applies to the rupee figures.
 */
export function parseChildrenCount(raw: string): ParsedChildrenCount {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: 0 };
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      message: `${CHILDREN_COUNT_FIELD.label} must be a whole number. "${trimmed}" is not one, so nothing was sent.`,
    };
  }
  return { ok: true, value: Number(trimmed) };
}

/**
 * The annual ceiling for a section 10(14) children's allowance, given how
 * many children were declared.
 *
 * Capped at `CHILDREN_ALLOWANCE_MAX_CHILDREN` even when more are declared, and
 * annualised over twelve months because the declaration itself is an annual
 * figure. Nothing enforces this ceiling — like the flat ones above, it exists
 * so the form can warn at the point of entry, not to block the entry.
 */
export function childrenAllowanceCeiling(monthlyLimit: number, childrenCount: number): number {
  const wholeChildren = Number.isFinite(childrenCount) ? Math.max(0, Math.floor(childrenCount)) : 0;
  const countedChildren = Math.min(wholeChildren, CHILDREN_ALLOWANCE_MAX_CHILDREN);
  return monthlyLimit * 12 * countedChildren;
}
