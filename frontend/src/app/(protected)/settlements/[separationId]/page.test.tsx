import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import SettlementDetailPage from './page';
import { settlementApi, exitApi } from '@/lib/api';
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

// Mock next/navigation — the detail page reads the separation id from the route
jest.mock('next/navigation', () => ({
  useParams: () => ({ separationId: 'sep-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
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
  settlementApi: {
    compute: jest.fn(),
    getBySeparation: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    approve: jest.fn(),
    markAsPaid: jest.fn(),
  },
  exitApi: {
    getById: jest.fn(),
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
const mockedToast = toast as unknown as { success: jest.Mock; error: jest.Mock };

const separation = {
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
    joinDate: '2019-09-02T00:00:00.000Z',
  },
};

const eligibleGratuity = {
  eligible: true,
  ineligibleReason: null,
  serviceYears: '6.63',
  countedYears: '7',
  amount: '121153.85',
  exemptAmount: '121153.85',
  taxableAmount: '0.00',
};

const breakdown = {
  computedAt: '2026-04-30T00:00:00.000Z',
  lastDrawnWages: '30000.00',
  monthlyGross: '50000.00',
  proRata: {
    monthlyGross: '50000.00',
    daysWorked: 20,
    daysInMonth: 30,
    amount: '33333.33',
    note: 'Monthly gross apportioned over the calendar days in the month of the last working day.',
  },
  leaveEncashment: {
    enabled: true,
    basis: 'Last drawn basic plus dearness allowance',
    perDayRate: '1000.00',
    totalDays: '12.50',
    amount: '12500.00',
    leaveTypes: [
      { name: 'Earned Leave', days: '10.00' },
      { name: 'Casual Leave', days: '2.50' },
    ],
    note: 'The exemption under section 10(10AA) is not computed; the whole encashment is shown as payable.',
  },
  gratuity: eligibleGratuity,
  noticeRecovery: {
    waived: false,
    required: 60,
    served: 51,
    shortfallDays: 9,
    dailyRate: '1666.67',
    amount: '15000.03',
    note: 'Recovered at monthly gross divided by the calendar days in the month of the last working day.',
  },
  totals: {
    grossPayable: '166987.18',
    totalRecoveries: '15000.03',
    netPayable: '151987.15',
  },
};

const draftSettlement = {
  id: 'set-1',
  tenantId: 't1',
  separationId: 'sep-1',
  employeeId: 'emp-1',
  status: 'DRAFT',
  lastWorkingDate: '2026-04-20T00:00:00.000Z',
  proRataSalary: '33333.33',
  leaveEncashmentDays: '12.50',
  leaveEncashment: '12500.00',
  gratuity: '121153.85',
  gratuityExempt: '121153.85',
  otherEarnings: '0.00',
  noticeShortfallDays: 9,
  noticeRecovery: '15000.03',
  otherRecoveries: '0.00',
  tds: '0.00',
  grossPayable: '166987.18',
  totalRecoveries: '15000.03',
  netPayable: '151987.15',
  breakdown,
  remarks: null,
  approvedBy: null,
  approvedAt: null,
  paidAt: null,
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  employee: separation.employee,
  separation: {
    id: 'sep-1',
    type: 'RESIGNATION',
    status: 'CLEARANCE_PENDING',
    initiatedDate: '2026-03-01T00:00:00.000Z',
    lastWorkingDate: '2026-04-20T00:00:00.000Z',
    noticePeriodDays: 60,
    isNoticePeriodWaived: false,
  },
};

const notFound = {
  response: { status: 404, data: { message: 'No settlement has been computed for this separation' } },
};

const withGratuity = (gratuity: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  ...draftSettlement,
  ...overrides,
  breakdown: { ...breakdown, gratuity },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedExitApi.getById.mockResolvedValue({ data: separation } as never);
  mockedSettlementApi.getBySeparation.mockResolvedValue({ data: draftSettlement } as never);
});

describe('SettlementDetailPage — no settlement yet', () => {
  it('offers to compute rather than showing an error when none exists', async () => {
    mockedSettlementApi.getBySeparation.mockRejectedValue(notFound as never);

    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/no settlement has been computed/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /compute settlement/i })).toBeInTheDocument();
    expect(mockedToast.error).not.toHaveBeenCalled();
  });

  it('computes on request and shows the result', async () => {
    mockedSettlementApi.getBySeparation.mockRejectedValue(notFound as never);
    mockedSettlementApi.compute.mockResolvedValue({ data: draftSettlement } as never);

    render(<SettlementDetailPage />);

    const button = await screen.findByRole('button', { name: /compute settlement/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSettlementApi.compute).toHaveBeenCalledWith('sep-1', {
        waiveGratuityMinimumService: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('₹1,51,987.15')).toBeInTheDocument();
    });
  });

  it('states the narrow legal basis of the gratuity minimum-service waiver', async () => {
    mockedSettlementApi.getBySeparation.mockRejectedValue(notFound as never);

    render(<SettlementDetailPage />);

    await screen.findByRole('button', { name: /compute settlement/i });
    expect(
      screen.getByText(/only on death or permanent disablement/i),
    ).toBeInTheDocument();
  });
});

describe('SettlementDetailPage — the working', () => {
  it('shows the pro-rata working, not just the amount', async () => {
    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/20 of 30 days/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/monthly gross apportioned over the calendar days/i),
    ).toBeInTheDocument();
  });

  it('shows the leave encashment working with its leave types and 10(10AA) note', async () => {
    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Earned Leave/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Casual Leave/)).toBeInTheDocument();
    expect(
      screen.getByText(/section 10\(10AA\) is not computed/i),
    ).toBeInTheDocument();
  });

  it('shows the notice recovery working', async () => {
    render(<SettlementDetailPage />);

    const notice = await screen.findByTestId('notice-recovery-working');
    expect(within(notice).getByText('60')).toBeInTheDocument();
    expect(within(notice).getByText('51')).toBeInTheDocument();
    expect(within(notice).getByText('9')).toBeInTheDocument();
    expect(within(notice).getByText('₹1,666.67')).toBeInTheDocument();
    expect(
      within(notice).getByText(/recovered at monthly gross divided by the calendar days/i),
    ).toBeInTheDocument();
  });
});

describe('SettlementDetailPage — gratuity working', () => {
  it('shows the reason rather than a bare zero when ineligible', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: withGratuity(
        {
          eligible: false,
          ineligibleReason:
            'Continuous service of 3.20 years is under the five years the Payment of Gratuity Act 1972 requires',
          serviceYears: '3.20',
          countedYears: '0',
          amount: '0.00',
          exemptAmount: '0.00',
          taxableAmount: '0.00',
        },
        { gratuity: '0.00', gratuityExempt: '0.00' },
      ),
    } as never);

    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Not eligible/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/under the five years the Payment of Gratuity Act 1972 requires/i),
    ).toBeInTheDocument();
  });

  it('shows unrounded service years beside the counted years when eligible', async () => {
    render(<SettlementDetailPage />);

    const gratuity = await screen.findByTestId('gratuity-working');
    expect(within(gratuity).getByText('6.63')).toBeInTheDocument();
    expect(within(gratuity).getByText('7')).toBeInTheDocument();
    expect(
      within(gratuity).getByText(/part-year over six months counts as a full year/i),
    ).toBeInTheDocument();
  });

  it('shows the exempt and taxable parts separately, and says the amount itself is not capped', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: withGratuity({
        eligible: true,
        ineligibleReason: null,
        serviceYears: '31.40',
        countedYears: '31',
        amount: '2500000.00',
        exemptAmount: '2000000.00',
        taxableAmount: '500000.00',
      }),
    } as never);

    render(<SettlementDetailPage />);

    const gratuity = await screen.findByTestId('gratuity-working');
    expect(within(gratuity).getByText('₹25,00,000.00')).toBeInTheDocument();
    expect(within(gratuity).getByText('₹20,00,000.00')).toBeInTheDocument();
    expect(within(gratuity).getByText('₹5,00,000.00')).toBeInTheDocument();
    expect(
      within(gratuity).getByText(/payable in full; only the exemption is capped/i),
    ).toBeInTheDocument();
  });
});

describe('SettlementDetailPage — entered figures', () => {
  it('lets a draft be edited and saves the four entered figures', async () => {
    mockedSettlementApi.update.mockResolvedValue({
      data: { ...draftSettlement, tds: '5000.00', remarks: 'Cleared by IT' },
    } as never);

    render(<SettlementDetailPage />);

    const tds = (await screen.findByLabelText(/TDS/i)) as HTMLInputElement;
    expect(tds).not.toBeDisabled();
    fireEvent.change(tds, { target: { value: '5000' } });

    const remarks = screen.getByLabelText(/Remarks/i);
    fireEvent.change(remarks, { target: { value: 'Cleared by IT' } });

    fireEvent.click(screen.getByRole('button', { name: /save entered figures/i }));

    await waitFor(() => {
      expect(mockedSettlementApi.update).toHaveBeenCalledWith('set-1', {
        otherEarnings: 0,
        otherRecoveries: 0,
        tds: 5000,
        remarks: 'Cleared by IT',
      });
    });
  });

  it('says TDS is supplied rather than computed', async () => {
    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/entered by whoever processes the exit/i),
      ).toBeInTheDocument();
    });
  });

  it('does not allow the entered figures to be edited once approved', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: { ...draftSettlement, status: 'APPROVED', tds: '5000.00', remarks: 'Cleared by IT' },
    } as never);

    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('APPROVED')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/TDS/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save entered figures/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('₹5,000.00')).toBeInTheDocument();
  });
});

describe('SettlementDetailPage — actions', () => {
  it('offers approve but not pay while a draft', async () => {
    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recompute/i })).toBeInTheDocument();
  });

  it('offers pay but not approve or recompute once approved', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: { ...draftSettlement, status: 'APPROVED' },
    } as never);

    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recompute/i })).not.toBeInTheDocument();
  });

  it('offers no transition once paid', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: { ...draftSettlement, status: 'PAID' },
    } as never);

    render(<SettlementDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('PAID')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recompute/i })).not.toBeInTheDocument();
  });

  it('explains a 409 on approve and reloads instead of failing generically', async () => {
    mockedSettlementApi.approve.mockRejectedValue({
      response: {
        status: 409,
        data: { message: 'Settlement is no longer a draft' },
      },
    } as never);

    render(<SettlementDetailPage />);

    const approve = await screen.findByRole('button', { name: /^approve$/i });
    expect(mockedSettlementApi.getBySeparation).toHaveBeenCalledTimes(1);

    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalled();
    });
    const message = mockedToast.error.mock.calls[0][0] as string;
    expect(message).toMatch(/someone else/i);
    expect(message).toMatch(/Settlement is no longer a draft/);
    expect(message).toMatch(/reload/i);

    await waitFor(() => {
      expect(mockedSettlementApi.getBySeparation).toHaveBeenCalledTimes(2);
    });
  });
});

describe('SettlementDetailPage — recompute', () => {
  it('warns that entered figures are discarded before recomputing', async () => {
    mockedSettlementApi.getBySeparation.mockResolvedValue({
      data: { ...draftSettlement, tds: '5000.00', otherEarnings: '1200.00', remarks: 'Cleared' },
    } as never);
    mockedSettlementApi.compute.mockResolvedValue({ data: draftSettlement } as never);

    render(<SettlementDetailPage />);

    const recompute = await screen.findByRole('button', { name: /recompute/i });
    fireEvent.click(recompute);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/discard/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Other earnings/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/TDS/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Remarks/i)).toBeInTheDocument();
    expect(mockedSettlementApi.compute).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /recompute anyway/i }));

    await waitFor(() => {
      expect(mockedSettlementApi.compute).toHaveBeenCalledWith('sep-1', {
        waiveGratuityMinimumService: false,
      });
    });
  });

  it('refuses a negative recovery rather than letting the server reject it', async () => {
    render(<SettlementDetailPage />);

    const recoveries = (await screen.findByLabelText(/Other recoveries/i)) as HTMLInputElement;
    fireEvent.change(recoveries, { target: { value: '-500' } });
    fireEvent.click(screen.getByRole('button', { name: /save entered figures/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Other recoveries/i));
    });
    expect(mockedSettlementApi.update).not.toHaveBeenCalled();
  });
});
