import { api } from '@/lib/api';

/**
 * Accounting export and payroll variance report (Keka wave C, WS-C2).
 *
 * Types mirror `backend/src/modules/payroll/accounting/accounting.types.ts`.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, C7 and C8.
 */

export type PayrollRunType = 'REGULAR' | 'OFF_CYCLE';
export type PayrollRunStatus = 'DRAFT' | 'PROCESSING' | 'COMPUTED' | 'APPROVED' | 'PAID';
export type AccountingCostCenterMode = 'NONE' | 'DEPARTMENT' | 'BRANCH';
export type GlKeyCategory = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_EXPENSE' | 'EMPLOYER_PAYABLE' | 'NET';
export type JournalSide = 'DEBIT' | 'CREDIT';
export type AccountingExportFormat = 'csv' | 'tally';

export interface GlMapping {
  componentKey: string;
  glCode: string;
  glName: string;
}

export interface GlKnownKey {
  key: string;
  label: string;
  category: GlKeyCategory;
  side: JournalSide;
  isSystem: boolean;
  mapped: boolean;
}

export interface GlMappingsResponse {
  mappings: GlMapping[];
  knownKeys: GlKnownKey[];
}

export interface AccountingConfig {
  suspenseGlCode: string | null;
  suspenseGlName: string | null;
  costCenterMode: AccountingCostCenterMode;
  tallyCompanyName: string | null;
  tallyVoucherType: string;
  narrationTemplate: string;
}

export interface JournalLine {
  glCode: string;
  glName: string;
  costCenter: string | null;
  side: JournalSide;
  debit: number;
  credit: number;
  componentKeys: string[];
}

export interface JournalPreview {
  runId: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
  voucherDate: string;
  narration: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  unmappedKeys: string[];
  exportable: boolean;
}

export interface VarianceAmount {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export type VarianceEmployeeStatus = 'NEW' | 'LEFT' | 'CHANGED' | 'UNCHANGED';

export interface VarianceComponentDelta {
  key: string;
  category: GlKeyCategory;
  current: number;
  previous: number;
  delta: number;
}

export interface VarianceEmployeeRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  status: VarianceEmployeeStatus;
  gross: VarianceAmount;
  deductions: VarianceAmount;
  net: VarianceAmount;
  flagged: boolean;
  components: VarianceComponentDelta[];
}

export interface VarianceComponentRow {
  key: string;
  category: GlKeyCategory;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
  employeesAffected: number;
}

export interface VarianceRunRef {
  id: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
}

export interface VarianceReport {
  run: VarianceRunRef;
  compareRun: VarianceRunRef | null;
  thresholdPct: number;
  totals: {
    gross: VarianceAmount;
    deductions: VarianceAmount;
    net: VarianceAmount;
    headcount: { current: number; previous: number };
  };
  employees: VarianceEmployeeRow[];
  components: VarianceComponentRow[];
}

export interface VarianceParams {
  runId: string;
  compareRunId?: string;
  thresholdPct?: number;
}

export const payrollAccountingApi = {
  getConfig: () => api.get<AccountingConfig>('/payroll/accounting/config'),
  updateConfig: (payload: Partial<AccountingConfig>) =>
    api.put<AccountingConfig>('/payroll/accounting/config', payload),

  getGlMappings: () => api.get<GlMappingsResponse>('/payroll/accounting/gl-mappings'),
  replaceGlMappings: (mappings: GlMapping[]) =>
    api.put<GlMappingsResponse>('/payroll/accounting/gl-mappings', { mappings }),

  getJournal: (runId: string, allowUnmapped = false) =>
    api.get<JournalPreview>(`/payroll/accounting/runs/${runId}/journal`, {
      params: { allowUnmapped },
    }),
  /** Blob download; the caller saves it (see downloadBlob usage in api.ts). */
  exportJournal: (runId: string, format: AccountingExportFormat, allowUnmapped = false) =>
    api.get<Blob>(`/payroll/accounting/runs/${runId}/export`, {
      params: { format, allowUnmapped },
      responseType: 'blob',
    }),

  getVariance: (params: VarianceParams) =>
    api.get<VarianceReport>('/payroll/reports/variance', { params }),
  exportVariance: (params: VarianceParams) =>
    api.get<Blob>('/payroll/reports/variance/export', { params, responseType: 'blob' }),
};
