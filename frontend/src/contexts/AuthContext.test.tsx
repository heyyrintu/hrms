import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '@/lib/api';

// Mock the API module
jest.mock('@/lib/api', () => ({
  api: {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
  authApi: {
    login: jest.fn(),
    getProfile: jest.fn(),
  },
}));

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

function TestComponent() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="is-manager">{String(auth.isManager)}</span>
      <span data-testid="is-admin">{String(auth.isAdmin)}</span>
      <span data-testid="is-super-admin">{String(auth.isSuperAdmin)}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <button onClick={() => auth.login({ email: 'test@test.com', password: 'pass' })}>Login</button>
      <button onClick={auth.logout}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    (authApi.getProfile as jest.Mock).mockRejectedValue(new Error('No token'));
  });

  it('provides initial unauthenticated state', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-email').textContent).toBe('none');
  });

  it('login stores token and user', async () => {
    const mockUser = { id: '1', email: 'test@test.com', role: 'HR_ADMIN', tenantId: 't1' };
    (authApi.login as jest.Mock).mockResolvedValue({
      data: { accessToken: 'token123', user: mockUser },
    });
    (authApi.getProfile as jest.Mock).mockRejectedValue(new Error('No token'));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      screen.getByText('Login').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      expect(screen.getByTestId('user-email').textContent).toBe('test@test.com');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('hrms_token', 'token123');
  });

  it('logout clears state and localStorage', async () => {
    const mockUser = { id: '1', email: 'test@test.com', role: 'HR_ADMIN', tenantId: 't1' };
    (authApi.login as jest.Mock).mockResolvedValue({
      data: { accessToken: 'token123', user: mockUser },
    });
    (authApi.getProfile as jest.Mock).mockRejectedValue(new Error('No token'));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      screen.getByText('Login').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    });

    act(() => {
      screen.getByText('Logout').click();
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hrms_token');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hrms_user');
  });

  it('restores auth state from localStorage', async () => {
    const mockUser = { id: '1', email: 'stored@test.com', role: 'MANAGER', tenantId: 't1' };
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'hrms_token') return 'stored-token';
      if (key === 'hrms_user') return JSON.stringify(mockUser);
      return null;
    });
    (authApi.getProfile as jest.Mock).mockResolvedValue({ data: mockUser });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-email').textContent).toBe('stored@test.com');
  });

  it('throws error when useAuth is used outside provider', () => {
    // Suppress expected error
    const spy = jest.spyOn(console, 'error').mockImplementation();
    expect(() => render(<TestComponent />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });
});
