'use client';

import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { JournalPreview } from '@/lib/api-payroll-accounting';
import { formatMoney } from './money';

interface JournalPreviewPanelProps {
  preview: JournalPreview | null;
  loading: boolean;
  allowUnmapped: boolean;
  downloading: 'csv' | 'tally' | null;
  onDownload: (format: 'csv' | 'tally') => void;
}

/**
 * The journal for one run: totals, whether it balances, which keys still
 * need a GL mapping, and the aggregated lines. Downloads are disabled until
 * the run is exportable and every key resolves (or the reviewer explicitly
 * allows unmapped keys to post to suspense).
 */
export function JournalPreviewPanel({
  preview,
  loading,
  allowUnmapped,
  downloading,
  onDownload,
}: JournalPreviewPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!preview) {
    return <p className="py-8 text-center text-sm text-warm-500">Choose a payroll run to preview its journal.</p>;
  }

  const canExport = preview.exportable && (preview.unmappedKeys.length === 0 || allowUnmapped);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-warm-200 p-3">
          <p className="text-xs uppercase text-warm-500">Total debit</p>
          <p className="text-lg font-semibold text-warm-900">{formatMoney(preview.totalDebit)}</p>
        </div>
        <div className="rounded-lg border border-warm-200 p-3">
          <p className="text-xs uppercase text-warm-500">Total credit</p>
          <p className="text-lg font-semibold text-warm-900">{formatMoney(preview.totalCredit)}</p>
        </div>
        <div className="rounded-lg border border-warm-200 p-3">
          <p className="text-xs uppercase text-warm-500">Balance check</p>
          {preview.balanced ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Balanced
            </Badge>
          ) : (
            <Badge variant="danger">Does not balance</Badge>
          )}
        </div>
      </div>

      {!preview.exportable ? (
        <p className="rounded-lg bg-warm-50 px-3 py-2 text-sm text-warm-600">
          This run is {preview.status}. Only APPROVED or PAID runs can be exported; this is a preview only.
        </p>
      ) : null}

      {preview.unmappedKeys.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p>
            {preview.unmappedKeys.length} key{preview.unmappedKeys.length === 1 ? '' : 's'} with no GL mapping:{' '}
            <span className="font-medium">{preview.unmappedKeys.join(', ')}</span>.
            {allowUnmapped
              ? ' Posted to the suspense account.'
              : ' Map them, or allow posting to suspense, before exporting.'}
          </p>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>GL code</TableHead>
            <TableHead>GL name</TableHead>
            <TableHead>Cost centre</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.lines.length === 0 ? (
            <TableEmptyState message="No journal lines." colSpan={5} />
          ) : (
            preview.lines.map((line, index) => (
              <TableRow key={`${line.glCode}-${line.costCenter ?? ''}-${line.side}-${index}`}>
                <TableCell>{line.glCode}</TableCell>
                <TableCell>{line.glName}</TableCell>
                <TableCell>{line.costCenter ?? '—'}</TableCell>
                <TableCell className="text-right">{line.debit ? formatMoney(line.debit) : '—'}</TableCell>
                <TableCell className="text-right">{line.credit ? formatMoney(line.credit) : '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!canExport || downloading !== null}
          loading={downloading === 'csv'}
          onClick={() => onDownload('csv')}
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Download CSV
        </Button>
        <Button
          variant="secondary"
          disabled={!canExport || downloading !== null}
          loading={downloading === 'tally'}
          onClick={() => onDownload('tally')}
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Download Tally XML
        </Button>
      </div>
    </div>
  );
}
