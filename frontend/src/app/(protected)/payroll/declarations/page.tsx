'use client';

/**
 * Payroll's view of an employee's tax declaration.
 *
 * Read only, and deliberately so: there is no endpoint for staff to write an
 * employee's declaration, and a form here that looked as though there were
 * would be a promise the system cannot keep. Corrections are made by the
 * employee on their own declaration page.
 *
 * The role gate lives in the /payroll layout, so there is none here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, Users } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { employeesApi, statutoryApi } from '@/lib/api';
import type { Employee, EmployeeTaxDeclaration } from '@/types';

import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';
import {
  ClosedYearNotice,
  DeclarationCaveat,
  NewRegimeNotice,
  NoDeclarationNotice,
} from '@/components/declaration/DeclarationNotices';
import {
  ReadOnlyDeclarationField,
  ignoredForRegime,
} from '@/components/declaration/DeclarationFieldRow';
import { DECLARATION_FIELDS } from '@/components/declaration/fields';

export default function PayrollDeclarationsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [declaration, setDeclaration] = useState<EmployeeTaxDeclaration | null>(null);
  const [loading, setLoading] = useState(false);
  /** True once a read for the current selection has come back. */
  const [read, setRead] = useState(false);
  /** Generation counter identifying the newest in-flight read. */
  const requestRef = useRef(0);

  const yearOptions = useMemo(() => financialYearOptions(), []);
  const yearInProgress = useMemo(() => currentFinancialYear(), []);
  const yearHasEnded = financialYear < yearInProgress;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await employeesApi.getAll({ limit: 1000, status: 'ACTIVE' });
        if (cancelled) return;
        // The list endpoint pages its results; older callers see a bare array.
        const payload = response.data;
        setEmployees((payload?.data ?? payload ?? []) as Employee[]);
      } catch {
        if (cancelled) return;
        setEmployees([]);
        toast.error('The employee list could not be loaded, so no one can be chosen.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.id,
        label: `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
      })),
    [employees],
  );

  const load = useCallback(async () => {
    if (!employeeId) {
      setDeclaration(null);
      setRead(false);
      return;
    }

    // Employee and year are both a click away; a slow reply must not land under
    // a different selection and attribute one person's claims to another.
    const request = requestRef.current + 1;
    requestRef.current = request;

    setLoading(true);
    try {
      const response = await statutoryApi.getDeclarationFor(employeeId, financialYear);
      if (requestRef.current !== request) return;
      setDeclaration((response.data ?? null) as EmployeeTaxDeclaration | null);
      setRead(true);
    } catch {
      if (requestRef.current !== request) return;
      setDeclaration(null);
      setRead(false);
      toast.error('That declaration could not be read. Nothing is shown rather than a guess.');
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [employeeId, financialYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = employees.find((employee) => employee.id === employeeId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-warm-900 sm:text-2xl">Tax declarations</h1>
          <p className="mt-1 text-sm text-warm-600">
            What an employee has declared for a financial year, as the basis for the tax deducted
            from their salary.
          </p>
        </div>
        <Badge variant="gray">Read only</Badge>
      </div>

      <DeclarationCaveat audience="staff" />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            options={employeeOptions}
            placeholder="Choose an employee"
          />
          <Select
            label="Financial year"
            value={String(financialYear)}
            onChange={(event) => setFinancialYear(Number(event.target.value))}
            options={yearOptions}
          />
        </CardContent>
      </Card>

      {yearHasEnded ? <ClosedYearNotice financialYear={financialYear} audience="staff" /> : null}

      {!employeeId ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-warm-300" aria-hidden="true" />
            <h3 className="mb-2 text-lg font-semibold text-warm-900">
              Choose an employee to see their declaration
            </h3>
            <p className="mx-auto max-w-xl text-sm text-warm-600">
              Declarations are shown one employee at a time. There is no way to edit an
              employee&apos;s declaration from here; only the employee can change their own.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : !read ? null : !declaration ? (
        <NoDeclarationNotice financialYear={financialYear} audience="staff" />
      ) : (
        <>
          {declaration.regime === 'NEW' ? <NewRegimeNotice audience="staff" /> : null}

          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warm-100 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Eye className="h-4 w-4 text-warm-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-warm-900">
                    {selected
                      ? `${selected.firstName} ${selected.lastName}`
                      : 'Selected employee'}
                    , {financialYearLabel(declaration.financialYear)}
                  </h2>
                </div>
                <Badge variant={declaration.regime === 'NEW' ? 'info' : 'gray'}>
                  {declaration.regime === 'NEW' ? 'New regime' : 'Old regime'}
                </Badge>
              </div>

              <dl>
                {DECLARATION_FIELDS.map((field) => (
                  <ReadOnlyDeclarationField
                    key={field.key}
                    field={field}
                    value={declaration[field.key]}
                    ignored={ignoredForRegime(field.key, declaration.regime)}
                  />
                ))}
              </dl>

              <p className="pt-2 text-xs text-warm-500">
                Declared {new Date(declaration.createdAt).toLocaleDateString('en-IN')}, last
                changed {new Date(declaration.updatedAt).toLocaleDateString('en-IN')} by the
                employee.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
