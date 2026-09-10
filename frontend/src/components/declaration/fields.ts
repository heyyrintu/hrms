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

/** The nine rupee figures a declaration carries. Regime and year are not amounts. */
export type DeclarationAmountKey =
  | 'section80C'
  | 'section80D'
  | 'section80CCD1B'
  | 'section80CCD2'
  | 'hraExemption'
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
