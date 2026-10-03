import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

// Mock the polls API so PollWidget renders nothing (no active polls) and does
// not make a real network call.
jest.mock('@/lib/api-polls', () => ({
  pollsApi: {
    active: jest.fn().mockResolvedValue({ data: [] }),
    recentClosed: jest.fn().mockResolvedValue({ data: [] }),
    vote: jest.fn(),
  },
}));

// Mock date-utils
jest.mock('@/lib/date-utils', () => ({
  formatMinutesToHoursMinutes: jest.fn().mockReturnValue('0h 0m'),
  formatTime: jest.fn().mockReturnValue('09:00'),
  formatDateForApi: jest.fn().mockReturnValue('2026-02-10'),
  getStartOfMonth: jest.fn().mockReturnValue(new Date(2026, 1, 1)),
}));

jest.mock('@/lib/api-attendance-capture', () => ({
  attendanceCaptureApi: { getPolicy: jest.fn(), getSelfie: jest.fn(), uploadSelfie: jest.fn() },
}));

// The real dialog needs a camera; a stub is enough to drive the punch flow.
jest.mock('@/components/attendance/SelfieCapture', () => ({
  SelfieCapture: ({ open, onCaptured, onCancel }: any) =>
    open ? (
      <div data-testid="selfie-dialog">
        <button onClick={() => onCaptured('up-1')}>mock-capture</button>
        <button onClick={onCancel}>mock-cancel</button>
      </div>
    ) : null,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendanceCaptureApi } = require('@/lib/api-attendance-capture');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendanceApi: attendanceApiMock } = require('@/lib/api');

const policyStatus = (over: Record<string, unknown> = {}) => ({
  data: {
    ipRestrictionEnabled: false,
    ipAllowed: true,
    selfieRequired: false,
    coveringRequest: null,
    clientIp: '10.1.2.3',
    ...over,
  },
});

describe('DashboardPage', () => {
  beforeEach(() => {
    attendanceCaptureApi.getPolicy.mockResolvedValue(policyStatus());
    attendanceApiMock.clockIn.mockReset().mockResolvedValue({ data: {} });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: any) => ok({ coords: { latitude: 12.5, longitude: 77.5 } }),
      },
    });
  });

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

  describe('punch capture (wave G)', () => {
    async function renderLoaded() {
      render(<DashboardPage />);
      const clockIn = await screen.findByRole('button', { name: /Clock In/ });
      await act(async () => {});
      return clockIn;
    }

    it('opens the selfie dialog before clocking in when the policy needs a selfie', async () => {
      attendanceCaptureApi.getPolicy.mockResolvedValue(policyStatus({ selfieRequired: true }));
      const clockIn = await renderLoaded();

      fireEvent.click(clockIn);
      expect(await screen.findByTestId('selfie-dialog')).toBeInTheDocument();
      expect(attendanceApiMock.clockIn).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('mock-capture'));
      await waitFor(() =>
        expect(attendanceApiMock.clockIn).toHaveBeenCalledWith(12.5, 77.5, {
          selfieUploadId: 'up-1',
        }),
      );
    });

    it('clocks in directly when no selfie is required', async () => {
      const clockIn = await renderLoaded();
      fireEvent.click(clockIn);
      await waitFor(() =>
        expect(attendanceApiMock.clockIn).toHaveBeenCalledWith(12.5, 77.5, undefined),
      );
    });

    it('says "Office network only" when the IP is refused and nothing covers the day', async () => {
      attendanceCaptureApi.getPolicy.mockResolvedValue(
        policyStatus({ ipRestrictionEnabled: true, ipAllowed: false }),
      );
      await renderLoaded();
      expect(await screen.findByText(/Office network only/)).toBeInTheDocument();
    });
  });

  it('renders This Month section after loading', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('This Month')).toBeInTheDocument();
    });
  });
});
