import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('AttendancePage', () => {
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
});
