import React from 'react';
import { render, RenderOptions } from '@testing-library/react';

// Default mock auth context values
export const mockAuthUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'HR_ADMIN' as const,
  tenantId: 'test-tenant',
  employeeId: 'test-employee-id',
};

export const mockAuthContext = {
  user: mockAuthUser,
  token: 'mock-token',
  isLoading: false,
  login: jest.fn(),
  logout: jest.fn(),
  hasRole: jest.fn().mockReturnValue(true),
  isManager: false,
  isAdmin: true,
  isSuperAdmin: false,
};

// Mock the auth context module
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthContext,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Custom render with providers
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { ...options });
}

export * from '@testing-library/react';
