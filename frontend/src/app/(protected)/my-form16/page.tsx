'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { form16Api } from '@/lib/api';
import type { Form16PartB, QuarterlyTdsSummary } from '@/types';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';

import { Form16Header } from '@/components/form16/Form16Header';
import { Form16PartBView } from '@/components/form16/Form16PartBView';
import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';

export default function MyForm16Page() {
  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [certificate, setCertificate] = useState<Form16PartB | null>(null);
  const [quarterly, setQuarterly] = useState<QuarterlyTdsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /** Generation counter identifying the newest in-flight load. */
  const requestRef = useRef(0);

  const yearOptions = useMemo(() => financialYearOptions(), []);

  const load = useCallback(async () => {
    // Changing year is a click apart and one request can outlive the next.
    // Without this token a slow reply would land under whichever year is
    // selected by the time it arrives, labelling one year's tax with another's.
    const request = requestRef.current + 1;
    requestRef.current = request;
    const isCurrent = () => requestRef.current === request;

    setLoading(true);
    setLoadFailed(false);

    // The quarterly summary is secondary: the certificate carries the same
    // quarters, so a failure there must not hide the certificate.
    const [certificateResult, quarterResult] = await Promise.allSettled([
      form16Api.getMine(financialYear),
      form16Api.getMyQuarters(financialYear),
    ]);

    // A stale reply is discarded whole, error toast included: an error about a
    // year the user has already moved on from is noise at best.
    if (!isCurrent()) return;

    if (certificateResult.status === 'fulfilled') {
      setCertificate(certificateResult.value.data as Form16PartB);
    } else {
      setCertificate(null);
      setLoadFailed(true);
      toast.error('Failed to load your Form 16 Part B');
    }

    setQuarterly(
      quarterResult.status === 'fulfilled'
        ? (quarterResult.value.data as QuarterlyTdsSummary)
        : null,
    );
    setLoading(false);
  }, [financialYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const label = financialYearLabel(financialYear).replace(/\s+/g, '');
      await form16Api.downloadMine(financialYear, `form16-part-b-${label}.pdf`);
      toast.success('Form 16 Part B downloaded');
    } catch {
      toast.error('Failed to download your Form 16 Part B');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Form16Header
        title="My Form 16 (Part B)"
        subtitle="The salary, deductions and tax figures your employer computed for a financial year."
      />

      <Card>
        <CardContent className="py-4">
          <div className="max-w-xs">
            <Select
              label="Financial year"
              value={String(financialYear)}
              onChange={(event) => setFinancialYear(Number(event.target.value))}
              options={yearOptions}
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : loadFailed || !certificate ? (
        <Card>
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-12 h-12 text-warm-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-warm-900 mb-2">
              Could not load your Part B for {financialYearLabel(financialYear)}
            </h3>
            <p className="text-warm-600 mb-4">
              Nothing was shown because nothing could be read. Try again, and tell payroll if it
              keeps failing.
            </p>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Form16PartBView
          certificate={certificate}
          quarterly={quarterly}
          onDownload={handleDownload}
          downloading={downloading}
        />
      )}
    </div>
  );
}
