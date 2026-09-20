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
    previousEmployerEncashmentExemption: '0.00',
    ltaJourneysUsedInBlock: 0,
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
      'previousEmployerEncashmentExemption',
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

  it("warns using the employer's configured section 80C ceiling, not the statutory default, and still saves the figure as declared", async () => {
    // Configured well above the ₹1,50,000 statutory default, so a figure
    // between the two proves which one actually drove the warning.
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({ limits: { section80CLimit: '200000.00' } }),
    } as any);
    render(<MyTaxDeclarationPage />);
    await screen.findByLabelText('Section 80C');

    // Above the old default but below the configured limit: no warning.
    fireEvent.change(screen.getByLabelText('Section 80C'), { target: { value: '180000' } });
    expect(
      within(fieldRow('section80C')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();

    // Above the configured limit: warns, and names that figure, not the default.
    fireEvent.change(screen.getByLabelText('Section 80C'), { target: { value: '250000' } });
    expect(within(fieldRow('section80C')).getByText(/2,00,000/)).toBeInTheDocument();
    expect(within(fieldRow('section80C')).queryByText(/1,50,000/)).not.toBeInTheDocument();
    expect(
      within(fieldRow('section80C')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      section80C: 250000,
    });
  });

  it('warns about the section 80C ceiling without naming a figure when the employer has not configured one, and still saves the entry', async () => {
    // `renderWithNoDeclaration` means no declaration and so no `limits` at
    // all — exactly the "server has not supplied a limit" case.
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Section 80C'), { target: { value: '200000' } });

    expect(
      within(fieldRow('section80C')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();
    // The statutory default must not appear as though it were confirmed.
    expect(within(fieldRow('section80C')).queryByText(/1,50,000/)).not.toBeInTheDocument();
    expect(
      within(fieldRow('section80C')).getByText(/could not be confirmed/i),
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

  it("scales the children's education allowance ceiling to the configured monthly limit and the declared children, not the statutory default", async () => {
    // Configured at 200 a month, not the 100 default, so the figure shown
    // proves which one is actually driving the ceiling.
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({ limits: { childrenEducationMonthlyLimit: '200.00' } }),
    } as any);
    render(<MyTaxDeclarationPage />);
    await screen.findByLabelText('Number of children');

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '1' } });
    // One child: 200 a month, twelve months, one child — a 2,400 ceiling.
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/2,400/),
    ).toBeInTheDocument();
    // Not the figure the statutory default (100/month) would have produced.
    expect(
      within(fieldRow('childrenEducationAllowance')).queryByText(/1,200/),
    ).not.toBeInTheDocument();
    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();
  });

  it("falls back to the statutory default for the children's allowance without naming a figure when no limit is configured", async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();
    // The 100/month default's resulting figure (1,200) must not be shown as
    // though the employer had confirmed it.
    expect(
      within(fieldRow('childrenEducationAllowance')).queryByText(/1,200/),
    ).not.toBeInTheDocument();
    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/could not be confirmed/i),
    ).toBeInTheDocument();
  });

  it('caps the hostel allowance ceiling at two children even when more are declared, using the configured monthly limit', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({ limits: { hostelAllowanceMonthlyLimit: '300.00' } }),
    } as any);
    render(<MyTaxDeclarationPage />);
    await screen.findByLabelText('Number of children');

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '5' } });
    // 300 a month, twelve months, capped at two children — a 7,200 ceiling,
    // not five times that.
    fireEvent.change(screen.getByLabelText('Hostel allowance'), { target: { value: '10000' } });

    expect(within(fieldRow('hostelAllowance')).getByText(/7,200/)).toBeInTheDocument();
    expect(screen.queryByText(/18,000/)).not.toBeInTheDocument();
  });

  it('uses the employer-configured maximum child count, not a hard-coded two, to drive the ceiling', async () => {
    // Configured for three children, so a fourth-declared but a third-counted
    // figure proves the configured maximum is what actually drove it, not
    // the old hard-coded two.
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({
        limits: { childrenEducationMonthlyLimit: '100.00', childrenAllowanceMaxChildren: 3 },
      }),
    } as any);
    render(<MyTaxDeclarationPage />);
    await screen.findByLabelText('Number of children');

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '3' } });
    // 100 a month, twelve months, three children (the configured maximum) — a
    // 3,600 ceiling, not the 2,400 that a hard-coded two would have produced.
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/3,600/),
    ).toBeInTheDocument();
    expect(
      within(fieldRow('childrenEducationAllowance')).queryByText(/2,400/),
    ).not.toBeInTheDocument();
  });

  it('falls back to a maximum of two children, the same fallback convention as the monthly limit, when no maximum is configured', async () => {
    // Only the monthly limit is configured; the maximum child count is not,
    // so the fallback of two applies — the same "configured or fallback"
    // convention `resolveFlatCeiling` already uses for section 80C.
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({ limits: { childrenEducationMonthlyLimit: '100.00' } }),
    } as any);
    render(<MyTaxDeclarationPage />);
    await screen.findByLabelText('Number of children');

    fireEvent.change(screen.getByLabelText('Number of children'), { target: { value: '5' } });
    // 100 a month, twelve months, capped at the fallback of two children — a
    // 2,400 ceiling, not five times that.
    fireEvent.change(screen.getByLabelText("Children's education allowance"), {
      target: { value: '5000' },
    });

    expect(
      within(fieldRow('childrenEducationAllowance')).getByText(/2,400/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/6,000/)).not.toBeInTheDocument();
    // The monthly limit was itself configured, so the ceiling is still shown
    // as the employer's own confirmed figure, exactly as it already was
    // before the maximum child count was itself configurable.
    expect(
      within(fieldRow('childrenEducationAllowance')).queryByText(/could not be confirmed/i),
    ).not.toBeInTheDocument();
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

describe('MyTaxDeclarationPage — the two new declaration fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getMyDeclaration.mockResolvedValue({ data: null } as any);
    mockedApi.saveMyDeclaration.mockResolvedValue({ data: declaration() } as any);
  });

  it('renders the previous-employer encashment exemption and the LTA journeys already used in this block', async () => {
    await renderWithNoDeclaration();

    expect(
      screen.getByLabelText('Leave encashment exemption used at a previous employer'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('LTA journeys already used in this block'),
    ).toBeInTheDocument();
  });

  it('explains the leave travel block in plain language: two journeys, a four-year block, declared to avoid a third by accident', async () => {
    await renderWithNoDeclaration();

    expect(
      within(fieldRow('ltaJourneysUsedInBlock')).getByText(
        /allows 2 journeys in a block of 4 calendar years/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(fieldRow('ltaJourneysUsedInBlock')).getByText(/so a third is not claimed by accident/i),
    ).toBeInTheDocument();
  });

  it('explains that the section 10(10AA) ceiling is a lifetime one, not one per employer', async () => {
    await renderWithNoDeclaration();

    expect(
      within(fieldRow('previousEmployerEncashmentExemption')).getByText(
        /lifetime ceiling, not one per employer/i,
      ),
    ).toBeInTheDocument();
  });

  it('warns when more than two LTA journeys are declared as already used in this block, but still saves it', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '3' },
    });

    expect(
      within(fieldRow('ltaJourneysUsedInBlock')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      ltaJourneysUsedInBlock: 3,
    });
  });

  it('does not warn at exactly two journeys used', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '2' },
    });

    expect(
      within(fieldRow('ltaJourneysUsedInBlock')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();
  });

  it('saves the leave encashment exemption as a number and the LTA journey count as a number', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(
      screen.getByLabelText('Leave encashment exemption used at a previous employer'),
      { target: { value: '400000' } },
    );
    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      previousEmployerEncashmentExemption: 400000,
      ltaJourneysUsedInBlock: 1,
    });
  });

  it('refuses an unreadable leave encashment figure before any request, naming the field', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(
      screen.getByLabelText('Leave encashment exemption used at a previous employer'),
      { target: { value: 'lots' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(
        within(fieldRow('previousEmployerEncashmentExemption')).getByText(
          /Leave encashment exemption used at a previous employer.*amount in rupees/i,
        ),
      ).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a non-whole LTA journeys count before any request, naming the field', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/LTA journeys already used in this block must be a whole number/i),
      ).toBeInTheDocument(),
    );
    expect(mockedApi.saveMyDeclaration).not.toHaveBeenCalled();
  });

  it('fills the new fields from what is on record', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({
        previousEmployerEncashmentExemption: '250000.00',
        ltaJourneysUsedInBlock: 1,
      }),
    } as any);
    render(<MyTaxDeclarationPage />);

    await waitFor(() =>
      expect(
        screen.getByLabelText('Leave encashment exemption used at a previous employer'),
      ).toHaveValue('250000.00'),
    );
    expect(screen.getByLabelText('LTA journeys already used in this block')).toHaveValue('1');
  });

  it('warns on the leave travel field, not the journey count, when two journeys are already used and an amount is declared, and still saves it', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('LTA exemption'), { target: { value: '15000' } });

    expect(
      within(fieldRow('ltaExemption')).getByText(/will not reduce your tax/i),
    ).toBeInTheDocument();
    // The journey count itself is not over the block, so it carries no
    // warning of its own — this one belongs on the amount, not the count.
    expect(
      within(fieldRow('ltaJourneysUsedInBlock')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      ltaExemption: 15000,
      ltaJourneysUsedInBlock: 2,
    });
  });

  it('does not warn on the leave travel field when only one journey has been used', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('LTA exemption'), { target: { value: '15000' } });

    expect(
      within(fieldRow('ltaExemption')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();
  });

  it('does not warn on the leave travel field when the block is exhausted but nothing is declared for it', async () => {
    await renderWithNoDeclaration();

    fireEvent.change(screen.getByLabelText('LTA journeys already used in this block'), {
      target: { value: '2' },
    });

    expect(
      within(fieldRow('ltaExemption')).queryByText(/will not reduce your tax/i),
    ).not.toBeInTheDocument();
  });
});

describe('MyTaxDeclarationPage — Form 10E furnished', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getMyDeclaration.mockResolvedValue({ data: null } as any);
    mockedApi.saveMyDeclaration.mockResolvedValue({ data: declaration() } as any);
  });

  it('renders a checkbox explaining what furnishing Form 10E is for', async () => {
    await renderWithNoDeclaration();

    const checkbox = screen.getByLabelText('Form 10E furnished');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(
      within(fieldRow('form10EFurnished')).getByText(/section 89 relief/i),
    ).toBeInTheDocument();
    expect(
      within(fieldRow('form10EFurnished')).getByText(/cannot reduce the tax it deducts/i),
    ).toBeInTheDocument();
  });

  it('saves whether Form 10E has been furnished as a boolean', async () => {
    await renderWithNoDeclaration();

    fireEvent.click(screen.getByLabelText('Form 10E furnished'));
    fireEvent.click(screen.getByRole('button', { name: /save declaration/i }));

    await waitFor(() => expect(mockedApi.saveMyDeclaration).toHaveBeenCalled());
    expect(mockedApi.saveMyDeclaration.mock.calls[0][0]).toMatchObject({
      form10EFurnished: true,
    });
  });

  it('fills the checkbox from what is on record', async () => {
    mockedApi.getMyDeclaration.mockResolvedValue({
      data: declaration({ form10EFurnished: true }),
    } as any);
    render(<MyTaxDeclarationPage />);

    await waitFor(() => expect(screen.getByLabelText('Form 10E furnished')).toBeChecked());
  });
});
