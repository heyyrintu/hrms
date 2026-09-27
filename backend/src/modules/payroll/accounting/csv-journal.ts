import { JournalPreview } from './accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7): CSV journal writer.
 *
 * Header: `Voucher Date,Voucher No,GL Code,GL Name,Cost Centre,Debit,Credit,Narration`.
 * RFC 4180 quoting, plus a formula-injection guard: any cell whose first
 * character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading
 * apostrophe before quoting, so Excel/Sheets never evaluates it as a formula.
 */

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/** Prefixes a leading apostrophe onto anything a spreadsheet would treat as a formula. */
function neutralizeFormula(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGER_CHARS.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

/**
 * Quotes a CSV field only when it needs it, after neutralizing any leading
 * formula-trigger character. Exported so every payroll CSV export in this
 * module (the journal here, and the variance report) shares one guard.
 */
export function csvField(raw: string | number): string {
  const value = neutralizeFormula(String(raw));
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

/** One voucher number for a run: "JV-<yyyy><mm>[-oc<n>]". */
export function voucherNumberFor(preview: JournalPreview): string {
  const stamp = `${preview.year}${String(preview.month).padStart(2, '0')}`;
  const suffix = preview.runType === 'OFF_CYCLE' ? `-oc${preview.sequence}` : '';
  return `JV-${stamp}${suffix}`;
}

/** Renders the journal preview as CSV text, one row per journal line. */
export function toCsvJournal(preview: JournalPreview): string {
  const voucherNo = voucherNumberFor(preview);
  const rows: string[] = [
    csvRow(['Voucher Date', 'Voucher No', 'GL Code', 'GL Name', 'Cost Centre', 'Debit', 'Credit', 'Narration']),
  ];

  for (const line of preview.lines) {
    rows.push(
      csvRow([
        preview.voucherDate,
        voucherNo,
        line.glCode,
        line.glName,
        line.costCenter ?? '',
        line.debit || '',
        line.credit || '',
        preview.narration,
      ]),
    );
  }

  return rows.join('\r\n') + '\r\n';
}
