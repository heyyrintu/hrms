import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from './page';
import { passwordResetApi } from '@/lib/api-password-reset';

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

const mockForgot = passwordResetApi.forgotPassword as jest.Mock;

const submit = () =>
  fireEvent.submit(
    screen.getByRole('button', { name: 'Send reset link' }).closest('form') as HTMLFormElement,
  );

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    mockForgot.mockReset();
  });

  it('renders the heading and the email field', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText('Forgot your password?')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('links back to the login page', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('posts the email and then shows the confirmation instead of the form', async () => {
    mockForgot.mockResolvedValue({ message: 'If an account exists...' });

    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'jane@acme.test' },
    });
    submit();

    await waitFor(() =>
      expect(mockForgot).toHaveBeenCalledWith({ email: 'jane@acme.test' }),
    );
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });

  it('shows the same confirmation for an address with no account', async () => {
    // The API answers identically either way; the page must not branch on it.
    mockForgot.mockResolvedValue({ message: 'If an account exists...' });

    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'nobody@acme.test' },
    });
    submit();

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('surfaces a rate-limit error and keeps the form usable', async () => {
    mockForgot.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: { message: 'Too many reset requests' } },
    });

    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'jane@acme.test' },
    });
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many reset requests',
    );
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });
});
