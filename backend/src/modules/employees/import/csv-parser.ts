/**
 * A minimal RFC 4180 CSV reader.
 *
 * Deliberately dependency-free: the bulk employee import is the only consumer
 * and it needs exactly this much — quoted fields, doubled quotes inside them,
 * embedded newlines and commas, and CRLF or LF line endings.
 */

export class CsvParseError extends Error {}

/**
 * Split CSV text into rows of raw (untrimmed) cells.
 *
 * A UTF-8 BOM is stripped, because Excel writes one and it would otherwise
 * become part of the first header name.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // A row only exists once we have seen a cell separator or any content; this
  // keeps a trailing newline from producing a phantom empty row.
  let rowStarted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
    rowStarted = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    rowStarted = false;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      rowStarted = true;
      i += 1;
      continue;
    }

    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }

    field += ch;
    rowStarted = true;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvParseError('Unterminated quoted field in CSV');
  }

  if (rowStarted || field !== '') {
    endRow();
  }

  return rows;
}

/** True when every cell in the row is blank — such rows are ignored. */
export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}
