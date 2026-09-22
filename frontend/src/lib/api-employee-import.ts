import { api } from '@/lib/api';

export interface ImportRowError {
  /** 1-based data row (the CSV header line is not counted). */
  row: number;
  field: string;
  message: string;
}

export interface ImportEmployeesResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportRowError[];
  created: number;
}

export const employeeImportApi = {
  /**
   * Upload a CSV. With `dryRun` the server validates and reports without
   * writing anything; without it the whole file is imported or rejected.
   */
  async upload(
    file: File,
    options: { dryRun: boolean; initialPassword?: string },
  ): Promise<ImportEmployeesResult> {
    const form = new FormData();
    form.append('file', file);
    if (options.initialPassword) {
      form.append('initialPassword', options.initialPassword);
    }

    const { data } = await api.post('/employees/import', form, {
      params: { dryRun: options.dryRun },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  /** The CSV header line, for the "Download template" link. */
  async template(): Promise<string> {
    const { data } = await api.get('/employees/import/template', { responseType: 'text' });
    return data;
  },
};
