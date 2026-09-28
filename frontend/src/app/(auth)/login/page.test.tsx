import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LoginPage from './page';

const mockLogin = jest.fn();
const mockCompleteSession = jest.fn();
const mockPush = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => searchParams,
}));

// Mock lucide-react icons
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

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isManager: false,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(false),
    login: mockLogin,
    completeSession: mockCompleteSession,
    logout: jest.fn(),
  }),
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{children}</button>,
  Input: ({ label, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input aria-label={label} {...props} />
    </div>
  ),
  FormError: ({ message }: any) => (message ? <div role="alert">{message}</div> : null),
}));

jest.mock('@/components/auth/SsoButtons', () => ({
  __esModule: true,
  default: ({ org, onProviders }: any) => (
    <div data-testid="sso-buttons" data-org={org ?? ''}>
      <button
        type="button"
        onClick={() => onProviders?.({ providers: ['GOOGLE'], requireSso: true })}
      >
        simulate-require-sso
      </button>
    </div>
  ),
}));

jest.mock('@/components/auth/MfaCodeStep', () => ({
  __esModule: true,
  default: ({ mfaToken, onSuccess, onBack }: any) => (
    <div data-testid="mfa-step" data-mfa-token={mfaToken}>
      <button type="button" onClick={() => onSuccess({ accessToken: 'tok', user: { id: '1' } })}>
        simulate-mfa-success
      </button>
      <button type="button" onClick={onBack}>
        simulate-mfa-spent
      </button>
    </div>
  ),
}));

jest.mock('@/components/auth/TotpEnrolment', () => ({
  __esModule: true,
  default: ({ enrolToken, onEnabled }: any) => (
    <div data-testid="enrol-step" data-enrol-token={enrolToken}>
      <button
        type="button"
        onClick={() =>
          onEnabled({
            recoveryCodes: ['AAAAA-BBBBB'],
            session: { accessToken: 'tok2', user: { id: '1' } },
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

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchParams = new URLSearchParams();
  });

  it('keeps the form available and displays the server error after rejected credentials', async () => {
    mockLogin.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid credentials' } },
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'wrong@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Email address')).toHaveValue('wrong@example.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('renders the welcome heading, subtitle, inputs, and forgot-password link', () => {
    render(<LoginPage />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your HRMS workspace')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('renders demo account information', () => {
    render(<LoginPage />);
    expect(screen.getByText(/Demo accounts/)).toBeInTheDocument();
    expect(screen.getByText('HR Admin')).toBeInTheDocument();
  });

  it('passes ?org= through to SsoButtons and to login()', async () => {
    searchParams = new URLSearchParams('org=acme');
    mockLogin.mockResolvedValue({ status: 'done' });

    render(<LoginPage />);
    expect(screen.getByTestId('sso-buttons')).toHaveAttribute('data-org', 'acme');

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    expect(mockLogin).toHaveBeenCalledWith('a@acme.test', 'pw', 'acme');
  });

  // M3(c): a multi-tenant deployment reached via /login?org=acme must keep
  // that tenant when the visitor follows Forgot password — without it, the
  // reset flow loses track of which tenant they meant.
  it('M3(c): keeps ?org= on the Forgot password link when present', () => {
    searchParams = new URLSearchParams('org=acme');
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password?org=acme',
    );
  });

  it('redirects to /dashboard on a "done" result', async () => {
    mockLogin.mockResolvedValue({ status: 'done' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await screen.findByLabelText('Email address'); // let the microtask flush
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the MfaCodeStep on an "mfa" result, and completes the session on success', async () => {
    mockLogin.mockResolvedValue({ status: 'mfa', mfaToken: 'mfa-tok-1' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    const mfaStep = await screen.findByTestId('mfa-step');
    expect(mfaStep).toHaveAttribute('data-mfa-token', 'mfa-tok-1');

    fireEvent.click(screen.getByText('simulate-mfa-success'));
    expect(mockCompleteSession).toHaveBeenCalledWith({ accessToken: 'tok', user: { id: '1' } });
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('returns to the password step with a message when the mfa challenge is spent', async () => {
    mockLogin.mockResolvedValue({ status: 'mfa', mfaToken: 'mfa-tok-1' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await screen.findByTestId('mfa-step');
    fireEvent.click(screen.getByText('simulate-mfa-spent'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('walks the enrolment flow: TotpEnrolment -> RecoveryCodes -> completes the session', async () => {
    mockLogin.mockResolvedValue({ status: 'enrol', enrolToken: 'enrol-tok-1' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    const enrolStep = await screen.findByTestId('enrol-step');
    expect(enrolStep).toHaveAttribute('data-enrol-token', 'enrol-tok-1');

    fireEvent.click(screen.getByText('simulate-enable'));

    const codesStep = await screen.findByTestId('recovery-codes-step');
    expect(codesStep).toHaveTextContent('AAAAA-BBBBB');

    fireEvent.click(screen.getByText('simulate-continue'));
    expect(mockCompleteSession).toHaveBeenCalledWith({ accessToken: 'tok2', user: { id: '1' } });
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a message for a known sso_error code', () => {
    searchParams = new URLSearchParams('sso_error=no_account');
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no account/i);
  });

  it('shows a generic message for an unknown sso_error code', () => {
    searchParams = new URLSearchParams('sso_error=something_unexpected');
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('collapses the password form behind a link when the tenant requires SSO', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('simulate-require-sso'));

    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    const revealLink = screen.getByText('Sign in with password (administrators)');
    fireEvent.click(revealLink);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });
});
