import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SsoProvidersTab from './SsoProvidersTab';
import { securityApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  securityApi: {
    getSettings: jest.fn(),
    upsertSso: jest.fn(),
    deleteSso: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const googleView = {
  provider: 'GOOGLE',
  clientId: 'google-client-id',
  hasClientSecret: true,
  entraTenantId: null,
  enabled: true,
  allowedDomains: ['acme.com'],
  autoCreateUsers: true,
  redirectUri: 'http://localhost:3001/api/auth/sso/google/callback',
  updatedAt: '2026-01-01T00:00:00Z',
};

const noProviders = { requireSso: false, twoFactorRequiredRoles: [], providers: [] };
const withGoogle = { requireSso: false, twoFactorRequiredRoles: [], providers: [googleView] };

Object.assign(navigator, {
  clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
});

describe('SsoProvidersTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a "Not configured" card for both providers when none are set up', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: noProviders });
    render(<SsoProvidersTab />);

    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Microsoft')).toBeInTheDocument();
    const badges = screen.getAllByText('Not configured');
    expect(badges).toHaveLength(2);
  });

  it('shows "Secret saved" and the redirect URI with a copy button for a configured provider', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: withGoogle });
    render(<SsoProvidersTab />);

    expect(await screen.findByText('Secret saved')).toBeInTheDocument();
    expect(
      screen.getByText('http://localhost:3001/api/auth/sso/google/callback'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'http://localhost:3001/api/auth/sso/google/callback',
      ),
    );
  });

  it('leaves the secret input blank on edit and omits clientSecret from the save body when untouched', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: withGoogle });
    (securityApi.upsertSso as jest.Mock).mockResolvedValue({ data: googleView });
    render(<SsoProvidersTab />);

    await screen.findByText('Secret saved');
    const secretInputs = screen.getAllByLabelText('Client secret');
    expect(secretInputs[0]).toHaveValue('');

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(securityApi.upsertSso).toHaveBeenCalledWith(
        'GOOGLE',
        expect.not.objectContaining({ clientSecret: expect.anything() }),
      ),
    );
  });

  it('sends clientSecret only when the admin types a new one', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: withGoogle });
    (securityApi.upsertSso as jest.Mock).mockResolvedValue({ data: googleView });
    render(<SsoProvidersTab />);

    await screen.findByText('Secret saved');
    const secretInputs = screen.getAllByLabelText('Client secret');
    fireEvent.change(secretInputs[0], { target: { value: 'new-secret-value' } });

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(securityApi.upsertSso).toHaveBeenCalledWith(
        'GOOGLE',
        expect.objectContaining({ clientSecret: 'new-secret-value' }),
      ),
    );
  });

  it('sends the trimmed, comma-split allowedDomains and the enabled/autoCreate flags', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: noProviders });
    (securityApi.upsertSso as jest.Mock).mockResolvedValue({ data: googleView });
    render(<SsoProvidersTab />);

    await screen.findByText('Google');
    const clientIdInputs = screen.getAllByLabelText('Client ID');
    fireEvent.change(clientIdInputs[0], { target: { value: 'new-client-id' } });
    const secretInputs = screen.getAllByLabelText('Client secret');
    fireEvent.change(secretInputs[0], { target: { value: 'secret-1' } });
    const domainInputs = screen.getAllByLabelText('Allowed domains');
    fireEvent.change(domainInputs[0], { target: { value: ' acme.com , acme.co.in ,' } });

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(securityApi.upsertSso).toHaveBeenCalledWith(
        'GOOGLE',
        expect.objectContaining({
          clientId: 'new-client-id',
          clientSecret: 'secret-1',
          allowedDomains: ['acme.com', 'acme.co.in'],
        }),
      ),
    );
  });

  it('shows a save error inline when the API rejects', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: noProviders });
    (securityApi.upsertSso as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'clientSecret is required when configuring this provider for the first time' } },
    });
    const axios = require('axios');
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    render(<SsoProvidersTab />);
    await screen.findByText('Google');

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    fireEvent.click(saveButtons[0]);

    expect(
      await screen.findByText('clientSecret is required when configuring this provider for the first time'),
    ).toBeInTheDocument();
  });

  it('confirms before removing a configured provider, then calls deleteSso', async () => {
    (securityApi.getSettings as jest.Mock).mockResolvedValue({ data: withGoogle });
    (securityApi.deleteSso as jest.Mock).mockResolvedValue({ data: { success: true } });
    render(<SsoProvidersTab />);

    await screen.findByText('Secret saved');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await screen.findByRole('heading', { name: /remove google sso\?/i });
    const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    await waitFor(() => expect(securityApi.deleteSso).toHaveBeenCalledWith('GOOGLE'));
    await waitFor(() => expect(screen.queryByText('Secret saved')).not.toBeInTheDocument());
  });
});
