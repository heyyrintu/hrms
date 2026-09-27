import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import PayrollAccountingPage from './page';
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
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
    getGlMappings: jest.fn(),
    replaceGlMappings: jest.fn(),
    getJournal: jest.fn(),
    exportJournal: jest.fn(),
  },
}));

const runs = [
  { id: 'run-1', month: 9, year: 2026, runType: 'REGULAR', sequence: 0, status: 'APPROVED' },
];

const config = {
  suspenseGlCode: null,
  suspenseGlName: null,
  costCenterMode: 'NONE',
  tallyCompanyName: null,
  tallyVoucherType: 'Journal',
  narrationTemplate: 'Salary for {{month}} {{year}}',
};

const mappingsResponse = {
  mappings: [{ componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }],
  knownKeys: [
    { key: 'BASIC', label: 'Basic pay', category: 'EARNING', side: 'DEBIT', isSystem: true, mapped: true },
    { key: 'NET_PAY', label: 'Net pay', category: 'NET', side: 'CREDIT', isSystem: true, mapped: false },
  ],
};

const journalPreview = {
  runId: 'run-1',
  month: 9,
  year: 2026,
  runType: 'REGULAR',
  sequence: 0,
  status: 'APPROVED',
  voucherDate: '2026-09-30',
  narration: 'Salary for September 2026',
  lines: [
    { glCode: '4001', glName: 'Salaries', costCenter: null, side: 'DEBIT', debit: 50000, credit: 0, componentKeys: ['BASIC'] },
  ],
  totalDebit: 50000,
  totalCredit: 50000,
  balanced: true,
  unmappedKeys: ['NET_PAY'],
  exportable: true,
};

describe('PayrollAccountingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (payrollApi.getRuns as jest.Mock).mockResolvedValue({ data: runs });
    (payrollAccountingApi.getConfig as jest.Mock).mockResolvedValue({ data: config });
    (payrollAccountingApi.getGlMappings as jest.Mock).mockResolvedValue({ data: mappingsResponse });
    (payrollAccountingApi.getJournal as jest.Mock).mockResolvedValue({ data: journalPreview });
  });

  it('loads settings, mappings and the journal preview for the first run', async () => {
    render(<PayrollAccountingPage />);

    await waitFor(() => expect(screen.getByText('Export settings')).toBeInTheDocument());

    expect(payrollAccountingApi.getConfig).toHaveBeenCalled();
    expect(payrollAccountingApi.getGlMappings).toHaveBeenCalled();
    await waitFor(() => expect(payrollAccountingApi.getJournal).toHaveBeenCalledWith('run-1', false));

    await waitFor(() => expect(screen.getByText('Balanced')).toBeInTheDocument());
    expect(screen.getByText(/1 key with no GL mapping/)).toBeInTheDocument();
  });

  it('saves the accounting config', async () => {
    (payrollAccountingApi.updateConfig as jest.Mock).mockResolvedValue({ data: { ...config, tallyVoucherType: 'Payment' } });
    render(<PayrollAccountingPage />);
    await waitFor(() => expect(screen.getByText('Export settings')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(payrollAccountingApi.updateConfig).toHaveBeenCalled());
  });

  it('saves only the mapping rows that have both a GL code and a GL name filled in', async () => {
    (payrollAccountingApi.replaceGlMappings as jest.Mock).mockResolvedValue({ data: mappingsResponse });
    render(<PayrollAccountingPage />);
    await waitFor(() => expect(screen.getByText('GL mappings')).toBeInTheDocument());

    const netPayCodeInput = screen.getByLabelText('GL code for NET_PAY');
    fireEvent.change(netPayCodeInput, { target: { value: '2002' } });
    const netPayNameInput = screen.getByLabelText('GL name for NET_PAY');
    fireEvent.change(netPayNameInput, { target: { value: 'Salaries payable' } });

    fireEvent.click(screen.getByRole('button', { name: /save all mappings/i }));

    await waitFor(() =>
      expect(payrollAccountingApi.replaceGlMappings).toHaveBeenCalledWith([
        { componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' },
        { componentKey: 'NET_PAY', glCode: '2002', glName: 'Salaries payable' },
      ]),
    );
  });

  it('downloads the CSV journal export for the selected run', async () => {
    (payrollAccountingApi.getJournal as jest.Mock).mockResolvedValue({
      data: { ...journalPreview, unmappedKeys: [] },
    });
    const blob = new Blob(['csv-content'], { type: 'text/csv' });
    (payrollAccountingApi.exportJournal as jest.Mock).mockResolvedValue({ data: blob });
    render(<PayrollAccountingPage />);

    await waitFor(() => expect(screen.getByText('Balanced')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));

    await waitFor(() =>
      expect(payrollAccountingApi.exportJournal).toHaveBeenCalledWith('run-1', 'csv', false),
    );
  });
});
