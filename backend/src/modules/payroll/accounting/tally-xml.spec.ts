import { escapeXml, tallyDate, toTallyXml } from './tally-xml';
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
    totalDebit: 50000,
    totalCredit: 50000,
    balanced: true,
    unmappedKeys: [],
    exportable: true,
    ...overrides,
  };
}

describe('escapeXml', () => {
  it('escapes the five XML-significant characters', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });
});

describe('tallyDate', () => {
  it('strips the dashes from an ISO date', () => {
    expect(tallyDate('2026-09-30')).toBe('20260930');
  });
});

describe('toTallyXml', () => {
  it('renders the exact envelope for a two-line voucher without a company name', () => {
    const xml = toTallyXml(preview(), { tallyCompanyName: null, tallyVoucherType: 'Journal' });

    expect(xml).toBe(
      '<ENVELOPE>' +
        '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>' +
        '<BODY><IMPORTDATA>' +
        '<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>' +
        '<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' +
        '<VOUCHER VCHTYPE="Journal" ACTION="Create">' +
        '<DATE>20260930</DATE>' +
        '<NARRATION>Salary for September 2026</NARRATION>' +
        '<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Salaries</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-50000.00</AMOUNT>' +
        '<CATEGORYALLOCATIONS.LIST><COSTCENTREALLOCATIONS.LIST><NAME>Engineering</NAME><AMOUNT>-50000.00</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>' +
        '</ALLLEDGERENTRIES.LIST>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Salaries payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>50000.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
        '</VOUCHER>' +
        '</TALLYMESSAGE></REQUESTDATA>' +
        '</IMPORTDATA></BODY>' +
        '</ENVELOPE>',
    );
  });

  it('adds SVCURRENTCOMPANY when a Tally company name is configured', () => {
    const xml = toTallyXml(preview(), { tallyCompanyName: 'Acme Corp', tallyVoucherType: 'Journal' });
    expect(xml).toContain(
      '<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>Acme Corp</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>',
    );
  });

  it('XML-escapes narration, ledger names, cost centres and the company name', () => {
    const xml = toTallyXml(
      preview({
        narration: 'Salary for "Sept" & Co',
        lines: [
          {
            glCode: '4001',
            glName: `R&D <Team>`,
            costCenter: `R&D's centre`,
            side: 'DEBIT',
            debit: 1,
            credit: 0,
            componentKeys: [],
          },
        ],
      }),
      { tallyCompanyName: `Acme & Sons`, tallyVoucherType: 'Journal' },
    );

    expect(xml).toContain('<NARRATION>Salary for &quot;Sept&quot; &amp; Co</NARRATION>');
    expect(xml).toContain('<LEDGERNAME>R&amp;D &lt;Team&gt;</LEDGERNAME>');
    expect(xml).toContain('<NAME>R&amp;D&apos;s centre</NAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Acme &amp; Sons</SVCURRENTCOMPANY>');
  });
});
