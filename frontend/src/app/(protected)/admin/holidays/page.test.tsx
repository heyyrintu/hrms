import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import HolidaysAdminPage from './page';

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
  holidaysApi: {
    getAll: jest.fn().mockResolvedValue({ data: [] }),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock @/lib/utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock @/types
jest.mock('@/types', () => ({
  HolidayType: { NATIONAL: 'NATIONAL', REGIONAL: 'REGIONAL', COMPANY: 'COMPANY', OPTIONAL: 'OPTIONAL' },
}));

describe('HolidaysAdminPage', () => {
  it('renders the Holiday Calendar heading', async () => {
    render(<HolidaysAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Holiday Calendar')).toBeInTheDocument();
    });
  });

  it('renders the Add Holiday button', async () => {
    render(<HolidaysAdminPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Add Holiday').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders stats cards', async () => {
    render(<HolidaysAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Holidays')).toBeInTheDocument();
      expect(screen.getAllByText('National').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Company').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Optional').length).toBeGreaterThan(0);
    });
  });
});
