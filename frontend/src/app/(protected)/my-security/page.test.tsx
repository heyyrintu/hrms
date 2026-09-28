import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MySecurityPage from './page';
import { twoFactorApi } from '@/lib/api-security';

const mockCompleteSession = jest.fn();

jest.mock('@/lib/api-security', () => ({
  twoFactorApi: {
    status: jest.fn(),
    disable: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
  },
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ completeSession: mockCompleteSession }),
}));

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

jest.mock('@/components/auth/TotpEnrolment', () => ({
  __esModule: true,
  default: ({ enrolToken, onEnabled }: any) => (
    <div data-testid="enrol-step" data-enrol-token={enrolToken ?? ''}>
      <button
        type="button"
        onClick={() =>
          onEnabled({
            recoveryCodes: ['AAAAA-BBBBB'],
            session: { accessToken: 'new-tok', user: { id: '1' } },
          })
        }
      >
        simulate-enable
      </button>
    </div>
  ),
}));

jest.mock('@/components/auth/RecoveryCodes', () => ({
  __esModule: true,
  default: ({ codes, onContinue }: any) => (
    <div data-testid="recovery-codes-step">
      {codes.join(',')}
      <button type="button" onClick={onContinue}>
        simulate-continue
      </button>
    </div>
  ),
}));

const statusDisabled = {
  enabled: false,
  enabledAt: null,
  required: false,
  recoveryCodesRemaining: 0,
};

const statusEnabled = {
  enabled: true,
  enabledAt: '2026-09-01T00:00:00Z',
  required: false,
  recoveryCodesRemaining: 8,
};

describe('MySecurityPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows disabled status and an Enable button', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({ data: statusDisabled });
    render(<MySecurityPage />);

    expect(await screen.findByText(/not enabled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
  });

  // I4: enabling 2FA bumps tokenVersion server-side, so the session's old
  // access token is stale the instant enable() succeeds — not when the user
  // later clicks through the recovery codes. completeSession must run
  // before that screen even renders, or the user can be logged out before
  // they've saved their codes.
  it('completes the session as soon as enable succeeds, before the recovery codes screen is even shown', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({ data: statusDisabled });
    render(<MySecurityPage />);

    fireEvent.click(await screen.findByRole('button', { name: /enable/i }));
    expect(await screen.findByTestId('enrol-step')).toBeInTheDocument();

    fireEvent.click(screen.getByText('simulate-enable'));

    // The recovery codes screen is showing now...
    const codesStep = await screen.findByTestId('recovery-codes-step');
    expect(codesStep).toHaveTextContent('AAAAA-BBBBB');

    // ...but completeSession already ran, before the "I have saved these"
    // click below — the session must never depend on that click.
    expect(mockCompleteSession).toHaveBeenCalledWith({ accessToken: 'new-tok', user: { id: '1' } });
    expect(mockCompleteSession).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('simulate-continue'));
    await waitFor(() => {
      expect(screen.queryByTestId('recovery-codes-step')).not.toBeInTheDocument();
    });
    // Not completed a second time on continue.
    expect(mockCompleteSession).toHaveBeenCalledTimes(1);
  });

  it('shows enabled status with Disable and Regenerate actions', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({ data: statusEnabled });
    render(<MySecurityPage />);

    expect(await screen.findByText(/enabled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByText(/8/)).toBeInTheDocument();
  });

  it('hides the Disable action when 2FA is required for the role', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({
      data: { ...statusEnabled, required: true },
    });
    render(<MySecurityPage />);

    await screen.findByText(/enabled/i);
    expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument();
  });

  it('disables 2FA via the password + code dialog and completes the session', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({ data: statusEnabled });
    (twoFactorApi.disable as jest.Mock).mockResolvedValue({
      data: { accessToken: 'disabled-tok', user: { id: '1' } },
    });
    render(<MySecurityPage />);

    fireEvent.click(await screen.findByRole('button', { name: /disable/i }));
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw123' } });
    fireEvent.change(screen.getByLabelText(/^code$|authentication code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(twoFactorApi.disable).toHaveBeenCalledWith('pw123', '123456');
      expect(mockCompleteSession).toHaveBeenCalledWith({
        accessToken: 'disabled-tok',
        user: { id: '1' },
      });
    });
  });

  it('regenerates recovery codes via the code dialog and shows the new codes', async () => {
    (twoFactorApi.status as jest.Mock).mockResolvedValue({ data: statusEnabled });
    (twoFactorApi.regenerateRecoveryCodes as jest.Mock).mockResolvedValue({
      data: { recoveryCodes: ['ZZZZZ-YYYYY'] },
    });
    render(<MySecurityPage />);

    fireEvent.click(await screen.findByRole('button', { name: /regenerate/i }));
    fireEvent.change(screen.getByLabelText(/authentication code/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(twoFactorApi.regenerateRecoveryCodes).toHaveBeenCalledWith('654321');
    });
    const codesStep = await screen.findByTestId('recovery-codes-step');
    expect(codesStep).toHaveTextContent('ZZZZZ-YYYYY');
  });
});
