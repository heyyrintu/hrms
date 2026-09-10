'use client';

/**
 * The things a tax declaration page has to say out loud.
 *
 * All four notices are shared between the employee's own declaration and
 * payroll's read-only view, because both readers need the same caveats and
 * neither should get a softer version of them.
 */

import { AlertTriangle, CalendarX, Info, ShieldQuestion } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';
import { financialYearLabel } from '@/components/form16/financialYear';

/**
 * These are declarations, not proofs.
 *
 * Nothing in the product collects, verifies or approves evidence, and no
 * statutory ceiling is enforced on a declared amount. Saying so is not
 * decoration: without it, a page that accepts a figure looks like a page that
 * has accepted the claim behind it.
 */
export function DeclarationCaveat({ audience }: { audience: 'employee' | 'staff' }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="flex gap-3">
        <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="space-y-1.5 text-sm text-amber-900">
          <p className="font-semibold">These are declarations, not proofs.</p>
          <p>
            Nothing here collects, verifies or approves evidence, and no statutory ceiling is
            enforced on a declared amount — a figure above a ceiling is stored exactly as it was
            declared.
          </p>
          <p>
            {audience === 'employee'
              ? 'So the tax deducted from your salary is an estimate until your proofs are checked separately, outside this system. If a figure here turns out not to be supported, the shortfall is recovered from later salary.'
              : 'So the TDS computed from it is an estimate until proofs are collected and checked separately, outside this system. Treat these figures as what the employee claims, not as what has been substantiated.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What happens when nothing has been declared.
 *
 * Silence here would read as "nothing to do". In fact TDS still runs; it just
 * runs on salary alone.
 */
export function NoDeclarationNotice({
  financialYear,
  audience,
}: {
  financialYear: number;
  audience: 'employee' | 'staff';
}) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <Info className="mx-auto mb-3 h-10 w-10 text-warm-300" aria-hidden="true" />
        <h3 className="mb-2 text-lg font-semibold text-warm-900">
          {audience === 'employee'
            ? `You have not declared anything for ${financialYearLabel(financialYear)} yet`
            : `No declaration on record for ${financialYearLabel(financialYear)}`}
        </h3>
        <p className="mx-auto max-w-xl text-sm text-warm-600">
          {audience === 'employee'
            ? 'Until you save one, TDS is computed on your salary alone, with only the standard deduction. Everything below is empty, not zero — nothing has been recorded.'
            : 'Until the employee saves one, TDS is computed on their salary alone, with only the standard deduction. Nothing has been recorded, which is not the same as an employee declaring nil.'}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * A financial year that has already closed.
 *
 * The declaration drives the tax deducted month by month. Once the year is
 * over there is nothing left to deduct differently, so an edit is bookkeeping.
 */
export function ClosedYearNotice({
  financialYear,
  audience,
}: {
  financialYear: number;
  audience: 'employee' | 'staff';
}) {
  return (
    <Card className="border-warm-300 bg-warm-50">
      <CardContent className="flex gap-3">
        <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-warm-500" aria-hidden="true" />
        <p className="text-sm text-warm-700">
          {audience === 'employee'
            ? `${financialYearLabel(financialYear)} has ended, so editing this declaration will not change tax already deducted. It is a record of what was claimed; any correction now belongs in the return you file.`
            : `${financialYearLabel(financialYear)} has ended. Nothing recorded for a closed year changes the tax already deducted in it.`}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * What the new regime disregards.
 *
 * Shown only when the new regime is in force, next to per-field markers. A form
 * that took these figures without a word would be inviting someone to believe
 * a deduction they will not get.
 */
export function NewRegimeNotice({ audience }: { audience: 'employee' | 'staff' }) {
  return (
    <Card className="border-sky-200 bg-sky-50">
      <CardContent className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
        <div className="space-y-1.5 text-sm text-sky-900">
          <p className="font-semibold">
            The new regime allows only the standard deduction and section 80CCD(2).
          </p>
          <p>
            Chapter VI-A deductions, the HRA exemption, home loan interest and the professional tax
            deduction under section 16(iii) do not apply under it. The marked entries below are
            still stored, and still shown, but they do not reduce the tax.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
