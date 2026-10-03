import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import AttendancePage from './page';

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

// Mock UI components
jest.mock('@/components/ui', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Table: ({ children, ...props }: any) => <table {...props}>{children}</table>,
  TableHeader: ({ children, ...props }: any) => <thead {...props}>{children}</thead>,
  TableBody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableEmptyState: ({ message, colSpan }: any) => (
    <tr><td colSpan={colSpan}>{message}</td></tr>
  ),
  TableLoadingState: ({ colSpan }: any) => (
    <tr><td colSpan={colSpan}>Loading...</td></tr>
  ),
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  getStatusBadgeVariant: jest.fn().mockReturnValue('gray'),
  Select: ({ label, placeholder, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <select {...props} />
    </div>
  ),
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
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
    getSummary: jest.fn().mockResolvedValue({ data: {} }),
    clockIn: jest.fn(),
    clockOut: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn().mockResolvedValue({ data: { data: [] } }),
  },
  departmentsApi: {
    getAll: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

// Mock date-utils
jest.mock('@/lib/date-utils', () => ({
  formatDate: jest.fn().mockReturnValue('Feb 10, 2026'),
  formatTime: jest.fn().mockReturnValue('09:00'),
  formatMinutesToHoursMinutes: jest.fn().mockReturnValue('0h 0m'),
  formatDateForApi: jest.fn().mockReturnValue('2026-02-10'),
  getMonthYear: jest.fn().mockReturnValue('February 2026'),
  getDaysInMonth: jest.fn().mockReturnValue(28),
}));

jest.mock('@/lib/api-attendance-capture', () => ({
  attendanceCaptureApi: {
    getPolicy: jest.fn(),
    getSelfie: jest.fn(),
    uploadSelfie: jest.fn(),
  },
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

function mockGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: any) => ok({ coords: { latitude: 12.5, longitude: 77.5 } }),
    },
  });
}

describe('AttendancePage', () => {
  beforeEach(() => {
    attendanceCaptureApi.getPolicy.mockResolvedValue(policyStatus());
  });

  it('renders the Attendance heading', () => {
    render(<AttendancePage />);
    expect(screen.getByText('Attendance')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<AttendancePage />);
    expect(screen.getByText('View and track attendance records')).toBeInTheDocument();
  });

  it('renders Attendance Records card title', () => {
    render(<AttendancePage />);
    expect(screen.getByText('Attendance Records')).toBeInTheDocument();
  });

  it('renders view toggle buttons for managers', () => {
    render(<AttendancePage />);
    expect(screen.getByText('My Attendance')).toBeInTheDocument();
    expect(screen.getByText('Team Attendance')).toBeInTheDocument();
  });
  it('flags a late day with the minutes it ran over', async () => {
    const { api } = require('@/lib/api');
    api.get.mockResolvedValueOnce({
      data: [
        {
          id: 'att-1',
          date: '2026-02-10T00:00:00.000Z',
          status: 'PRESENT',
          workedMinutes: 480,
          otMinutesCalculated: 0,
          isLate: true,
          lateByMinutes: 27,
        },
      ],
    });

    render(<AttendancePage />);

    // The date-utils mock maps every calendar cell to the same day, so the
    // record lands on each row; one match is all this assertion needs.
    expect((await screen.findAllByText('Late (+27 min)')).length).toBeGreaterThan(0);
  });

  it('falls back to a bare Late badge when the minutes are missing', async () => {
    const { api } = require('@/lib/api');
    api.get.mockResolvedValueOnce({
      data: [
        {
          id: 'att-1',
          date: '2026-02-10T00:00:00.000Z',
          status: 'PRESENT',
          workedMinutes: 480,
          otMinutesCalculated: 0,
          isLate: true,
          lateByMinutes: null,
        },
      ],
    });

    render(<AttendancePage />);

    expect((await screen.findAllByText('Late')).length).toBeGreaterThan(0);
  });

  describe('punch capture (wave G)', () => {
    beforeEach(() => {
      attendanceApiMock.clockIn.mockReset().mockResolvedValue({ data: {} });
      mockGeolocation();
    });

    /** Renders and waits until the clock button and the policy are both in. */
    async function renderLoaded() {
      render(<AttendancePage />);
      const clockIn = await screen.findByRole('button', { name: /Clock In/ });
      await act(async () => {});
      return clockIn;
    }

    it('opens the selfie dialog instead of clocking in when the policy needs a selfie', async () => {
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

    it('does not clock in when the selfie step is cancelled', async () => {
      attendanceCaptureApi.getPolicy.mockResolvedValue(policyStatus({ selfieRequired: true }));
      const clockIn = await renderLoaded();

      fireEvent.click(clockIn);
      await screen.findByTestId('selfie-dialog');
      fireEvent.click(screen.getByText('mock-cancel'));

      await waitFor(() => expect(screen.queryByTestId('selfie-dialog')).not.toBeInTheDocument());
      expect(attendanceApiMock.clockIn).not.toHaveBeenCalled();
    });

    it('clocks in straight away, with no selfie field, when none is required', async () => {
      const clockIn = await renderLoaded();
      fireEvent.click(clockIn);

      await waitFor(() =>
        expect(attendanceApiMock.clockIn).toHaveBeenCalledWith(12.5, 77.5, undefined),
      );
      expect(screen.queryByTestId('selfie-dialog')).not.toBeInTheDocument();
    });

    it('says "Office network only" when the IP is refused and no request covers the day', async () => {
      attendanceCaptureApi.getPolicy.mockResolvedValue(
        policyStatus({ ipRestrictionEnabled: true, ipAllowed: false }),
      );
      const clockIn = await renderLoaded();

      expect(await screen.findByText(/Office network only/)).toBeInTheDocument();
      // The buttons stay enabled; the server decides.
      expect(clockIn).toBeEnabled();
    });

    it('hides the notice when an approved request covers the day', async () => {
      attendanceCaptureApi.getPolicy.mockResolvedValue(
        policyStatus({
          ipRestrictionEnabled: true,
          ipAllowed: false,
          coveringRequest: { id: 'r1', type: 'WFH' },
        }),
      );
      render(<AttendancePage />);

      await waitFor(() => expect(attendanceCaptureApi.getPolicy).toHaveBeenCalled());
      expect(screen.queryByText(/Office network only/)).not.toBeInTheDocument();
    });

    it('shows the punch IP and a selfie button for sessions that have one', async () => {
      const { api } = require('@/lib/api');
      api.get.mockResolvedValueOnce({
        data: [
          {
            id: 'att-1',
            date: '2026-02-10T00:00:00.000Z',
            status: 'ON_DUTY',
            workedMinutes: 480,
            otMinutesCalculated: 0,
            sessions: [
              { id: 's1', inIp: '10.1.2.3', outIp: null, hasInSelfie: true, hasOutSelfie: false },
            ],
          },
        ],
      });
      render(<AttendancePage />);

      expect((await screen.findAllByText('10.1.2.3')).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText('Clock-in selfie').length).toBeGreaterThan(0);
      expect(screen.queryByLabelText('Clock-out selfie')).not.toBeInTheDocument();
      expect(screen.getAllByText('ON DUTY').length).toBeGreaterThan(0);
    });
  });

  it('shows no late badge on an on-time day', async () => {
    const { api } = require('@/lib/api');
    api.get.mockResolvedValueOnce({
      data: [
        {
          id: 'att-1',
          date: '2026-02-10T00:00:00.000Z',
          status: 'PRESENT',
          workedMinutes: 480,
          otMinutesCalculated: 0,
          isLate: false,
        },
      ],
    });

    render(<AttendancePage />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/^Late/)).not.toBeInTheDocument();
  });
});
