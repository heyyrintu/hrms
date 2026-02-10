import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ReportsPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

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

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
  reportsApi: {
    generateAttendance: jest.fn(),
    generateLeave: jest.fn(),
    generateEmployees: jest.fn(),
  },
  departmentsApi: {
    getAll: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  ReportFormat: { XLSX: 'xlsx', CSV: 'csv' },
  ReportType: { ATTENDANCE: 'ATTENDANCE', LEAVE: 'LEAVE', EMPLOYEE: 'EMPLOYEE' },
}));

describe('ReportsPage', () => {
  it('renders the Reports & Export heading', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Reports & Export')).toBeInTheDocument();
    });
  });

  it('renders the three report type cards', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Attendance Report')).toBeInTheDocument();
      expect(screen.getByText('Leave Report')).toBeInTheDocument();
      expect(screen.getByText('Employee Report')).toBeInTheDocument();
    });
  });

  it('renders download buttons for each report', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      const downloadButtons = screen.getAllByText('Download');
      expect(downloadButtons.length).toBe(3);
    });
  });
});
