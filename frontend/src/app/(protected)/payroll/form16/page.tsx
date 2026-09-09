'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { employeesApi, form16Api } from '@/lib/api';
import type { Employee, Form16PartB, QuarterlyTdsSummary } from '@/types';
import toast from 'react-hot-toast';
import { AlertTriangle, Users } from 'lucide-react';

import { Form16Header } from '@/components/form16/Form16Header';
import { Form16PartBView } from '@/components/form16/Form16PartBView';
import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';

type PickableEmployee = Pick<Employee, 'id' | 'employeeCode' | 'firstName' | 'lastName'>;

export default function PayrollForm16Page() {
  const [employees, setEmployees] = useState<PickableEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [certificate, setCertificate] = useState<Form16PartB | null>(null);
  const [quarterly, setQuarterly] = useState<QuarterlyTdsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const yearOptions = useMemo(() => financialYearOptions(), []);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.id,
        label: `${employee.employeeCode} — ${employee.firstName} ${employee.lastName}`,
      })),
    [employees],
  );

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const response = await employeesApi.getAll({ limit: 1000 });
        const payload = response.data;
        const list: PickableEmployee[] = Array.isArray(payload)
          ? payload
          : (payload?.data ?? []);
        setEmployees(list);
      } catch {
        toast.error('Failed to load employees');
      }
    };
    void loadEmployees();
  }, []);

  const load = useCallback(async () => {
    if (!employeeId) {
      setCertificate(null);
      setQuarterly(null);
      return;
    }

    setLoading(true);
    setLoadFailed(false);

    // The quarterly summary is secondary: the certificate carries the same
    // quarters, so a failure there must not hide the certificate.
    const [certificateResult, quarterResult] = await Promise.allSettled([
      form16Api.getForEmployee(employeeId, financialYear),
      form16Api.getQuartersForEmployee(employeeId, financialYear),
    ]);

    if (certificateResult.status === 'fulfilled') {
      setCertificate(certificateResult.value.data as Form16PartB);
    } else {
      setCertificate(null);
      setLoadFailed(true);
      toast.error('Failed to load the Form 16 Part B for this employee');
    }

    setQuarterly(
      quarterResult.status === 'fulfilled'
        ? (quarterResult.value.data as QuarterlyTdsSummary)
        : null,
    );
    setLoading(false);
  }, [employeeId, financialYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = async () => {
    if (!employeeId || !certificate) return;
    setDownloading(true);
    try {
      const label = financialYearLabel(financialYear).replace(/\s+/g, '');
      const code = certificate.employee.employeeCode;
      await form16Api.downloadForEmployee(
        employeeId,
        financialYear,
        `form16-part-b-${code}-${label}.pdf`,
      );
      toast.success('Form 16 Part B downloaded');
    } catch {
      toast.error('Failed to download the Form 16 Part B for this employee');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Form16Header
        title="Form 16 (Part B)"
        subtitle="The salary, deductions and tax figures payroll computed for an employee in a financial year."
      />

      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <Select
              label="Employee"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              placeholder="Select an employee"
              options={employeeOptions}
            />
            <Select
              label="Financial year"
              value={String(financialYear)}
              onChange={(event) => setFinancialYear(Number(event.target.value))}
              options={yearOptions}
            />
          </div>
        </CardContent>
      </Card>

      {!employeeId ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 text-warm-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-warm-900 mb-2">
              Pick an employee to see their Part B
            </h3>
            <p className="text-warm-600">
              Choose an employee and a financial year above. Reconcile the figures against the filed
              Form 24Q returns before issuing anything.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : loadFailed || !certificate ? (
        <Card>
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-12 h-12 text-warm-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-warm-900 mb-2">
              Could not load Part B for {financialYearLabel(financialYear)}
            </h3>
            <p className="text-warm-600 mb-4">
              Nothing was shown because nothing could be read. Try again, and check the payroll run
              for this year if it keeps failing.
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
