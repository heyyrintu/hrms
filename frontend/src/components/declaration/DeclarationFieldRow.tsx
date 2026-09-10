'use client';

/**
 * One figure in a declaration, editable or read-only.
 *
 * Both variants render the same label, the same hint and the same "the regime
 * ignores this" marker, so payroll and the employee are looking at the same
 * thing described the same way.
 */

import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { formatINR } from '@/components/form16/money';

import {
  DeclarationFieldSpec,
  formatCeiling,
  isIgnoredUnderNewRegime,
} from './fields';
import { readableAmount } from './parseAmount';

/** The marker shown against a figure the new regime disregards. */
function IgnoredMarker() {
  return <Badge variant="warning">Ignored under the new regime</Badge>;
}

interface EditableProps {
  field: DeclarationFieldSpec;
  value: string;
  onChange: (value: string) => void;
  /** Why the entry was refused, if it was. */
  error?: string;
  /** True when the selected regime disregards this figure. */
  ignored: boolean;
  disabled?: boolean;
}

/**
 * An editable figure.
 *
 * The input is a text field, not a number field: the value is carried as the
 * decimal string it arrived as, and a number input would round-trip it through
 * the browser's own numeric parsing on the display path.
 */
export function EditableDeclarationField({
  field,
  value,
  onChange,
  error,
  ignored,
  disabled,
}: EditableProps) {
  const inputId = `declaration-${field.key}`;
  const entered = readableAmount(value);
  const overCeiling =
    field.ceiling !== undefined && entered !== null && entered > field.ceiling;

  return (
    <div data-testid={`field-${field.key}`} className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-warm-700">
          {field.label}
        </label>
        {ignored ? <IgnoredMarker /> : null}
      </div>
      <Input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        disabled={disabled}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-warm-500">{field.hint}</p>
      {overCeiling && field.ceiling !== undefined ? (
        <p className="text-xs font-medium text-amber-700">
          {`Above the ${formatCeiling(field.ceiling)} ceiling for ${field.label}. It is saved exactly as you declared it, but the part above the ceiling will not reduce your tax.`}
        </p>
      ) : null}
    </div>
  );
}

interface ReadOnlyProps {
  field: DeclarationFieldSpec;
  /** The decimal string as stored. Formatted for display, never parsed. */
  value: string;
  ignored: boolean;
}

/** A figure payroll can read and cannot change. */
export function ReadOnlyDeclarationField({ field, value, ignored }: ReadOnlyProps) {
  return (
    <div
      data-testid={`field-${field.key}`}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warm-100 py-2.5 last:border-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <dt className="text-sm font-medium text-warm-700">{field.label}</dt>
        {ignored ? <IgnoredMarker /> : null}
      </div>
      <dd className="text-sm font-semibold tabular-nums text-warm-900">{formatINR(value)}</dd>
    </div>
  );
}

/** Convenience for the common `regime === 'NEW' && ignored` test. */
export function ignoredForRegime(
  key: DeclarationFieldSpec['key'],
  regime: 'OLD' | 'NEW',
): boolean {
  return regime === 'NEW' && isIgnoredUnderNewRegime(key);
}
