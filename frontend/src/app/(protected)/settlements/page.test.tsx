import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import SettlementsPage from './page';
import { settlementApi, exitApi } from '@/lib/api';

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

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

// Mock API
jest.mock('@/lib/api', () => ({
  settlementApi: {
    getBySeparation: jest.fn(),
  },
  exitApi: {
    getAll: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

// Mock types
jest.mock('@/types', () => ({
  SettlementStatus: {
    DRAFT: 'DRAFT',
    APPROVED: 'APPROVED',
    PAID: 'PAID',
    CANCELLED: 'CANCELLED',
  },
  SeparationStatus: {
    INITIATED: 'INITIATED',
    NOTICE_PERIOD: 'NOTICE_PERIOD',
    CLEARANCE_PENDING: 'CLEARANCE_PENDING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },
  SeparationType: {
    RESIGNATION: 'RESIGNATION',
    TERMINATION: 'TERMINATION',
    RETIREMENT: 'RETIREMENT',
    END_OF_CONTRACT: 'END_OF_CONTRACT',
    MUTUAL_SEPARATION: 'MUTUAL_SEPARATION',
    ABSCONDING: 'ABSCONDING',
  },
}));

const mockedSettlementApi = settlementApi as jest.Mocked<typeof settlementApi>;
const mockedExitApi = exitApi as jest.Mocked<typeof exitApi>;

const makeSeparation = (over: Record<string, unknown>) => ({
  id: 'sep-1',
  tenantId: 't1',
  employeeId: 'emp-1',
  type: 'RESIGNATION',
  status: 'CLEARANCE_PENDING',
  initiatedDate: '2026-03-01T00:00:00.000Z',
  lastWorkingDate: '2026-04-20T00:00:00.000Z',
  noticePeriodDays: 60,
  isNoticePeriodWaived: false,
  exitInterviewDone: false,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  employee: {
    id: 'emp-1',
    firstName: 'Asha',
    lastName: 'Rao',
    employeeCode: 'EMP-014',
    email: 'asha@example.com',
    department: { name: 'Engineering' },
  },
  ...over,
});

const asha = makeSeparation({});
const brij = makeSeparation({
  id: 'sep-2',
  employeeId: 'emp-2',
  type: 'RETIREMENT',
  status: 'COMPLETED',
  employee: {
    id: 'emp-2',
    firstName: 'Brij',
    lastName: 'Nair',
    employeeCode: 'EMP-022',
    email: 'brij@example.com',
    department: { name: 'Finance' },
  },
});

const settlementFor = (separationId: string, status: string, netPayable: string) => ({
  id: `set-${separationId}`,
  separationId,
  status,
  netPayable,
  grossPayable: netPayable,
  totalRecoveries: '0.00',
  lastWorkingDate: '2026-04-20T00:00:00.000Z',
});

const notFound = { response: { status: 404, data: { message: 'No settlement' } } };

beforeEach(() => {
  jest.clearAllMocks();
  mockedExitApi.getAll.mockResolvedValue({ data: [asha, brij] } as never);
  mockedSettlementApi.getBySeparation.mockImplementation((id: string) => {
    if (id === 'sep-1') {
      return Promise.resolve({ data: settlementFor('sep-1', 'DRAFT', '151987.15') }) as never;
    }
    return Promise.reject(notFound) as never;
  });
});

describe('SettlementsPage', () => {
  it('renders the heading', async () => {
    render(<SettlementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Full & Final Settlements')).toBeInTheDocument();
    });
  });

  it('lists a separation with its settlement state and net payable', async () => {
    render(<SettlementsPage />);

    const row = await screen.findByTestId('settlement-row-sep-1');
    expect(within(row).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(row).getByText('DRAFT')).toBeInTheDocument();
    expect(within(row).getByText('₹1,51,987.15')).toBeInTheDocument();
  });

  it('shows a separation with no settlement as not computed, not as an error', async () => {
    render(<SettlementsPage />);

    const row = await screen.findByTestId('settlement-row-sep-2');
    expect(within(row).getByText(/not computed/i)).toBeInTheDocument();
  });

  it('links each separation through to its settlement', async () => {
    render(<SettlementsPage />);

    const row = await screen.findByTestId('settlement-row-sep-1');
    const link = within(row).getByRole('link');
    expect(link).toHaveAttribute('href', '/settlements/sep-1');
  });

  it('filters by employee name', async () => {
    render(<SettlementsPage />);

    await screen.findByTestId('settlement-row-sep-1');

    fireEvent.change(screen.getByPlaceholderText(/search by employee/i), {
      target: { value: 'Brij' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('settlement-row-sep-1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('settlement-row-sep-2')).toBeInTheDocument();
  });

  it('filters by settlement state', async () => {
    render(<SettlementsPage />);

    await screen.findByTestId('settlement-row-sep-1');

    fireEvent.change(screen.getByLabelText(/settlement state/i), {
      target: { value: 'NOT_COMPUTED' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('settlement-row-sep-1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('settlement-row-sep-2')).toBeInTheDocument();
  });

  it('asks the server for separations filtered by status', async () => {
    render(<SettlementsPage />);

    await screen.findByTestId('settlement-row-sep-1');

    fireEvent.change(screen.getByLabelText(/separation status/i), {
      target: { value: 'COMPLETED' },
    });

    await waitFor(() => {
      expect(mockedExitApi.getAll).toHaveBeenLastCalledWith({ status: 'COMPLETED' });
    });
  });

  it('shows an empty state when nothing matches', async () => {
    mockedExitApi.getAll.mockResolvedValue({ data: [] } as never);

    render(<SettlementsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no separations found/i)).toBeInTheDocument();
    });
  });

  it('discards rows for a filter the user has already moved past', async () => {
    // Two filter changes a click apart. If the first reply lands last it wins,
    // and the table then shows rows that do not match the filter on screen.
    let releaseFirst = () => {};
    mockedExitApi.getAll.mockImplementation((params: any) => {
      if (params?.status === 'NOTICE_PERIOD') {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ data: [asha] });
        }) as never;
      }
      return Promise.resolve({ data: [brij] }) as never;
    });

    render(<SettlementsPage />);
    const filter = await screen.findByLabelText(/Separation status/i);
    fireEvent.change(filter, { target: { value: 'NOTICE_PERIOD' } });
    fireEvent.change(filter, { target: { value: 'CLEARANCE_PENDING' } });
    await screen.findByText(/Brij/);

    releaseFirst();
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(screen.queryByText(/Asha/)).not.toBeInTheDocument();
  });

  it('does not report a server failure as a settlement that was never computed', async () => {
    // Only a 404 means "no settlement yet". A 500 or a dropped connection tells
    // us nothing about whether one exists, and showing Compute against an
    // approved settlement invites someone to try replacing it.
    mockedExitApi.getAll.mockResolvedValue({ data: [asha] } as never);
    mockedSettlementApi.getBySeparation.mockRejectedValue({
      response: { status: 500, data: { message: 'Database unavailable' } },
    } as never);

    render(<SettlementsPage />);

    // "Not computed" also names a stat card and a filter option, so assert on
    // the row itself: its badge and the action it offers.
    const row = await screen.findByTestId('settlement-row-sep-1');
    expect(within(row).getByText(/Unavailable/i)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Open/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Compute/i })).not.toBeInTheDocument();
  });
});
