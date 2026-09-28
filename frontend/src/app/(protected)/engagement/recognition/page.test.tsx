import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import RecognitionPage from './page';
import { recognitionApi } from '@/lib/api-recognition';

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

const mockHasRole = jest.fn().mockReturnValue(false);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', employeeId: 'emp-1', tenantId: 't1', role: 'EMPLOYEE' },
    hasRole: (...roles: string[]) => mockHasRole(...roles),
  }),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn().mockResolvedValue({ data: { data: [] } }) },
}));

jest.mock('@/lib/api-recognition', () => ({
  recognitionApi: {
    wall: jest.fn(),
    me: jest.fn(),
    leaderboard: jest.fn(),
    badges: jest.fn(),
    give: jest.fn(),
    remove: jest.fn(),
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

const wallItem = {
  id: 'rec-1',
  message: 'Great work this sprint',
  pointsPerRecipient: 0,
  createdAt: '2026-03-15T12:00:00Z',
  giver: { id: 'g-1', firstName: 'Grace', lastName: 'G' },
  badge: null,
  recipients: [{ id: 'rr-1', employeeId: 'r-1', points: 0, employee: { id: 'r-1', firstName: 'Alice', lastName: 'A' } }],
};

describe('RecognitionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(false);
    (recognitionApi.wall as jest.Mock).mockResolvedValue({
      data: { data: [wallItem], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
    });
    (recognitionApi.me as jest.Mock).mockResolvedValue({
      data: {
        pointsEnabled: false,
        allowance: 100,
        spentThisMonth: 0,
        remainingThisMonth: 100,
        receivedPointsTotal: 0,
        receivedCountTotal: 0,
      },
    });
    (recognitionApi.leaderboard as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('renders the wall', async () => {
    render(<RecognitionPage />);

    await waitFor(() => expect(screen.getByTestId('recognition-card-rec-1')).toBeInTheDocument());
    expect(screen.getByText(/Great work this sprint/)).toBeInTheDocument();
  });

  it('hides the Badges and Settings tabs for an EMPLOYEE', async () => {
    render(<RecognitionPage />);

    await waitFor(() => expect(recognitionApi.wall).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Badges' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows the Badges and Settings tabs for HR_ADMIN', async () => {
    mockHasRole.mockReturnValue(true);

    render(<RecognitionPage />);

    await waitFor(() => expect(recognitionApi.wall).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Badges' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('refetches the leaderboard when the period is switched', async () => {
    render(<RecognitionPage />);
    await waitFor(() => expect(recognitionApi.wall).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    await waitFor(() => expect(recognitionApi.leaderboard).toHaveBeenCalledWith('month'));

    fireEvent.click(screen.getByText('This quarter'));
    await waitFor(() => expect(recognitionApi.leaderboard).toHaveBeenCalledWith('quarter'));
  });

  it('opens the give-recognition modal', async () => {
    render(<RecognitionPage />);
    await waitFor(() => expect(recognitionApi.wall).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Give Recognition'));

    expect(screen.getByRole('dialog', { name: 'Give Recognition' })).toBeInTheDocument();
  });
});
