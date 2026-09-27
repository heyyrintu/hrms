import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';

import PayrollSettingsPage from './page';

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

const mockHasRole = jest.fn().mockReturnValue(true);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', role: 'HR_ADMIN', tenantId: 't1' },
    isLoading: false,
    isAdmin: true,
    hasRole: (...roles: string[]) => mockHasRole(...roles),
  }),
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return { ...actual, payrollDepthApi: { getSettings: jest.fn(), updateSettings: jest.fn() } };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

describe('PayrollSettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
    payrollDepthApi.getSettings.mockResolvedValue({
      data: { reimburseExpensesViaPayroll: false, autoArrears: true },
    });
    payrollDepthApi.updateSettings.mockImplementation(async (payload: object) => ({ data: payload }));
  });

  it('is limited to payroll admins', () => {
    mockHasRole.mockReturnValue(false);
    render(<PayrollSettingsPage />);
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(payrollDepthApi.getSettings).not.toHaveBeenCalled();
    expect(mockHasRole).toHaveBeenCalledWith('SUPER_ADMIN', 'HR_ADMIN');
  });

  it('loads the current settings into the toggles', async () => {
    render(<PayrollSettingsPage />);
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();

    const reimburse = await screen.findByLabelText('Reimburse approved expenses through payroll');
    expect(reimburse).not.toBeChecked();
    expect(screen.getByLabelText('Detect arrears automatically')).toBeChecked();
  });

  it('saves both toggles', async () => {
    render(<PayrollSettingsPage />);
    fireEvent.click(await screen.findByLabelText('Reimburse approved expenses through payroll'));
    fireEvent.click(screen.getByLabelText('Detect arrears automatically'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(payrollDepthApi.updateSettings).toHaveBeenCalledWith({
        reimburseExpensesViaPayroll: true,
        autoArrears: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Payroll settings saved');
  });

  it('shows an error state with retry when loading fails', async () => {
    payrollDepthApi.getSettings.mockRejectedValueOnce(new Error('boom'));
    render(<PayrollSettingsPage />);
    expect(await screen.findByText(/Failed to load payroll settings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Detect arrears automatically')).toBeChecked();
  });

  it('surfaces the backend message when saving fails', async () => {
    payrollDepthApi.updateSettings.mockRejectedValue({ response: { data: { message: 'Forbidden resource' } } });
    render(<PayrollSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Forbidden resource'));
  });
});
