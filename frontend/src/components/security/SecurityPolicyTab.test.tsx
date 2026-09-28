import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SecurityPolicyTab from './SecurityPolicyTab';
import { securityApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  securityApi: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const settingsNoProvider = {
  requireSso: false,
  twoFactorRequiredRoles: ['MANAGER'],
  providers: [],
};

const settingsWithEnabledProvider = {
  requireSso: false,
  twoFactorRequiredRoles: [],
  providers: [{ provider: 'GOOGLE', enabled: true }],
};

describe('SecurityPolicyTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the four role checkboxes, pre-checked from the loaded settings', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: settingsNoProvider });
    render(<SecurityPolicyTab />);

    expect(await screen.findByLabelText('Manager')).toBeChecked();
    expect(screen.getByLabelText('Employee')).not.toBeChecked();
    expect(screen.getByLabelText('HR Admin')).not.toBeChecked();
    expect(screen.getByLabelText('Super Admin')).not.toBeChecked();
  });

  it('disables the Require SSO toggle with a hint when no provider is enabled', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: settingsNoProvider });
    render(<SecurityPolicyTab />);

    const toggle = await screen.findByLabelText(/require sso/i);
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/enable at least one sso provider/i)).toBeInTheDocument();
  });

  it('enables the toggle when a provider is enabled, and confirms before turning it on', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: settingsWithEnabledProvider });
    (securityApi.updateSettings as jest.Mock).mockResolvedValue({
      data: { ...settingsWithEnabledProvider, requireSso: true },
    });
    render(<SecurityPolicyTab />);

    const toggle = await screen.findByLabelText(/require sso/i);
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);
    expect(screen.getByRole('heading', { name: /require single sign-on\?/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(securityApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ requireSso: true }),
      );
    });
  });

  it('saves the selected role checkboxes', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: settingsNoProvider });
    (securityApi.updateSettings as jest.Mock).mockResolvedValue({
      data: { ...settingsNoProvider, twoFactorRequiredRoles: ['MANAGER', 'EMPLOYEE'] },
    });
    render(<SecurityPolicyTab />);

    fireEvent.click(await screen.findByLabelText('Employee'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(securityApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          twoFactorRequiredRoles: expect.arrayContaining(['MANAGER', 'EMPLOYEE']),
        }),
      );
    });
  });
});
