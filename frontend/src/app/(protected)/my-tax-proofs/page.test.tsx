import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import MyTaxProofsPage from './page';
import { proofsApi, statutoryApi } from '@/lib/api';
import { formatINR } from '@/components/form16/money';
import type { InvestmentProof, ProofSummary } from '@/types/proofs';

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
    user: { id: '1', email: 'employee@test.com', role: 'EMPLOYEE', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: false,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(false),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock UI components, one per import path
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <span>
      <input aria-label={label} {...props} />
      {error ? <span>{error}</span> : null}
    </span>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, error, options, placeholder, children, ...props }: any) => (
    <span>
      <select aria-label={label} {...props}>
        {children ??
          (options ?? []).map((option: any) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
      {error ? <span>{error}</span> : null}
    </span>
  ),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock the API. The two constants are real values from the module under mock,
// so the page's checks are the checks the uploads endpoint would apply.
jest.mock('@/lib/api', () => ({
  PROOF_MAX_FILE_BYTES: 10 * 1024 * 1024,
  PROOF_ACCEPTED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ],
  proofsApi: {
    uploadFile: jest.fn(),
    submit: jest.fn(),
    listMine: jest.fn(),
    mySummary: jest.fn(),
    withdraw: jest.fn(),
    download: jest.fn(),
  },
  statutoryApi: {
    getConfig: jest.fn(),
  },
}));

const mockedProofsApi = proofsApi as jest.Mocked<typeof proofsApi>;
const mockedStatutoryApi = statutoryApi as jest.Mocked<typeof statutoryApi>;
const mockedToast = toast as unknown as { success: jest.Mock; error: jest.Mock };

const FY = 2026;

function makeProof(overrides: Partial<InvestmentProof>): InvestmentProof {
  return {
    id: 'p0',
    tenantId: 't1',
    employeeId: 'e1',
    financialYear: FY,
    section: 'SECTION_80C' as InvestmentProof['section'],
    status: 'PENDING' as InvestmentProof['status'],
    claimedAmount: '10000.00',
    verifiedAmount: null,
    uploadId: 'u0',
    description: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-12-01T06:30:00.000Z',
    updatedAt: '2026-12-01T06:30:00.000Z',
    upload: { id: 'u0', fileName: 'receipt.pdf', mimeType: 'application/pdf', size: 2048 },
    ...overrides,
  };
}

const pendingProof = makeProof({
  id: 'p1',
  section: 'SECTION_80D' as InvestmentProof['section'],
  status: 'PENDING' as InvestmentProof['status'],
  claimedAmount: '25000.00',
  description: 'Health insurance premium receipt',
  upload: { id: 'u1', fileName: 'premium.pdf', mimeType: 'application/pdf', size: 4096 },
});

const rejectedProof = makeProof({
  id: 'p2',
  status: 'REJECTED' as InvestmentProof['status'],
  claimedAmount: '20000.00',
  reviewNote: 'The receipt is dated in FY 2025-26, so it cannot support this year.',
  reviewedAt: '2026-12-05T06:30:00.000Z',
});

const partialProof = makeProof({
  id: 'p3',
  status: 'APPROVED' as InvestmentProof['status'],
  claimedAmount: '150000.00',
  verifiedAmount: '80000.00',
  reviewNote: 'Only the LIC premium receipts were supported.',
  reviewedAt: '2026-12-06T06:30:00.000Z',
});

const summary: ProofSummary = {
  financialYear: FY,
  // The employer requires proofs, but the cutoff month has not arrived, so the
  // declared figure still stands for now. Those are two different facts.
  verificationRequired: true,
  verificationInForce: false,
  cutoffMonth: 1,
  rows: [
    {
      section: 'SECTION_80C' as InvestmentProof['section'],
      declared: '150000.00',
      claimed: '170000.00',
      approved: '80000.00',
      pendingCount: 0,
      rejectedCount: 1,
    },
    {
      section: 'SECTION_80D' as InvestmentProof['section'],
      declared: '25000.00',
      claimed: '25000.00',
      approved: '0.00',
      pendingCount: 1,
      rejectedCount: 0,
    },
  ],
};

function setup(options?: { summary?: Partial<ProofSummary>; proofs?: InvestmentProof[] }) {
  mockedProofsApi.mySummary.mockResolvedValue({
    data: { ...summary, ...(options?.summary ?? {}) },
  } as any);
  mockedProofsApi.listMine.mockResolvedValue({
    data: options?.proofs ?? [pendingProof, rejectedProof, partialProof],
  } as any);
}

/** Fills the submit form with a valid claim and the given file. */
async function openFormWith(values: { amount?: string; file?: File | null }) {
  fireEvent.click(await screen.findByRole('button', { name: 'Submit a proof' }));
  const dialog = await screen.findByRole('dialog');

  fireEvent.change(within(dialog).getByLabelText('Head'), {
    target: { value: 'SECTION_80C' },
  });
  fireEvent.change(within(dialog).getByLabelText('Amount claimed'), {
    target: { value: values.amount ?? '50000' },
  });
  if (values.file) {
    fireEvent.change(within(dialog).getByLabelText('Document'), {
      target: { files: [values.file] },
    });
  }
  return dialog;
}

function makeFile(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const goodFile = () => makeFile('receipt.pdf', 'application/pdf');

beforeEach(() => {
  jest.clearAllMocks();
  setup();
});

describe('MyTaxProofsPage', () => {
  it('renders the heading', async () => {
    render(<MyTaxProofsPage />);
    expect(await screen.findByText('My investment proofs')).toBeInTheDocument();
  });

  it('never suggests proofs are checked automatically', async () => {
    render(<MyTaxProofsPage />);
    expect(
      await screen.findByText(/A person in payroll reviews every document/i),
    ).toBeInTheDocument();
  });

  describe('the summary', () => {
    it('shows declared and approved together for each head', async () => {
      render(<MyTaxProofsPage />);

      const row80C = await screen.findByTestId('summary-row-SECTION_80C');
      expect(within(row80C).getByText('Section 80C')).toBeInTheDocument();
      expect(within(row80C).getByTestId('declared')).toHaveTextContent(formatINR('150000.00'));
      expect(within(row80C).getByTestId('approved')).toHaveTextContent(formatINR('80000.00'));

      const row80D = await screen.findByTestId('summary-row-SECTION_80D');
      expect(within(row80D).getByTestId('declared')).toHaveTextContent(formatINR('25000.00'));
      expect(within(row80D).getByTestId('approved')).toHaveTextContent(formatINR('0.00'));
    });

    it('shows what is still unproved for each head', async () => {
      render(<MyTaxProofsPage />);

      const row80C = await screen.findByTestId('summary-row-SECTION_80C');
      // 150000 declared less 80000 approved.
      expect(within(row80C).getByTestId('unproved')).toHaveTextContent(formatINR('70000.00'));
    });
  });

  describe('what happens if the employee does nothing', () => {
    it('says an unproved head allows nothing when verification is in force', async () => {
      setup({ summary: { verificationInForce: true } });
      render(<MyTaxProofsPage />);

      const notice = await screen.findByTestId('verification-notice');
      expect(notice).toHaveTextContent(/Only approved amounts count towards your tax now/i);
      expect(notice).toHaveTextContent(/more tax is deducted/i);
    });

    it('says the declared figure still stands, and names the month, before the cutoff', async () => {
      setup({ summary: { verificationInForce: false, cutoffMonth: 1 } });
      render(<MyTaxProofsPage />);

      const notice = await screen.findByTestId('verification-notice');
      expect(notice).toHaveTextContent(/still stand for now/i);
      expect(notice).toHaveTextContent(/From January/);
      expect(notice).not.toHaveTextContent(/Only approved amounts count towards your tax now/i);
    });

    it('invents no deadline when the employer has not enabled verification', async () => {
      setup({ summary: { verificationRequired: false, verificationInForce: false } });
      render(<MyTaxProofsPage />);

      const notice = await screen.findByTestId('verification-notice');
      expect(notice).toHaveTextContent(/has not switched on proof verification/i);
      expect(notice).not.toHaveTextContent(/From January/);
    });
  });

  describe('refusing a submission before anything is uploaded', () => {
    it('refuses a file that is too large', async () => {
      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({
        file: makeFile('big-scan.pdf', 'application/pdf', 40 * 1024 * 1024),
      });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      expect(await screen.findByText(/must be 10 MB or smaller/i)).toBeInTheDocument();
      expect(mockedProofsApi.uploadFile).not.toHaveBeenCalled();
      expect(mockedProofsApi.submit).not.toHaveBeenCalled();
    });

    it('refuses a file of the wrong type', async () => {
      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({
        file: makeFile('receipts.zip', 'application/zip'),
      });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      expect(await screen.findByText(/must be a PDF or an image/i)).toBeInTheDocument();
      expect(mockedProofsApi.uploadFile).not.toHaveBeenCalled();
      expect(mockedProofsApi.submit).not.toHaveBeenCalled();
    });

    it('refuses a negative claimed amount, naming the field', async () => {
      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({ amount: '-50000', file: goodFile() });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      expect(
        await screen.findByText(/Amount claimed cannot be negative/i),
      ).toBeInTheDocument();
      expect(mockedProofsApi.uploadFile).not.toHaveBeenCalled();
      expect(mockedProofsApi.submit).not.toHaveBeenCalled();
    });

    it('refuses an unreadable claimed amount, naming the field, without turning it into zero', async () => {
      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({ amount: 'about fifty', file: goodFile() });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      const message = await screen.findByText(/Amount claimed must be an amount in rupees/i);
      expect(message).toBeInTheDocument();
      expect(mockedProofsApi.uploadFile).not.toHaveBeenCalled();
      expect(mockedProofsApi.submit).not.toHaveBeenCalled();
    });
  });

  describe('submitting', () => {
    it('uploads the file and then creates the proof from the upload it returned', async () => {
      mockedProofsApi.uploadFile.mockResolvedValue({ data: { id: 'upload-9' } } as any);
      mockedProofsApi.submit.mockResolvedValue({ data: makeProof({ id: 'p9' }) } as any);

      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({ amount: '50,000', file: goodFile() });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      await waitFor(() => expect(mockedProofsApi.submit).toHaveBeenCalled());
      expect(mockedProofsApi.uploadFile).toHaveBeenCalledTimes(1);
      expect(mockedProofsApi.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          section: 'SECTION_80C',
          claimedAmount: 50000,
          uploadId: 'upload-9',
        }),
      );
    });

    it('creates no proof when the upload fails', async () => {
      mockedProofsApi.uploadFile.mockRejectedValue(new Error('network'));

      render(<MyTaxProofsPage />);
      const dialog = await openFormWith({ amount: '50000', file: goodFile() });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload and submit' }));

      await waitFor(() => expect(mockedToast.error).toHaveBeenCalled());
      expect(mockedProofsApi.submit).not.toHaveBeenCalled();
    });
  });

  describe('a proof that was reviewed', () => {
    it('always shows the reason a proof was rejected', async () => {
      render(<MyTaxProofsPage />);

      const card = await screen.findByTestId('proof-p2');
      expect(within(card).getByTestId('review-reason')).toHaveTextContent(
        'The receipt is dated in FY 2025-26, so it cannot support this year.',
      );
    });

    it('shows a reason even when the reviewer recorded none', async () => {
      setup({ proofs: [makeProof({ id: 'p8', status: 'REJECTED' as InvestmentProof['status'] })] });
      render(<MyTaxProofsPage />);

      const card = await screen.findByTestId('proof-p8');
      expect(within(card).getByTestId('review-reason')).toHaveTextContent(/No reason was recorded/i);
    });

    it('shows claimed, accepted and the shortfall on a partial approval', async () => {
      render(<MyTaxProofsPage />);

      const card = await screen.findByTestId('proof-p3');
      expect(within(card).getByTestId('claimed')).toHaveTextContent(formatINR('150000.00'));
      expect(within(card).getByTestId('accepted')).toHaveTextContent(formatINR('80000.00'));
      expect(within(card).getByTestId('shortfall')).toHaveTextContent(formatINR('70000.00'));
    });
  });

  describe('withdrawing', () => {
    it('offers withdrawal only while a proof is still pending', async () => {
      render(<MyTaxProofsPage />);

      const pending = await screen.findByTestId('proof-p1');
      expect(within(pending).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();

      const rejected = screen.getByTestId('proof-p2');
      expect(within(rejected).queryByRole('button', { name: 'Withdraw' })).toBeNull();

      const approved = screen.getByTestId('proof-p3');
      expect(within(approved).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    });

    it('confirms before withdrawing', async () => {
      mockedProofsApi.withdraw.mockResolvedValue({ data: null } as any);
      render(<MyTaxProofsPage />);

      const pending = await screen.findByTestId('proof-p1');
      fireEvent.click(within(pending).getByRole('button', { name: 'Withdraw' }));

      const dialog = await screen.findByRole('dialog');
      expect(mockedProofsApi.withdraw).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw proof' }));
      await waitFor(() => expect(mockedProofsApi.withdraw).toHaveBeenCalledWith('p1'));
    });
  });

  it('does not read the tenant configuration, which employees may not', async () => {
    // GET /payroll/statutory/config is limited to payroll staff. Reading it
    // here would fail for every ordinary employee, and the notice would
    // permanently say it could not tell. The summary carries the flag instead.
    render(<MyTaxProofsPage />);

    await waitFor(() => expect(mockedProofsApi.mySummary).toHaveBeenCalled());

    expect(mockedStatutoryApi.getConfig).not.toHaveBeenCalled();
  });
});
