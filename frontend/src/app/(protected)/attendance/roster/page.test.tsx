import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import MyShiftsPage from './page';
import { toLocalIso, todayLocalIso } from '@/lib/date';

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

let mockUser: any = { role: 'EMPLOYEE', employee: { id: 'emp-1' } };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: true,
    isLoading: false,
    hasRole: (...roles: string[]) => roles.includes(mockUser.role),
  }),
}));

jest.mock('@/lib/api-roster', () => ({
  rosterApi: { getMine: jest.fn(), getGrid: jest.fn() },
}));
jest.mock('@/lib/api', () => ({ api: {}, shiftsApi: { getAll: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rosterApi } = require('@/lib/api-roster');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shiftsApi } = require('@/lib/api');

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toLocalIso(new Date(y, m - 1, d + n));
}

const mine = (n = 14) =>
  Array.from({ length: n }, (_, i) => ({
    date: plusDays(todayLocalIso(), i),
    shiftId: i === 1 ? null : 's1',
    shiftCode: i === 1 ? null : 'GEN',
    shiftName: i === 1 ? null : 'General',
    isOvernight: false,
    isOff: i === 1,
    source: i === 1 ? 'ROSTER' : 'ASSIGNMENT',
  }));

const teamGrid = {
  days: [todayLocalIso()],
  rows: [
    {
      employee: { id: 'r1', name: 'Report One', code: 'EMP010', department: 'Ops' },
      cells: [
        {
          date: todayLocalIso(),
          shiftId: 's1',
          shiftCode: 'GEN',
          shiftName: 'General',
          isOvernight: false,
          isOff: false,
          source: 'ROSTER',
        },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { role: 'EMPLOYEE', employee: { id: 'emp-1' } };
  rosterApi.getMine.mockResolvedValue({ data: mine() });
  rosterApi.getGrid.mockResolvedValue({ data: teamGrid });
  shiftsApi.getAll.mockResolvedValue({ data: [] });
});

describe('MyShiftsPage', () => {
  it('shows my next 14 days', async () => {
    render(<MyShiftsPage />);

    await waitFor(() => expect(rosterApi.getMine).toHaveBeenCalledTimes(1));
    expect(rosterApi.getMine).toHaveBeenCalledWith({
      from: todayLocalIso(),
      to: plusDays(todayLocalIso(), 13),
    });
    expect(await screen.findAllByText('GEN')).toHaveLength(13);
    expect(screen.getByText('Day off')).toBeInTheDocument();
  });

  it('does not show the team grid to an employee', async () => {
    render(<MyShiftsPage />);
    await screen.findAllByText('GEN');

    expect(rosterApi.getGrid).not.toHaveBeenCalled();
    expect(screen.queryByText('Team roster')).not.toBeInTheDocument();
  });

  it('shows a manager a read-only team grid as well', async () => {
    mockUser = { role: 'MANAGER', employee: { id: 'mgr-1' } };
    render(<MyShiftsPage />);

    expect(await screen.findByText('Team roster')).toBeInTheDocument();
    await waitFor(() => expect(rosterApi.getGrid).toHaveBeenCalledTimes(1));
    expect(rosterApi.getGrid).toHaveBeenCalledWith({
      from: todayLocalIso(),
      to: plusDays(todayLocalIso(), 13),
    });
    expect(await screen.findByText('Report One')).toBeInTheDocument();
    // Read-only: no picker on click.
    expect(screen.getByTestId(`cell-r1-${todayLocalIso()}`).tagName).toBe('DIV');
  });

  it('shows an error state when my shifts fail to load', async () => {
    rosterApi.getMine.mockRejectedValue(new Error('boom'));
    render(<MyShiftsPage />);

    expect(await screen.findByText('Failed to load your shifts.')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is scheduled', async () => {
    rosterApi.getMine.mockResolvedValue({
      data: mine().map((c) => ({
        ...c,
        shiftId: null,
        shiftCode: null,
        shiftName: null,
        isOff: false,
        source: 'NONE',
      })),
    });
    render(<MyShiftsPage />);

    expect(await screen.findByText('No shifts scheduled for the next 14 days.')).toBeInTheDocument();
  });

  it('explains when the user has no employee record', async () => {
    mockUser = { role: 'SUPER_ADMIN' };
    render(<MyShiftsPage />);

    expect(await screen.findByText('No employee record is linked to your account.')).toBeInTheDocument();
    expect(rosterApi.getMine).not.toHaveBeenCalled();
  });
});
