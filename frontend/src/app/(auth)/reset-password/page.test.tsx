import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import ResetPasswordPage from './page';
import { passwordResetApi } from '@/lib/api-password-reset';

const mockPush = jest.fn();
let searchParams = new URLSearchParams('token=abc123');

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => searchParams,
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api-password-reset', () => ({
  passwordResetApi: {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Input: ({ label, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input aria-label={label} {...props} />
    </div>
  ),
  FormError: ({ message }: any) => (message ? <div role="alert">{message}</div> : null),
}));

const mockReset = passwordResetApi.resetPassword as jest.Mock;

const fill = (newPassword: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: newPassword },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirm },
  });
};

const submit = () =>
  fireEvent.submit(
    screen.getByRole('button', { name: 'Reset password' }).closest('form') as HTMLFormElement,
  );

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockReset.mockReset();
    mockPush.mockReset();
    (toast.success as jest.Mock).mockReset();
    searchParams = new URLSearchParams('token=abc123');
  });

  it('renders the form when a token is present', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText('Choose a new password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('shows a recovery prompt instead of the form when the link carries no token', () => {
    searchParams = new URLSearchParams('');
    render(<ResetPasswordPage />);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /request a new link/i }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it('rejects a password shorter than 8 characters without calling the API', async () => {
    render(<ResetPasswordPage />);
    fill('short', 'short');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'at least 8 characters',
    );
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation without calling the API', async () => {
    render(<ResetPasswordPage />);
    fill('newpassword1', 'newpassword2');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('submits the token with the new password, toasts and redirects to login', async () => {
    mockReset.mockResolvedValue({ message: 'Password reset.' });

    render(<ResetPasswordPage />);
    fill('newpassword1', 'newpassword1');
    submit();

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith({
        token: 'abc123',
        newPassword: 'newpassword1',
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows the server error for an expired link and does not redirect', async () => {
    mockReset.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: 'This password reset link is invalid or has expired.' },
      },
    });

    render(<ResetPasswordPage />);
    fill('newpassword1', 'newpassword1');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'invalid or has expired',
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
