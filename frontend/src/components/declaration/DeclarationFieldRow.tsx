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
  /**
   * A warning that does not come from a ceiling — the leave travel field's
   * "the block is already exhausted" notice is the first of these. Shown the
   * same way a ceiling warning is, so the employee does not have to tell the
   * two kinds apart by look.
   */
  warning?: string;
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
  warning,
}: EditableProps) {
  const inputId = `declaration-${field.key}`;
  const entered = readableAmount(value);
  const overCeiling =
    field.ceiling !== undefined && entered !== null && entered > field.ceiling;
  const resolved = field.resolvedCeiling;
  const overResolvedCeiling = resolved !== undefined && entered !== null && entered > resolved.amount;

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
      {overResolvedCeiling && resolved ? (
        <p className="text-xs font-medium text-amber-700">
          {resolved.confirmed
            ? `Above the ${formatCeiling(resolved.amount)} ceiling your employer has configured for ${field.label}. It is saved exactly as you declared it, but the part above the ceiling will not reduce your tax.`
            : `This looks like it is above the ceiling for ${field.label}, but your employer's configured limit for this year could not be confirmed, so no figure is shown here. It is saved exactly as you declared it, and any part beyond the real ceiling will not reduce your tax.`}
        </p>
      ) : null}
      {warning ? <p className="text-xs font-medium text-amber-700">{warning}</p> : null}
    </div>
  );
}

interface EditableCountProps {
  /** Used for the input id and the `field-{id}` test id, matching the
   * `field-{key}` convention every other field row uses. */
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  /** A warning to show beneath the hint, or undefined for none. Computed by
   * the caller (see `ltaJourneysWarning` in `./fields`) rather than here, so
   * this component stays as generic as `childrenCount` needs it to be. */
  warning?: string;
}

/**
 * An editable count — of children, of journeys, of anything this form counts
 * rather than sums as money. Deliberately plainer than
 * `EditableDeclarationField`: a count has no "ignored under the new regime"
 * marker of its own, because it is not itself a deduction, only context for
 * one.
 */
export function EditableCountField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  warning,
}: EditableCountProps) {
  const inputId = `declaration-${id}`;
  return (
    <div data-testid={`field-${id}`} className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-warm-700">
        {label}
      </label>
      <Input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={value}
        disabled={disabled}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-warm-500">{hint}</p>
      {warning ? <p className="text-xs font-medium text-amber-700">{warning}</p> : null}
    </div>
  );
}

interface ReadOnlyCountProps {
  fieldKey: string;
  label: string;
  value: number;
}

/** The read-only counterpart of `EditableCountField`, for payroll's view. */
export function ReadOnlyCountField({ fieldKey, label, value }: ReadOnlyCountProps) {
  return (
    <div
      data-testid={`field-${fieldKey}`}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warm-100 py-2.5 last:border-0"
    >
      <dt className="text-sm font-medium text-warm-700">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-warm-900">{value}</dd>
    </div>
  );
}

interface EditableBooleanProps {
  /** Used for the input id and the `field-{id}` test id, matching the
   * `field-{key}` convention every other field row uses. */
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * An editable yes/no figure — the shape of `EditableCountField`, but for a
 * boolean rather than a whole number. Like a count, it carries no "ignored
 * under the new regime" marker: it is not itself a deduction, only a fact
 * about the declaration.
 */
export function EditableBooleanField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: EditableBooleanProps) {
  const inputId = `declaration-${id}`;
  return (
    <div data-testid={`field-${id}`} className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="flex items-center gap-2 text-sm font-medium text-warm-700"
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
        />
        {label}
      </label>
      <p className="text-xs text-warm-500">{hint}</p>
    </div>
  );
}

interface ReadOnlyBooleanProps {
  fieldKey: string;
  label: string;
  value: boolean;
}

/** The read-only counterpart of `EditableBooleanField`, for payroll's view. */
export function ReadOnlyBooleanField({ fieldKey, label, value }: ReadOnlyBooleanProps) {
  return (
    <div
      data-testid={`field-${fieldKey}`}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warm-100 py-2.5 last:border-0"
    >
      <dt className="text-sm font-medium text-warm-700">{label}</dt>
      <dd className="text-sm font-semibold text-warm-900">{value ? 'Yes' : 'No'}</dd>
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
