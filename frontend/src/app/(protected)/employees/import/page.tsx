'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Download, FileUp, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  employeeImportApi,
  type ImportEmployeesResult,
  type ImportRowError,
} from '@/lib/api-employee-import';

/**
 * Columns named in the on-page help text only. The downloadable template is
 * fetched from the server, which owns the real column list.
 */
const TEMPLATE_COLUMNS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'joinDate',
  'departmentCode',
  'designationName',
  'branchName',
  'managerEmployeeCode',
  'employmentType',
  'phone',
  'dateOfBirth',
  'gender',
  'role',
];

const REQUIRED_COLUMNS = new Set([
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'joinDate',
]);

/** Pulls the server's error list out of an axios error, whatever shape it took. */
function readErrorResponse(err: unknown): {
  message: string;
  result?: Partial<ImportEmployeesResult>;
} {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data && Array.isArray(data.errors)) {
    return {
      message: typeof data.message === 'string' ? data.message : 'Import rejected',
      result: data as unknown as Partial<ImportEmployeesResult>,
    };
  }
  const message =
    (typeof data?.message === 'string' && data.message) ||
    (err as Error)?.message ||
    'Something went wrong';
  return { message };
}

export default function EmployeeImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportEmployeesResult | null>(null);
  const [initialPassword, setInitialPassword] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Errors arrive as a flat list; the table shows one line per data row.
  const errorsByRow = useMemo(() => {
    const map = new Map<number, ImportRowError[]>();
    for (const error of preview?.errors ?? []) {
      const list = map.get(error.row) ?? [];
      list.push(error);
      map.set(error.row, list);
    }
    return map;
  }, [preview]);

  const canImport =
    preview !== null && preview.invalidRows === 0 && preview.totalRows > 0 && !isImporting;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    // A new file invalidates whatever the previous preview said.
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!file) {
      toast.error('Choose a CSV file first');
      return;
    }
    setIsPreviewing(true);
    try {
      const result = await employeeImportApi.upload(file, { dryRun: true });
      setPreview(result);
      if (result.invalidRows > 0) {
        toast.error(`${result.invalidRows} of ${result.totalRows} rows need fixing`);
      } else {
        toast.success(`${result.validRows} rows look good`);
      }
    } catch (err) {
      const { message, result } = readErrorResponse(err);
      setPreview((result as ImportEmployeesResult) ?? null);
      toast.error(message);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!file || !preview) return;
    if (initialPassword.length < 8) {
      toast.error('Initial password must be at least 8 characters');
      return;
    }

    setIsImporting(true);
    try {
      const result = await employeeImportApi.upload(file, { dryRun: false, initialPassword });
      toast.success(`Imported ${result.created} employees`);
      router.push('/employees');
    } catch (err) {
      const { message, result } = readErrorResponse(err);
      if (result) setPreview(result as ImportEmployeesResult);
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    let header: string;
    try {
      header = await employeeImportApi.template();
    } catch {
      toast.error('Could not download the template');
      return;
    }
    const blob = new Blob([header], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'employee-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Import employees</h1>
          <p className="text-warm-500">
            Upload a CSV, review what the server found, then import the whole file at once.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push('/employees')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to employees
          </Button>
          <Button variant="secondary" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download template
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Choose a file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-warm-500">
            Required columns: {[...REQUIRED_COLUMNS].join(', ')}. Optional:{' '}
            {TEMPLATE_COLUMNS.filter((c) => !REQUIRED_COLUMNS.has(c)).join(', ')}. Dates are
            YYYY-MM-DD. Maximum 2000 rows and 2 MB.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={handleFileChange}
            className="block w-full text-sm text-warm-700"
          />
          {file && <p className="text-sm text-warm-600">Selected: {file.name}</p>}
          <Button onClick={handlePreview} disabled={!file || isPreviewing}>
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            Preview
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>2. Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span data-testid="total-rows">Total rows: {preview.totalRows}</span>
              <span data-testid="valid-rows">Valid: {preview.validRows}</span>
              <span data-testid="invalid-rows">Invalid: {preview.invalidRows}</span>
            </div>

            {preview.invalidRows === 0 ? (
              <p className="text-sm text-green-700">
                Every row is valid. Set an initial password below to import.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left p-2">Row</th>
                      <th className="text-left p-2">Field</th>
                      <th className="text-left p-2">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...errorsByRow.entries()].map(([row, rowErrors]) =>
                      rowErrors.map((error, i) => (
                        <tr
                          key={`${row}-${error.field}-${i}`}
                          className="bg-red-50"
                          data-testid={`error-row-${row}`}
                        >
                          <td className="p-2">{row}</td>
                          <td className="p-2">
                            <Badge variant="danger">{error.field}</Badge>
                          </td>
                          <td className="p-2">{error.message}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-warm-500">
              Every imported employee gets a sign-in account with this password and is asked to
              change it at first sign-in.
            </p>
            <Input
              type="password"
              label="Initial password"
              aria-label="Initial password"
              value={initialPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setInitialPassword(e.target.value)
              }
              placeholder="At least 8 characters"
            />
            <Button onClick={handleImport} disabled={!canImport}>
              {isImporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Import {preview.validRows} employees
            </Button>
            {preview.invalidRows > 0 && (
              <p className="text-sm text-red-600">
                Fix the {preview.invalidRows} flagged rows and preview again — the file is imported
                all at once or not at all.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
