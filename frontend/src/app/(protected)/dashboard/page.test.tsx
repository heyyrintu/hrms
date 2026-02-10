import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';

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
    user: {
      id: '1',
      email: 'admin@test.com',
      role: 'HR_ADMIN',
      tenantId: 't1',
      employee: { firstName: 'Admin' },
    },
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

// Mock UI components
jest.mock('@/components/ui', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  getStatusBadgeVariant: jest.fn().mockReturnValue('gray'),
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
  attendanceApi: {
    getTodayStatus: jest.fn().mockResolvedValue({
      data: {
        clockedIn: false,
        canClockIn: true,
        canClockOut: false,
        clockInTime: null,
        clockOutTime: null,
      },
    }),
    getMyAttendance: jest.fn().mockResolvedValue({ data: [] }),
    getSummary: jest.fn().mockResolvedValue({
      data: {
        presentDays: 0,
        absentDays: 0,
        leaveDays: 0,
        wfhDays: 0,
        totalWorkedMinutes: 0,
        totalOtMinutes: 0,
        totalApprovedOtMinutes: 0,
      },
    }),
    clockIn: jest.fn(),
    clockOut: jest.fn(),
  },
  adminApi: {
    getDashboard: jest.fn().mockResolvedValue({
      data: {
        totalEmployees: 10,
        activeEmployees: 8,
        presentToday: 6,
        onLeaveToday: 1,
        pendingLeaveRequests: 2,
        pendingOtApprovals: 1,
      },
    }),
  },
}));

// Mock date-utils
jest.mock('@/lib/date-utils', () => ({
  formatMinutesToHoursMinutes: jest.fn().mockReturnValue('0h 0m'),
  formatTime: jest.fn().mockReturnValue('09:00'),
  formatDateForApi: jest.fn().mockReturnValue('2026-02-10'),
  getStartOfMonth: jest.fn().mockReturnValue(new Date(2026, 1, 1)),
}));

describe('DashboardPage', () => {
  it('renders dashboard with greeting and stats after loading', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Good (morning|afternoon|evening), Admin!/)).toBeInTheDocument();
    });
  });

  it('renders Today\'s Attendance card after loading', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Today's Attendance")).toBeInTheDocument();
    });
  });

  it('renders This Month section after loading', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('This Month')).toBeInTheDocument();
    });
  });
});
