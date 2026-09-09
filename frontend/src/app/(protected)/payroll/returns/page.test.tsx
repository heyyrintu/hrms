import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';

import StatutoryReturnsPage from './page';
import { payrollApi, returnsApi } from '@/lib/api';

// Mock lucide-react icons
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

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock UI components (imported from individual paths in this page)
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, children, ...props }: any) => (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  ),
}));

// Mock API
jest.mock('@/lib/api', () => ({
  payrollApi: {
    getRuns: jest.fn(),
  },
  returnsApi: {
    preview: jest.fn(),
    download: jest.fn(),
    saveContent: jest.fn(),
  },
}));

// Mock types
jest.mock('@/types', () => ({
  PayrollRunStatus: {
    DRAFT: 'DRAFT',
    PROCESSING: 'PROCESSING',
    COMPUTED: 'COMPUTED',
    APPROVED: 'APPROVED',
    PAID: 'PAID',
  },
  StatutoryReturnKind: {
    PF_ECR: 'pf-ecr',
    ESI: 'esi',
    PROFESSIONAL_TAX: 'professional-tax',
    FORM_24Q: 'form-24q',
    BANK_TRANSFER: 'bank-transfer',
  },
}));

const getRuns = payrollApi.getRuns as jest.Mock;
const preview = returnsApi.preview as jest.Mock;
const download = returnsApi.download as jest.Mock;
const saveContent = returnsApi.saveContent as jest.Mock;

const computedRun = {
  id: 'run-computed',
  tenantId: 't1',
  month: 3,
  year: 2025,
  status: 'COMPUTED',
  totalGross: '1500000.00',
  totalDeductions: '265432.11',
  totalNet: '1234567.89',
  processedCount: 42,
  createdAt: '2025-03-31T12:00:00Z',
  updatedAt: '2025-03-31T12:00:00Z',
};

const draftRun = {
  ...computedRun,
  id: 'run-draft',
  month: 4,
  status: 'DRAFT',
  processedCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  getRuns.mockResolvedValue({ data: [computedRun, draftRun] });
  preview.mockResolvedValue({
    data: {
      filename: 'ecr-2025-03.txt',
      contentType: 'text/plain',
      content: 'ECR#LINE#ONE',
      warnings: [],
    },
  });
  download.mockResolvedValue(undefined);
});

describe('StatutoryReturnsPage', () => {
  it('renders the page heading once runs have loaded', async () => {
    render(<StatutoryReturnsPage />);

    expect(await screen.findByText('Statutory Returns')).toBeInTheDocument();
  });

  it('lists all five statutory files with a plain-English description', async () => {
    render(<StatutoryReturnsPage />);

    await screen.findByText('EPFO ECR');
    expect(screen.getByText('ESIC contribution')).toBeInTheDocument();
    expect(screen.getByText('Professional tax challan')).toBeInTheDocument();
    expect(screen.getByText('Form 24Q (TDS)')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer file')).toBeInTheDocument();
    expect(
      screen.getByText(/Electronic Challan cum Return uploaded to the EPFO/i),
    ).toBeInTheDocument();
  });

  it('offers computed runs and marks draft runs unavailable with the reason', async () => {
    render(<StatutoryReturnsPage />);

    const eligible = await screen.findByRole('option', { name: /March 2025/ });
    expect(eligible).not.toBeDisabled();

    const draft = screen.getByRole('option', { name: /April 2025/ });
    expect(draft).toBeDisabled();
    expect(draft).toHaveTextContent(/DRAFT/);

    expect(
      screen.getByText(/cannot produce statutory files until (it is|they are) processed/i),
    ).toBeInTheDocument();
  });

  it('cannot produce a file when the only run is a draft', async () => {
    getRuns.mockResolvedValue({ data: [draftRun] });
    render(<StatutoryReturnsPage />);

    await screen.findByText(/No payroll run is ready/i);
    expect(screen.getByLabelText('Preview EPFO ECR')).toBeDisabled();
    expect(screen.getByLabelText('Download EPFO ECR')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Preview EPFO ECR'));
    expect(preview).not.toHaveBeenCalled();
  });

  it('shows the net pay of the selected run formatted as Indian rupees', async () => {
    render(<StatutoryReturnsPage />);

    expect(await screen.findByText(/₹12,34,567.89/)).toBeInTheDocument();
  });

  it('renders the warnings returned by a preview', async () => {
    preview.mockResolvedValue({
      data: {
        filename: 'ecr-2025-03.txt',
        contentType: 'text/plain',
        content: 'ECR#LINE#ONE',
        warnings: [
          'Priya Sharma (EMP004) excluded: no UAN on record',
          'Arun Nair (EMP011) excluded: no UAN on record',
        ],
      },
    });

    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Preview EPFO ECR'));

    expect(
      await screen.findByText('Priya Sharma (EMP004) excluded: no UAN on record'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Arun Nair (EMP011) excluded: no UAN on record'),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 employees are missing from this file/i)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith('run-computed', 'pf-ecr');
  });

  it('states positively when a preview produced no warnings', async () => {
    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Preview EPFO ECR'));

    expect(
      await screen.findByText(/No employee was left out of this file/i),
    ).toBeInTheDocument();
  });

  it('shows the generated content of a preview', async () => {
    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Preview EPFO ECR'));

    expect(await screen.findByText('ECR#LINE#ONE')).toBeInTheDocument();
    expect(screen.getByText('ecr-2025-03.txt')).toBeInTheDocument();
  });

  it('saves a held preview without asking the server again', async () => {
    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Preview EPFO ECR'));
    await screen.findByText('ECR#LINE#ONE');

    fireEvent.click(screen.getByLabelText('Download EPFO ECR'));

    await waitFor(() => {
      expect(saveContent).toHaveBeenCalledWith('ECR#LINE#ONE', 'ecr-2025-03.txt', 'text/plain');
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads directly when no preview is held', async () => {
    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Download EPFO ECR'));

    await waitFor(() => {
      expect(download).toHaveBeenCalledWith('run-computed', 'pf-ecr', expect.any(String));
    });
  });

  it('surfaces an error when a download fails instead of failing silently', async () => {
    download.mockRejectedValue({
      response: { data: { message: 'Payroll run must be processed first' } },
    });

    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Download EPFO ECR'));

    expect(
      await screen.findByText('Payroll run must be processed first'),
    ).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Payroll run must be processed first');
  });

  it('surfaces an error when a preview fails instead of failing silently', async () => {
    preview.mockRejectedValue(new Error('network down'));

    render(<StatutoryReturnsPage />);
    fireEvent.click(await screen.findByLabelText('Preview EPFO ECR'));

    expect(await screen.findByText(/Could not generate the EPFO ECR file/i)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it('warns that the files are not ready to file as-is', async () => {
    render(<StatutoryReturnsPage />);

    expect(
      await screen.findByText(/None of these files are ready to file as they are/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/revised the ECR layout more than once/i)).toBeInTheDocument();
    expect(screen.getByText(/generic NEFT layout/i)).toBeInTheDocument();
    expect(screen.getByText(/section code 92B/i)).toBeInTheDocument();
  });

  it('reports a failure to load payroll runs', async () => {
    getRuns.mockRejectedValue(new Error('boom'));

    render(<StatutoryReturnsPage />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load payroll runs');
    });
  });
});
