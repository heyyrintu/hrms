import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ProofReviewPage from './page';
import { employeesApi, proofsApi } from '@/lib/api';
import toast from 'react-hot-toast';

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
    user: { id: '1', email: 'payroll@test.com', role: 'HR_ADMIN', tenantId: 't1' },
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

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <label>
      {label}
      <input {...props} />
      {error ? <span>{error}</span> : null}
    </label>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options, placeholder, ...props }: any) => (
    <label>
      {label}
      <select {...props}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {(options ?? []).map((option: any) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {title}
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock API
jest.mock('@/lib/api', () => ({
  proofsApi: {
    listForReview: jest.fn(),
    summaryFor: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    download: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn(),
  },
}));

const mockedProofsApi = proofsApi as jest.Mocked<typeof proofsApi>;
const mockedToast = toast as unknown as { success: jest.Mock; error: jest.Mock };

const upload = (fileName: string) => ({
  id: `up-${fileName}`,
  fileName,
  mimeType: 'application/pdf',
  size: 24_000,
});

/** Pending: still awaiting a person's decision. */
const pendingProof = {
  id: 'p1',
  tenantId: 't1',
  employeeId: 'e1',
  financialYear: 2026,
  section: 'SECTION_80C',
  status: 'PENDING',
  claimedAmount: '150000.00',
  verifiedAmount: null,
  uploadId: 'up-elss-statement.pdf',
  description: 'ELSS statement for the year',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2027-01-04T09:00:00.000Z',
  updatedAt: '2027-01-04T09:00:00.000Z',
  upload: upload('elss-statement.pdf'),
  employee: {
    id: 'e1',
    firstName: 'Asha',
    lastName: 'Nair',
    employeeCode: 'EMP-001',
    department: { name: 'Engineering' },
  },
};

/** Decided: a record now, not a queue item. */
const decidedProof = {
  id: 'p2',
  tenantId: 't1',
  employeeId: 'e2',
  financialYear: 2026,
  section: 'SECTION_80D',
  status: 'APPROVED',
  claimedAmount: '80000.00',
  verifiedAmount: '60000.00',
  uploadId: 'up-mediclaim.pdf',
  description: 'Mediclaim receipts',
  reviewedBy: 'u9',
  reviewedAt: '2027-02-12T06:30:00.000Z',
  reviewNote: 'Only two of the three premiums are evidenced.',
  createdAt: '2027-01-05T09:00:00.000Z',
  updatedAt: '2027-02-12T06:30:00.000Z',
  upload: upload('mediclaim.pdf'),
  employee: {
    id: 'e2',
    firstName: 'Bhavna',
    lastName: 'Rao',
    employeeCode: 'EMP-002',
    department: { name: 'Finance' },
  },
  reviewer: { id: 'u9', firstName: 'Rita', lastName: 'Sen' },
};

const summary = {
  financialYear: 2026,
  verificationInForce: true,
  cutoffMonth: 1,
  rows: [
    {
      section: 'SECTION_80C',
      declared: '150000.00',
      claimed: '150000.00',
      approved: '120000.00',
      pendingCount: 1,
      rejectedCount: 0,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (employeesApi.getAll as jest.Mock).mockResolvedValue({
    data: {
      data: [
        { id: 'e1', firstName: 'Asha', lastName: 'Nair', employeeCode: 'EMP-001' },
        { id: 'e2', firstName: 'Bhavna', lastName: 'Rao', employeeCode: 'EMP-002' },
      ],
    },
  });
  mockedProofsApi.listForReview.mockResolvedValue({
    data: [pendingProof, decidedProof],
  } as never);
  mockedProofsApi.summaryFor.mockResolvedValue({ data: summary } as never);
  mockedProofsApi.download.mockResolvedValue(undefined as never);
  mockedProofsApi.approve.mockResolvedValue({ data: {} } as never);
  mockedProofsApi.reject.mockResolvedValue({ data: {} } as never);
});

/** Row scoping: the queue holds more than one proof at a time. */
const row = async (id: string) =>
  within(await screen.findByTestId(`proof-${id}`));

/** Opens the review form for a pending proof and reads its document. */
const openReview = async (action: 'Approve' | 'Reject') => {
  fireEvent.click((await row('p1')).getByRole('button', { name: action }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: /open document/i }));
  await waitFor(() => expect(mockedProofsApi.download).toHaveBeenCalled());
  return dialog;
};

describe('ProofReviewPage — the queue', () => {
  it('lists pending proofs with a way to open each document', async () => {
    render(<ProofReviewPage />);

    const pending = await row('p1');
    expect(pending.getByText(/Asha Nair/)).toBeInTheDocument();
    expect(pending.getByText('Section 80C')).toBeInTheDocument();
    expect(pending.getByText('₹1,50,000.00')).toBeInTheDocument();

    fireEvent.click(pending.getByRole('button', { name: /open document/i }));

    await waitFor(() => {
      expect(mockedProofsApi.download).toHaveBeenCalledWith('p1', 'elss-statement.pdf');
    });
  });

  it('claims nothing was checked automatically', async () => {
    render(<ProofReviewPage />);
    await screen.findByTestId('proof-p1');
    expect(document.body.textContent).not.toMatch(/verified automatically|automatically verified/i);
  });
});

describe('ProofReviewPage — a decided proof is a record', () => {
  it('offers neither approve nor reject on a proof that already has a decision', async () => {
    render(<ProofReviewPage />);

    const decided = await row('p2');
    expect(decided.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(decided.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    // The evidence stays readable even once the decision is made.
    expect(decided.getByRole('button', { name: /open document/i })).toBeInTheDocument();
  });

  it('shows who decided, when, what was accepted, and the note', async () => {
    render(<ProofReviewPage />);

    const decided = await row('p2');
    expect(decided.getByText(/Rita Sen/)).toBeInTheDocument();
    expect(decided.getByText(/12 Feb 2027/)).toBeInTheDocument();
    expect(decided.getByText('₹60,000.00')).toBeInTheDocument();
    expect(
      decided.getByText('Only two of the three premiums are evidenced.'),
    ).toBeInTheDocument();
  });
});

describe('ProofReviewPage — the claim in context', () => {
  it('shows what was declared and what is already approved beside the claim', async () => {
    render(<ProofReviewPage />);

    fireEvent.click((await row('p1')).getByRole('button', { name: 'Approve' }));
    const dialog = within(await screen.findByRole('dialog'));

    await waitFor(() => {
      expect(mockedProofsApi.summaryFor).toHaveBeenCalledWith('e1', 2026);
    });

    const declared = await dialog.findByTestId('context-declared');
    expect(declared).toHaveTextContent('₹1,50,000.00');
    expect(dialog.getByTestId('context-approved')).toHaveTextContent('₹1,20,000.00');
    expect(dialog.getByTestId('context-claimed')).toHaveTextContent('₹1,50,000.00');
  });
});

describe('ProofReviewPage — the form refuses what the server would', () => {
  it('refuses an accepted amount above the claim, naming the limit, and sends nothing', async () => {
    render(<ProofReviewPage />);

    const dialog = await openReview('Approve');
    fireEvent.change(dialog.getByLabelText(/accepted amount/i), {
      target: { value: '160000' },
    });
    fireEvent.click(dialog.getByRole('button', { name: /record approval/i }));

    // The message names the limit rather than saying only that it is too high.
    const error = await dialog.findByText(/cannot be more than the claimed/i);
    expect(error).toHaveTextContent('₹1,50,000.00');
    expect(mockedProofsApi.approve).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only rejection note and sends nothing', async () => {
    render(<ProofReviewPage />);

    const dialog = await openReview('Reject');
    fireEvent.change(dialog.getByLabelText(/reason/i), { target: { value: '   ' } });
    fireEvent.click(dialog.getByRole('button', { name: /record rejection/i }));

    expect(await dialog.findByText(/needs a reason/i)).toBeInTheDocument();
    expect(mockedProofsApi.reject).not.toHaveBeenCalled();
  });

  it('will not record a decision before the document has been opened', async () => {
    render(<ProofReviewPage />);

    fireEvent.click((await row('p1')).getByRole('button', { name: 'Approve' }));
    const dialog = within(await screen.findByRole('dialog'));

    expect(dialog.getByRole('button', { name: /record approval/i })).toBeDisabled();
    expect(dialog.getByText(/open the document before/i)).toBeInTheDocument();
  });

  it('sends the claimed figure by default, as a number, and reloads', async () => {
    render(<ProofReviewPage />);

    const dialog = await openReview('Approve');
    fireEvent.click(dialog.getByRole('button', { name: /record approval/i }));

    await waitFor(() => {
      expect(mockedProofsApi.approve).toHaveBeenCalledWith('p1', { verifiedAmount: 150000 });
    });
    await waitFor(() => {
      expect(mockedProofsApi.listForReview).toHaveBeenCalledTimes(2);
    });
  });

  it('accepts a figure below the claim', async () => {
    render(<ProofReviewPage />);

    const dialog = await openReview('Approve');
    fireEvent.change(dialog.getByLabelText(/accepted amount/i), {
      target: { value: '120000.50' },
    });
    fireEvent.click(dialog.getByRole('button', { name: /record approval/i }));

    await waitFor(() => {
      expect(mockedProofsApi.approve).toHaveBeenCalledWith('p1', { verifiedAmount: 120000.5 });
    });
  });
});

describe('ProofReviewPage — two reviewers at once', () => {
  it('explains a 409 on approve and reloads rather than failing generically', async () => {
    mockedProofsApi.approve.mockRejectedValue({
      response: { status: 409, data: { message: 'This proof has already been reviewed' } },
    } as never);

    render(<ProofReviewPage />);

    const dialog = await openReview('Approve');
    fireEvent.click(dialog.getByRole('button', { name: /record approval/i }));

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalled();
    });
    const message = mockedToast.error.mock.calls[0][0] as string;
    expect(message).toMatch(/someone else/i);
    expect(message).toMatch(/This proof has already been reviewed/);
    expect(message).toMatch(/reload/i);

    await waitFor(() => {
      expect(mockedProofsApi.listForReview).toHaveBeenCalledTimes(2);
    });
  });

  it('explains a 409 on reject and reloads rather than failing generically', async () => {
    mockedProofsApi.reject.mockRejectedValue({
      response: { status: 409, data: { message: 'This proof has already been reviewed' } },
    } as never);

    render(<ProofReviewPage />);

    const dialog = await openReview('Reject');
    fireEvent.change(dialog.getByLabelText(/reason/i), {
      target: { value: 'The receipt is for the wrong year.' },
    });
    fireEvent.click(dialog.getByRole('button', { name: /record rejection/i }));

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalled();
    });
    expect(mockedToast.error.mock.calls[0][0] as string).toMatch(/someone else/i);

    await waitFor(() => {
      expect(mockedProofsApi.listForReview).toHaveBeenCalledTimes(2);
    });
  });
});
