import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { statutoryApi, employeesApi } from '@/lib/api';
import { currentFinancialYear } from '@/components/form16/financialYear';
import PayrollDeclarationsPage from './page';

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

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock UI components (one mock per @/components/ui path the page reaches)
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, variant, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ error, ...props }: any) => (
    <>
      <input {...props} />
      {error ? <p>{error}</p> : null}
    </>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options, placeholder, children, ...props }: any) => (
    <label>
      {label}
      <select {...props}>
        {children ?? (
          <>
            {placeholder ? <option value="">{placeholder}</option> : null}
            {(options ?? []).map((o: any) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </>
        )}
      </select>
    </label>
  ),
}));

// Mock API
jest.mock('@/lib/api', () => ({
  statutoryApi: {
    getDeclarationFor: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn(),
  },
}));

const mockedStatutory = statutoryApi as jest.Mocked<typeof statutoryApi>;
const mockedEmployees = employeesApi as jest.Mocked<typeof employeesApi>;

const thisYear = currentFinancialYear();

const EMPLOYEES = [
  { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' },
  { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Nair' },
];

function declaration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    tenantId: 't1',
    employeeId: 'e1',
    financialYear: thisYear,
    regime: 'OLD',
    section80C: '150000.00',
    section80D: '25000.00',
    section80CCD1B: '50000.00',
    section80CCD2: '36000.00',
    hraExemption: '120000.00',
    homeLoanInterest: '200000.00',
    otherDeductions: '0.00',
    otherIncome: '0.00',
    previousEmployerTds: '18000.00',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

async function renderAndPick(data: unknown) {
  mockedStatutory.getDeclarationFor.mockResolvedValue({ data } as any);
  render(<PayrollDeclarationsPage />);
  await waitFor(() => expect(mockedEmployees.getAll).toHaveBeenCalled());
  await screen.findByLabelText('Employee');
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });
  await waitFor(() => expect(mockedStatutory.getDeclarationFor).toHaveBeenCalled());
}

describe('PayrollDeclarationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEmployees.getAll.mockResolvedValue({ data: { data: EMPLOYEES } } as any);
    mockedStatutory.getDeclarationFor.mockResolvedValue({ data: declaration() } as any);
  });

  it('says plainly that these are declarations and not proofs', async () => {
    await renderAndPick(declaration());

    expect(screen.getByText(/declarations, not proofs/i)).toBeInTheDocument();
    expect(screen.getByText(/no statutory ceiling is enforced/i)).toBeInTheDocument();
  });

  it('offers no way to edit an employee declaration', async () => {
    await renderAndPick(declaration());

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
  });

  it('asks for an employee to be chosen before anything is requested', async () => {
    mockedEmployees.getAll.mockResolvedValue({ data: { data: EMPLOYEES } } as any);
    render(<PayrollDeclarationsPage />);

    await screen.findByLabelText('Employee');
    expect(
      screen.getByRole('heading', { name: /choose an employee to see their declaration/i }),
    ).toBeInTheDocument();
    expect(mockedStatutory.getDeclarationFor).not.toHaveBeenCalled();
  });

  it('reads the declaration for the chosen employee and financial year', async () => {
    await renderAndPick(declaration());

    expect(mockedStatutory.getDeclarationFor).toHaveBeenCalledWith('e1', thisYear);
  });

  it('formats the stored decimal strings as rupees', async () => {
    await renderAndPick(declaration());

    expect(within(screen.getByTestId('field-section80C')).getByText(/1,50,000\.00/))
      .toBeInTheDocument();
    expect(within(screen.getByTestId('field-previousEmployerTds')).getByText(/18,000\.00/))
      .toBeInTheDocument();
  });

  it('explains that TDS falls back to salary alone when the employee has declared nothing', async () => {
    await renderAndPick(null);

    expect(
      screen.getByText(/TDS is computed on their salary alone, with only the standard deduction/i),
    ).toBeInTheDocument();
  });

  it('marks the entries the new regime ignores', async () => {
    await renderAndPick(declaration({ regime: 'NEW' }));

    for (const key of [
      'section80C',
      'section80D',
      'section80CCD1B',
      'hraExemption',
      'homeLoanInterest',
      'otherDeductions',
    ]) {
      expect(
        within(screen.getByTestId(`field-${key}`)).getByText(/ignored under the new regime/i),
      ).toBeInTheDocument();
    }
    expect(
      within(screen.getByTestId('field-section80CCD2')).queryByText(/ignored under the new regime/i),
    ).not.toBeInTheDocument();
  });

  it('does not mark anything as ignored under the old regime', async () => {
    await renderAndPick(declaration({ regime: 'OLD' }));

    expect(screen.queryByText(/ignored under the new regime/i)).not.toBeInTheDocument();
  });

  it('surfaces an error when the declaration cannot be read', async () => {
    mockedStatutory.getDeclarationFor.mockRejectedValueOnce(new Error('nope'));
    render(<PayrollDeclarationsPage />);
    await screen.findByLabelText('Employee');
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as jest.Mock).mock.calls[0][0])).toMatch(/could not be read/i);
  });

  it('surfaces an error when the employee list cannot be loaded', async () => {
    mockedEmployees.getAll.mockRejectedValueOnce(new Error('nope'));
    render(<PayrollDeclarationsPage />);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('flags a financial year that has already ended', async () => {
    await renderAndPick(declaration());

    fireEvent.change(screen.getByLabelText('Financial year'), {
      target: { value: String(thisYear - 1) },
    });

    await waitFor(() =>
      expect(screen.getByText(/has ended/i)).toBeInTheDocument(),
    );
  });
});
