import { toCsvJournal, voucherNumberFor } from './csv-journal';
import { JournalPreview } from './accounting.types';

function preview(overrides: Partial<JournalPreview> = {}): JournalPreview {
  return {
    runId: 'run-1',
    month: 9,
    year: 2026,
    runType: 'REGULAR',
    sequence: 0,
    status: 'APPROVED',
    voucherDate: '2026-09-30',
    narration: 'Salary for September 2026',
    lines: [],
    totalDebit: 0,
    totalCredit: 0,
    balanced: true,
    unmappedKeys: [],
    exportable: true,
    ...overrides,
  };
}

describe('toCsvJournal', () => {
  it('writes the exact header row', () => {
    const csv = toCsvJournal(preview());
    const [header] = csv.split('\r\n');
    expect(header).toBe(
      'Voucher Date,Voucher No,GL Code,GL Name,Cost Centre,Debit,Credit,Narration',
    );
  });

  it('renders a two-line voucher with exact field values', () => {
    const csv = toCsvJournal(
      preview({
        lines: [
          {
            glCode: '4001',
            glName: 'Salaries',
            costCenter: 'Engineering',
            side: 'DEBIT',
            debit: 50000,
            credit: 0,
            componentKeys: ['BASIC'],
          },
          {
            glCode: '2002',
            glName: 'Salaries payable',
            costCenter: null,
            side: 'CREDIT',
            debit: 0,
            credit: 50000,
            componentKeys: ['NET_PAY'],
          },
        ],
      }),
    );

    expect(csv).toBe(
      'Voucher Date,Voucher No,GL Code,GL Name,Cost Centre,Debit,Credit,Narration\r\n' +
        '2026-09-30,JV-202609,4001,Salaries,Engineering,50000,,Salary for September 2026\r\n' +
        '2026-09-30,JV-202609,2002,Salaries payable,,,50000,Salary for September 2026\r\n',
    );
  });

  it('adds an -oc<n> suffix to the voucher number for an off-cycle run', () => {
    const voucherNo = voucherNumberFor(preview({ runType: 'OFF_CYCLE', sequence: 2 }));
    expect(voucherNo).toBe('JV-202609-oc2');
  });

  it('prefixes a leading apostrophe on any cell that would be read as a formula', () => {
    const csv = toCsvJournal(
      preview({
        lines: [
          {
            glCode: '4001',
            glName: '=SUM(A1:A9)',
            costCenter: '+Engineering',
            side: 'DEBIT',
            debit: 1,
            credit: 0,
            componentKeys: ['-Bad', '@Bad', '\tBad'],
          },
        ],
      }),
    );

    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'+Engineering");
  });

  it('quotes a GL name that carries a comma', () => {
    const csv = toCsvJournal(
      preview({
        lines: [
          {
            glCode: '4001',
            glName: 'Salaries, gross',
            costCenter: null,
            side: 'DEBIT',
            debit: 1,
            credit: 0,
            componentKeys: [],
          },
        ],
      }),
    );

    expect(csv).toContain('"Salaries, gross"');
  });
});
