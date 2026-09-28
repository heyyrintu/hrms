import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MfaCodeStep from './MfaCodeStep';
import { twoFactorApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  twoFactorApi: { verify: jest.fn() },
}));

describe('MfaCodeStep', () => {
  const onSuccess = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits the 6-digit code and calls onSuccess with the session', async () => {
    (twoFactorApi.verify as jest.Mock).mockResolvedValue({
      data: { accessToken: 'tok', user: { id: '1' } },
    });
    const user = userEvent.setup();

    render(<MfaCodeStep mfaToken="mfa-tok" onSuccess={onSuccess} onBack={onBack} />);

    await user.type(screen.getByLabelText(/authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(twoFactorApi.verify).toHaveBeenCalledWith('mfa-tok', '123456');
      expect(onSuccess).toHaveBeenCalledWith({ accessToken: 'tok', user: { id: '1' } });
    });
  });

  it('toggles to a recovery-code text input', async () => {
    const user = userEvent.setup();
    render(<MfaCodeStep mfaToken="mfa-tok" onSuccess={onSuccess} onBack={onBack} />);

    await user.click(screen.getByText(/use a recovery code/i));

    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
  });

  it('shows an inline error on a 401', async () => {
    (twoFactorApi.verify as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid code' } },
    });
    const user = userEvent.setup();

    render(<MfaCodeStep mfaToken="mfa-tok" onSuccess={onSuccess} onBack={onBack} />);
    await user.type(screen.getByLabelText(/authentication code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid code')).toBeInTheDocument();
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('returns to the password step after 5 failed attempts', async () => {
    (twoFactorApi.verify as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid code' } },
    });
    const user = userEvent.setup();

    render(<MfaCodeStep mfaToken="mfa-tok" onSuccess={onSuccess} onBack={onBack} />);

    const input = screen.getByLabelText(/authentication code/i);
    const button = screen.getByRole('button', { name: /verify/i });

    for (let i = 0; i < 5; i++) {
      await user.clear(input);
      await user.type(input, '000000');
      await act(async () => {
        await user.click(button);
      });
    }

    await waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
