import { JournalPreview } from './accounting.types';
import { AccountingConfigView } from './accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7): Tally ERP 9 / Prime "Import Data" XML writer
 * for one journal voucher.
 *
 * Debit lines carry `ISDEEMEDPOSITIVE=Yes` and a negative amount; credit
 * lines carry `No` and a positive amount — this is how Tally's XML interface
 * represents which side of the ledger an entry sits on. Every text node is
 * XML-escaped.
 */

/** Escapes the five XML-significant characters. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "2026-09-30" -> "20260930", the date format Tally's XML interface expects. */
export function tallyDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

function amountFor(debit: number, credit: number): { isDeemedPositive: 'Yes' | 'No'; amount: number } {
  if (debit > 0) return { isDeemedPositive: 'Yes', amount: -debit };
  return { isDeemedPositive: 'No', amount: credit };
}

/** Renders the journal preview as a Tally "Import Data" voucher XML document. */
export function toTallyXml(preview: JournalPreview, config: Pick<AccountingConfigView, 'tallyCompanyName' | 'tallyVoucherType'>): string {
  const staticVariables = config.tallyCompanyName
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(config.tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : '';

  const ledgerEntries = preview.lines
    .map((line) => {
      const { isDeemedPositive, amount } = amountFor(line.debit, line.credit);
      const costCentre = line.costCenter
        ? `<CATEGORYALLOCATIONS.LIST><COSTCENTREALLOCATIONS.LIST><NAME>${escapeXml(
            line.costCenter,
          )}</NAME><AMOUNT>${amount.toFixed(2)}</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>`
        : '';
      return (
        `<ALLLEDGERENTRIES.LIST>` +
        `<LEDGERNAME>${escapeXml(line.glName)}</LEDGERNAME>` +
        `<ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>` +
        `<AMOUNT>${amount.toFixed(2)}</AMOUNT>` +
        costCentre +
        `</ALLLEDGERENTRIES.LIST>`
      );
    })
    .join('');

  const voucherType = escapeXml(config.tallyVoucherType);

  return (
    `<ENVELOPE>` +
    `<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>` +
    `<BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVariables}</REQUESTDESC>` +
    `<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">` +
    `<VOUCHER VCHTYPE="${voucherType}" ACTION="Create">` +
    `<DATE>${tallyDate(preview.voucherDate)}</DATE>` +
    `<NARRATION>${escapeXml(preview.narration)}</NARRATION>` +
    `<VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>` +
    ledgerEntries +
    `</VOUCHER>` +
    `</TALLYMESSAGE></REQUESTDATA>` +
    `</IMPORTDATA></BODY>` +
    `</ENVELOPE>`
  );
}
