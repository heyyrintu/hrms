import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PayrollVariancePage from './page';
import { payrollApi } from '@/lib/api';
import { payrollAccountingApi } from '@/lib/api-payroll-accounting';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api', () => ({
  payrollApi: { getRuns: jest.fn() },
}));

jest.mock('@/lib/api-payroll-accounting', () => ({
  payrollAccountingApi: {
    getVariance: jest.fn(),
    exportVariance: jest.fn(),
  },
}));

const runs = [
  { id: 'run-1', month: 9, year: 2026, runType: 'REGULAR', sequence: 0, status: 'APPROVED' },
  { id: 'run-0', month: 8, year: 2026, runType: 'REGULAR', sequence: 0, status: 'PAID' },
];

const report = {
  run: { id: 'run-1', month: 9, year: 2026, runType: 'REGULAR', sequence: 0, status: 'APPROVED' },
  compareRun: { id: 'run-0', month: 8, year: 2026, runType: 'REGULAR', sequence: 0, status: 'PAID' },
  thresholdPct: 10,
  totals: {
    gross: { current: 100000, previous: 90000, delta: 10000, deltaPct: 11.11 },
    deductions: { current: 5000, previous: 4500, delta: 500, deltaPct: 11.11 },
    net: { current: 95000, previous: 85500, delta: 9500, deltaPct: 11.11 },
    headcount: { current: 2, previous: 2 },
  },
  employees: [
    {
      employeeId: 'emp-1',
      employeeCode: 'E001',
      name: 'Jane Doe',
      department: 'Engineering',
      status: 'CHANGED',
      gross: { current: 55000, previous: 50000, delta: 5000, deltaPct: 10 },
      deductions: { current: 0, previous: 0, delta: 0, deltaPct: null },
      net: { current: 55000, previous: 50000, delta: 5000, deltaPct: 10 },
      flagged: true,
      components: [{ key: 'BASIC', category: 'EARNING', current: 55000, previous: 50000, delta: 5000 }],
    },
    {
      employeeId: 'emp-2',
      employeeCode: 'E002',
      name: 'John Roe',
      department: 'Sales',
      status: 'UNCHANGED',
      gross: { current: 45000, previous: 45000, delta: 0, deltaPct: 0 },
      deductions: { current: 0, previous: 0, delta: 0, deltaPct: null },
      net: { current: 45000, previous: 45000, delta: 0, deltaPct: 0 },
      flagged: false,
      components: [],
    },
  ],
  components: [
    {
      key: 'BASIC',
      category: 'EARNING',
      current: 100000,
      previous: 95000,
      delta: 5000,
      deltaPct: 5.26,
      employeesAffected: 1,
    },
  ],
};

describe('PayrollVariancePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (payrollApi.getRuns as jest.Mock).mockResolvedValue({ data: runs });
    (payrollAccountingApi.getVariance as jest.Mock).mockResolvedValue({ data: report });
  });

  it('loads runs and the default variance report for the first run', async () => {
    render(<PayrollVariancePage />);

    await waitFor(() =>
      expect(payrollAccountingApi.getVariance).toHaveBeenCalledWith({
        runId: 'run-1',
        compareRunId: undefined,
        thresholdPct: 10,
      }),
    );

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('John Roe')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
  });

  it('filters the employee table to flagged rows only', async () => {
    render(<PayrollVariancePage />);
    await screen.findByText('Jane Doe');

    fireEvent.click(screen.getByLabelText(/flagged only/i));

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('John Roe')).not.toBeInTheDocument();
  });

  it('downloads the variance CSV for the selected run', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    (payrollAccountingApi.exportVariance as jest.Mock).mockResolvedValue({ data: blob });
    render(<PayrollVariancePage />);
    await screen.findByText('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));

    await waitFor(() =>
      expect(payrollAccountingApi.exportVariance).toHaveBeenCalledWith({
        runId: 'run-1',
        compareRunId: undefined,
        thresholdPct: 10,
      }),
    );
  });
});
