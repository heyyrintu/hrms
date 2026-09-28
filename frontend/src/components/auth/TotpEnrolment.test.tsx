import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TotpEnrolment from './TotpEnrolment';
import { twoFactorApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  twoFactorApi: { setup: jest.fn(), enable: jest.fn() },
}));

describe('TotpEnrolment', () => {
  const onEnabled = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (twoFactorApi.setup as jest.Mock).mockResolvedValue({
      data: {
        otpauthUrl: 'otpauth://totp/Acme%20Corp:jane%40acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Acme%20Corp',
        qrCodeDataUrl: 'data:image/png;base64,xyz',
      },
    });
  });

  it('calls setup(enrolToken) on mount and shows the QR and manual-entry secret', async () => {
    render(<TotpEnrolment enrolToken="enrol-tok" onEnabled={onEnabled} />);

    await waitFor(() => {
      expect(twoFactorApi.setup).toHaveBeenCalledWith('enrol-tok');
    });

    expect(await screen.findByAltText(/qr code/i)).toHaveAttribute('src', 'data:image/png;base64,xyz');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('submits the confirmation code and calls onEnabled with the result', async () => {
    (twoFactorApi.enable as jest.Mock).mockResolvedValue({
      data: { recoveryCodes: ['AAAAA-BBBBB'], session: { accessToken: 'tok', user: {} } },
    });
    const user = userEvent.setup();

    render(<TotpEnrolment enrolToken="enrol-tok" onEnabled={onEnabled} />);

    await user.type(await screen.findByLabelText(/confirmation code/i), '654321');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(twoFactorApi.enable).toHaveBeenCalledWith('654321', 'enrol-tok');
      expect(onEnabled).toHaveBeenCalledWith({
        recoveryCodes: ['AAAAA-BBBBB'],
        session: { accessToken: 'tok', user: {} },
      });
    });
  });

  it('shows an error when the confirmation code is rejected', async () => {
    (twoFactorApi.enable as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid code' } },
    });
    const user = userEvent.setup();

    render(<TotpEnrolment enrolToken="enrol-tok" onEnabled={onEnabled} />);

    await user.type(await screen.findByLabelText(/confirmation code/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid code')).toBeInTheDocument();
    });
    expect(onEnabled).not.toHaveBeenCalled();
  });

  it('works without an enrolToken (voluntary enable from an existing session)', async () => {
    render(<TotpEnrolment onEnabled={onEnabled} />);

    await waitFor(() => {
      expect(twoFactorApi.setup).toHaveBeenCalledWith(undefined);
    });
  });
});
