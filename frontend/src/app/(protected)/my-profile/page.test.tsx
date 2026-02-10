import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import MyProfilePage from './page';

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
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1', employeeId: 'emp1' },
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
  selfServiceApi: {
    getProfile: jest.fn().mockResolvedValue({
      data: {
        id: 'emp1',
        employeeCode: 'EMP001',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
        phone: '1234567890',
        employmentType: 'PERMANENT',
        payType: 'MONTHLY',
        designation: 'Developer',
        joinDate: '2024-01-01',
        status: 'ACTIVE',
        department: { name: 'Engineering', code: 'ENG' },
        manager: { firstName: 'Jane', lastName: 'Smith', employeeCode: 'EMP000' },
        shiftAssignments: [],
      },
    }),
    getMyChangeRequests: jest.fn().mockResolvedValue({ data: [] }),
    createChangeRequest: jest.fn(),
  },
  documentsApi: {
    getByEmployee: jest.fn().mockResolvedValue({ data: [] }),
    upload: jest.fn(),
    download: jest.fn(),
  },
}));

// Mock @/lib/utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock @/types
jest.mock('@/types', () => ({
  DocumentCategory: { OTHER: 'OTHER', IDENTITY: 'IDENTITY', EDUCATION: 'EDUCATION' },
  ChangeRequestStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
}));

describe('MyProfilePage', () => {
  it('renders the My Profile heading after loading', async () => {
    render(<MyProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('My Profile')).toBeInTheDocument();
    });
  });

  it('renders profile tab labels', async () => {
    render(<MyProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Change Requests')).toBeInTheDocument();
    });
  });

  it('renders Personal Information section', async () => {
    render(<MyProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Personal Information')).toBeInTheDocument();
    });
  });
});
