import React from 'react';
import { render, waitFor } from '@testing-library/react';
import SsoCallbackPage from './page';
import { ssoApi } from '@/lib/api-security';
import { useAuth } from '@/contexts/AuthContext';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/lib/api-security', () => ({
  ssoApi: {
    exchange: jest.fn(),
  },
}));

const mockCompleteSession = jest.fn();
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

function setHash(hash: string) {
  window.history.pushState(null, '', `/sso/callback${hash}`);
}

describe('SsoCallbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({ completeSession: mockCompleteSession });
    window.history.pushState(null, '', '/sso/callback');
  });

  it('reads the code from the fragment, clears it, exchanges it, and completes the session', async () => {
    setHash('#code=abc123');
    (ssoApi.exchange as jest.Mock).mockResolvedValue({
      data: { accessToken: 'jwt-1', user: { id: 'user-1' } },
    });

    render(<SsoCallbackPage />);

    await waitFor(() => expect(ssoApi.exchange).toHaveBeenCalledWith('abc123'));
    expect(window.location.hash).toBe('');
    await waitFor(() =>
      expect(mockCompleteSession).toHaveBeenCalledWith({ accessToken: 'jwt-1', user: { id: 'user-1' } }),
    );
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('clears the fragment before the exchange resolves (no resubmission on reload)', async () => {
    setHash('#code=abc123');
    (ssoApi.exchange as jest.Mock).mockResolvedValue({ data: { accessToken: 'jwt-1', user: {} } });

    render(<SsoCallbackPage />);

    // Assert synchronously, before the exchange promise has resolved.
    expect(window.location.hash).toBe('');
  });

  it('redirects to the login error page when there is no code in the fragment', async () => {
    render(<SsoCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?sso_error=idp_error'));
    expect(ssoApi.exchange).not.toHaveBeenCalled();
  });

  it('redirects to the login error page when the exchange fails (e.g. a reused/expired code)', async () => {
    setHash('#code=already-used');
    (ssoApi.exchange as jest.Mock).mockRejectedValue(new Error('401'));

    render(<SsoCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?sso_error=idp_error'));
    expect(mockCompleteSession).not.toHaveBeenCalled();
  });

  it('a second visit with no hash (e.g. back navigation after the code was used) errors once, no loop', async () => {
    // No hash this time — simulates reloading /sso/callback after the fragment was already cleared.
    render(<SsoCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/login?sso_error=idp_error');
  });
});
