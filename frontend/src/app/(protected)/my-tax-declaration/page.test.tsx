import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { statutoryApi } from '@/lib/api';
import { currentFinancialYear, financialYearLabel } from '@/components/form16/financialYear';
import MyTaxDeclarationPage from './page';

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
    user: { id: '1', email: 'asha@test.com', role: 'EMPLOYEE', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: false,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(false),
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
    getMyDeclaration: jest.fn(),
    saveMyDeclaration: jest.fn(),
  },
}));

const mockedApi = statutoryApi as jest.Mocked<typeof statutoryApi>;

const thisYear = currentFinancialYear();

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
    section80CCD2: '0.00',
    hraExemption: '120000.00',
    ltaExemption: '0.00',
    childrenEducationAllowance: '0.00',
    hostelAllowance: '0.00',
    childrenCount: 0,
    homeLoanInterest: '0.00',
    otherDeductions: '0.00',
    otherIncome: '0.00',
    previousEmployerTds: '0.00',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

/** The row wrapper a field renders into, so assertions stay on one field. */
function fieldRow(key: string) {
  return screen.getByTestId(`field-${key}`);
}

async function renderWithNoDeclaration() {
  mockedApi.getMyDeclaration.mockResolvedValue({ data: null } as any);
  render(<MyTaxDeclarationPage />);
  await waitFor(() => expect(mockedApi.getMyDeclaration).toHaveBeenCalled());
  await screen.findByLabelText('Section 80C');
}

describe('MyTaxDeclarationPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getMyDeclaration.mockResolvedValue({ data: null } as any);
    mockedApi.saveMyDeclaration.mockResolvedValue({ data: declaration() } as any);
  });

  it('explains that TDS falls back to salary alone when nothing is declared yet', async () => {
    await renderWithNoDeclaration();

    expect(
      screen.getByText(
        /TDS is computed on your salary alone, with only the standard deduction/i,
      ),
    ).toBeInTheDocument();
  });

  it('says plainly that these are declarations and not proofs', async () => {
    await renderWithNoDeclaration();

    expect(screen.getByText(/declarations, not proofs/i)).toBeInTheDocument();
    expect(screen.getByText(/no statutory ceiling is enforced/i)).toBeInTheDocument();
  });

  it('marks the entries the new regime ignores, and leaves the rest unmarked', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Tax regime'), { target: { value: 'NEW' } });

    // Chapter VI-A, HRA and home loan interest do nothing under the new regime.
    for (const key of [
      'section80C',
      'section80D',
      'section80CCD1B',
      'hraExemption',
      'ltaExemption',
      'childrenEducationAllowance',
      'hostelAllowance',
      'homeLoanInterest',
      'otherDeductions',
    ]) {
      expect(
        within(fieldRow(key)).getByText(/ignored under the new regime/i),
      ).toBeInTheDocument();
    }

    // The employer's NPS contribution still applies, as does other income.
    expect(
      within(fieldRow('section80CCD2')).queryByText(/ignored under the new regime/i),
    ).not.toBeInTheDocument();
    expect(
      within(fieldRow('otherIncome')).queryByText(/ignored under the new regime/i),
    ).not.toBeInTheDocument();
  });

  it('does not mark anything as ignored under the old regime', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Tax regime'), { target: { value: 'OLD' } });

    expect(screen.queryByText(/ignored under the new regime/i)).not.toBeInTheDocument();
  });

  it('keeps what was typed when the regime changes to one that ignores it', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Section 80C'), { target: { value: '80000' } });
    fireEvent.change(screen.getByLabelText('Tax regime'), { target: { value: 'NEW' } });

    expect(screen.getByLabelText('Section 80C')).toHaveValue('80000');
  });

  it('warns above the section 80C ceiling but still saves the figure as declared', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Section 80C'), { target: { value: '200000' } });

    expect(within(fieldRow('section80C')).getByText(/1,50,000/)).toBeInTheDocument();
    expect(
      within(fieldRow('section80C')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      section80C: 200000,
    });
  });

  it('warns above the section 80CCD(1B) ceiling', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Section 80CCD(1B)'), { target: { value: '60000' } });

    expect(within(fieldRow('section80CCD1B')).getByText(/50,000/)).toBeInTheDocument();
  });

  it('refuses an unreadable figure before any request, naming the field', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Section 80D'), { target: { value: 'twenty five k' } });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(
        within(fieldRow('section80D')).getByText(/Section 80D.*amount in rupees/i),
      ).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a negative figure before any request, naming the field', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Home loan interest'), { target: { value: '-5000' } });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(
        within(fieldRow('homeLoanInterest')).getByText(/Home loan interest cannot be negative/i),
      ).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('surfaces an error when saving fails', async () => {
    await renderWithNoDeclaration();
    mockedApi.saveMyDeclaration.mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as jest.Mock).mock.calls[0][0])).toMatch(/could not be saved/i);
  });

  it('flags a financial year that has already ended', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Financial year'), {
      target: { value: String(thisYear - 1) },
    });

    await waitFor(() =>
      expect(
        screen.getByText(/has ended.*will not change tax already deducted/i),
      ).toBeInTheDocument(),
    );
  });

  it('does not flag the financial year in progress', async () => {
    await renderWithNoDeclaration();

    expect(screen.queryByText(/will not change tax already deducted/i)).not.toBeInTheDocument();
    // The year in progress is named on the page, at least in the year picker.
    expect(screen.getAllByText(new RegExp(financialYearLabel(thisYear))).length).toBeGreaterThan(0);
  });

  it('fills the form from the decimal strings the API returned, untouched', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({ data: declaration() } as any);
    render(<MyTaxDeclarationPage />);

    await waitFor(() =>
      expect(screen.getByLabelText('Section 80C')).toHaveValue('150000.00'),
    );
    expect(screen.getByLabelText('HRA exemption')).toHaveValue('120000.00');
    expect(screen.getByLabelText('Tax regime')).toHaveValue('OLD');
  });

  it('shows what is on record formatted as rupees from the stored string', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({ data: declaration() } as any);
    render(<MyTaxDeclarationPage />);

    await waitFor(() => expect(screen.getByTestId('declaration-on-record')).toBeInTheDocument());
    expect(within(screen.getByTestId('declaration-on-record')).getByText(/1,50,000\.00/))
      .toBeInTheDocument();
  });

  it('surfaces an error when the declaration cannot be loaded', async () => {
    mockedApi.getMyDeclaration.mockRejectedValueOnce(new Error('nope'));
    render(<MyTaxDeclarationPage />);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe('MyTaxDeclarationPage — the section 10 fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getMyDeclaration.mockResolvedValue({ data: null } as any);
    mockedApi.saveMyDeclaration.mockResolvedValue({ data: declaration() } as any);
  });

  it('renders LTA, the children allowances and a count of children', async () => {
    await renderWithNoDeclaration();

    expect(screen.getByLabelText('LTA exemption')).toBeInTheDocument();
    expect(screen.getByLabelText("Children's education allowance")).toBeInTheDocument();
    expect(screen.getByLabelText('Hostel allowance')).toBeInTheDocument();
    expect(screen.getByLabelText('Number of children')).toBeInTheDocument();
  });

  it('warns above the per-child cap for the children\'s education allowance, scaled to the declared count', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '1' } });
    // One child: 100 a month, twelve months, one child — a 1,200 ceiling.
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/1,200/),
    ).toBeInTheDocument();
    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();
  });

  it('caps the hostel allowance ceiling at two children even when more are declared', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '5' } });
    // 300 a month, twelve months, capped at two children — a 7,200 ceiling,
    // not five times that.
    fireEvent.change(screen.getByLabelText('Hostel allowance'), { target: { value: '10000' } });

    expect(within(fieldRow('hostelAllowance')).getByText(/7,200/)).toBeInTheDocument();
    expect(screen.queryByText(/18,000/)).not.toBeInTheDocument();
  });

  it('does not warn when the entry is within the per-child cap', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '2' } });
    // Two children: 100 a month, twelve months, two children — a 2,400 ceiling.
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '2000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();
  });

  it('still saves a children\'s allowance declared above its cap, exactly as entered', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      childrenEducationAllowance: 5000,
      childrenCount: 1,
    });
  });

  it('saves LTA, the children allowances and the children count as numbers', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA exemption'), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Hostel allowance'), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      ltaExemption: 25000,
      hostelAllowance: 3000,
      childrenCount: 2,
    });
  });

  it('refuses a children count that is not a whole number, naming the field, before any request', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Number of children must be a whole number/i),
      ).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a negative children count', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(screen.getByText(/Number of children must be a whole number/i)).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('sends a blank children count as zero, like a blank rupee figure', async () => {
    await renderWithNoDeclaration();

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({ childrenCount: 0 });
  });

  it('fills the count and the new figures from what is on record', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({
        ltaExemption: '18000.00',
        childrenEducationAllowance: '1200.00',
        hostelAllowance: '3600.00',
        childrenCount: 2,
      }),
    } as any);
    render(<MyTaxDeclarationPage />);

    await waitFor(() => expect(screen.getByLabelText('LTA exemption')).toHaveValue('18000.00'));
    expect(screen.getByLabelText('Number of children')).toHaveValue('2');
    expect(screen.getByLabelText("Children's education allowance")).toHaveValue('1200.00');
    expect(screen.getByLabelText('Hostel allowance')).toHaveValue('3600.00');
  });
});
