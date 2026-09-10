import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import AdminSlabsPage from './page';
import { currentFinancialYear, financialYearLabel } from '@/components/form16/financialYear';
import type { IncomeTaxConfig, ProfessionalTaxSlab } from '@/types';

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

// Mock UI components (one mock per @/components/ui path the page reaches)
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, variant, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <span>
      {label ? <span>{label}</span> : null}
      <input {...props} />
      {error ? <span role="alert">{error}</span> : null}
    </span>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options, placeholder, children, ...props }: any) => (
    <span>
      {label ? <span>{label}</span> : null}
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
    </span>
  ),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {title ? <h3>{title}</h3> : null}
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock API
const mockListPt = jest.fn();
const mockCreatePt = jest.fn();
const mockUpdatePt = jest.fn();
const mockDeletePt = jest.fn();
const mockListIt = jest.fn();
const mockSaveIt = jest.fn();
const mockDeleteIt = jest.fn();

jest.mock('@/lib/api', () => ({
  slabsApi: {
    listProfessionalTax: (...args: unknown[]) => mockListPt(...args),
    createProfessionalTax: (...args: unknown[]) => mockCreatePt(...args),
    updateProfessionalTax: (...args: unknown[]) => mockUpdatePt(...args),
    deleteProfessionalTax: (...args: unknown[]) => mockDeletePt(...args),
    listIncomeTax: (...args: unknown[]) => mockListIt(...args),
    saveIncomeTax: (...args: unknown[]) => mockSaveIt(...args),
    deleteIncomeTax: (...args: unknown[]) => mockDeleteIt(...args),
  },
}));

const thisYear = currentFinancialYear();

const ptSlabs: ProfessionalTaxSlab[] = [
  {
    id: 'pt-1',
    state: 'Karnataka',
    fromAmount: '0.00',
    toAmount: '24999.00',
    amount: '0.00',
    februaryAmount: null,
    gender: null,
  },
  {
    id: 'pt-2',
    state: 'Karnataka',
    fromAmount: '25000.00',
    toAmount: null,
    amount: '200.00',
    februaryAmount: '300.00',
    gender: null,
  },
];

function incomeTaxConfig(overrides: Partial<IncomeTaxConfig> = {}): IncomeTaxConfig {
  return {
    id: 'itc-1',
    financialYear: thisYear,
    regime: 'OLD',
    ageBand: 'GENERAL',
    standardDeduction: '50000.00',
    rebateIncomeLimit: '500000.00',
    rebateMaxAmount: '12500.00',
    cessRate: '4.00',
    section80CLimit: '150000.00',
    section80DLimit: '25000.00',
    section80CCD1BLimit: '50000.00',
    childrenEducationMonthlyLimit: '100.00',
    hostelAllowanceMonthlyLimit: '300.00',
    childrenAllowanceMaxChildren: 2,
    marginalReliefEnabled: true,
    surchargeSlabs: null,
    slabs: [
      { id: 's-1', fromAmount: '0.00', toAmount: '250000.00', rate: '0.00' },
      { id: 's-2', fromAmount: '250000.00', toAmount: '500000.00', rate: '5.00' },
      { id: 's-3', fromAmount: '500000.00', toAmount: null, rate: '20.00' },
    ],
    ...overrides,
  };
}

/** The row wrapper a professional tax band renders into. */
function ptRow(id: string) {
  return screen.getByTestId(`pt-row-${id}`);
}

/** The row wrapper an income tax band renders into, by its zero-based index. */
function bandRow(index: number) {
  return screen.getByTestId(`band-row-${index}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListPt.mockResolvedValue({ data: ptSlabs });
  mockCreatePt.mockResolvedValue({ data: ptSlabs[0] });
  mockUpdatePt.mockResolvedValue({ data: ptSlabs[0] });
  mockDeletePt.mockResolvedValue({ data: null });
  mockListIt.mockResolvedValue({ data: [incomeTaxConfig()] });
  mockSaveIt.mockResolvedValue({ data: incomeTaxConfig() });
  mockDeleteIt.mockResolvedValue({ data: null });
});

describe('AdminSlabsPage — general', () => {
  it('says a change applies from the next payroll run, and runs already computed are not recalculated', async () => {
    render(<AdminSlabsPage />);

    await waitFor(() => {
      expect(screen.getByText(/takes effect from the next payroll run/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/runs already computed are not recalculated/i)).toBeInTheDocument();
  });
});

describe('AdminSlabsPage — professional tax', () => {
  it('loads and renders the bands for the selected state', async () => {
    render(<AdminSlabsPage />);

    await waitFor(() => expect(mockListPt).toHaveBeenCalledWith('Karnataka'));
    expect(await screen.findByText(/24,999/)).toBeInTheDocument();
    expect(screen.getByText(/25,000 and above/)).toBeInTheDocument();
  });

  it('reloads bands for the newly selected state', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListPt).toHaveBeenCalledWith('Karnataka'));

    mockListPt.mockResolvedValueOnce({ data: [] });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Maharashtra' } });

    await waitFor(() => expect(mockListPt).toHaveBeenCalledWith('Maharashtra'));
  });

  it('confirms before creating a new band, and says what it affects', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListPt).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /add professional tax band/i }));
    const modal = screen.getByRole('dialog', { name: /add professional tax band/i });

    fireEvent.change(within(modal).getByLabelText('From (₹)'), { target: { value: '0' } });
    fireEvent.change(within(modal).getByLabelText('To (₹)'), { target: { value: '15000' } });
    fireEvent.change(within(modal).getByLabelText('Amount per month (₹)'), {
      target: { value: '150' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /save band/i }));

    // Nothing sent yet — a confirmation stands between the form and the API.
    expect(mockCreatePt).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: /confirm professional tax change/i });
    expect(within(confirm).getByText(/Karnataka/)).toBeInTheDocument();
    expect(within(confirm).getByText(/next payroll run/i)).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: /confirm.*save/i }));

    await waitFor(() => expect(mockCreatePt).toHaveBeenCalledTimes(1));
    expect(mockCreatePt).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'Karnataka',
        fromAmount: 0,
        toAmount: 15000,
        amount: 150,
      }),
    );
  });

  it('refuses an unreadable entry before any confirmation is offered', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListPt).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /add professional tax band/i }));
    const modal = screen.getByRole('dialog', { name: /add professional tax band/i });

    fireEvent.change(within(modal).getByLabelText('Amount per month (₹)'), {
      target: { value: 'abc' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /save band/i }));

    expect(
      screen.queryByRole('dialog', { name: /confirm professional tax change/i }),
    ).not.toBeInTheDocument();
    expect(mockCreatePt).not.toHaveBeenCalled();
  });

  it('edits an existing band through the same confirm step', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListPt).toHaveBeenCalled());

    fireEvent.click(within(ptRow('pt-1')).getByRole('button', { name: /edit/i }));
    const modal = screen.getByRole('dialog', { name: /edit professional tax band/i });
    fireEvent.change(within(modal).getByLabelText('Amount per month (₹)'), {
      target: { value: '50' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /save band/i }));

    fireEvent.click(
      within(screen.getByRole('dialog', { name: /confirm professional tax change/i })).getByRole(
        'button',
        { name: /confirm.*save/i },
      ),
    );

    await waitFor(() => expect(mockUpdatePt).toHaveBeenCalledWith('pt-1', expect.objectContaining({ amount: 50 })));
  });

  it('confirms before deleting a band, and says what it affects', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListPt).toHaveBeenCalled());

    fireEvent.click(within(ptRow('pt-2')).getByRole('button', { name: /delete/i }));
    const confirm = screen.getByRole('dialog', { name: /delete professional tax band/i });
    expect(within(confirm).getByText(/Karnataka/)).toBeInTheDocument();

    expect(mockDeletePt).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockDeletePt).toHaveBeenCalledWith('pt-2'));
  });
});

describe('AdminSlabsPage — income tax ladder', () => {
  it('loads the ladder for the selected financial year, regime and age band', async () => {
    render(<AdminSlabsPage />);

    await waitFor(() => expect(mockListIt).toHaveBeenCalledWith(thisYear));
    // Wait for the real, three-band ladder to replace the single default band
    // the form starts with before anything has loaded.
    await screen.findByLabelText('Band 3 rate (%)');
    // Rates are shown exactly as the API sent them, never round-tripped through
    // a float — the same discipline the declaration form applies to money.
    expect(screen.getByLabelText('Band 1 rate (%)')).toHaveValue('0.00');
    expect(screen.getByLabelText('Band 2 rate (%)')).toHaveValue('5.00');
    expect(screen.getByLabelText('Band 3 rate (%)')).toHaveValue('20.00');
  });

  it('forces the age band to General under the new regime, and explains why', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Regime'), { target: { value: 'NEW' } });

    expect(screen.getByLabelText('Age band')).toBeDisabled();
    expect(screen.getByLabelText('Age band')).toHaveValue('GENERAL');
    expect(
      screen.getByText(/does not vary by age|only one configuration/i),
    ).toBeInTheDocument();
  });

  it('adds and removes bands', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /add income tax band/i }));
    expect(screen.getByLabelText('Band 4 rate (%)')).toBeInTheDocument();

    fireEvent.click(within(bandRow(3)).getByRole('button', { name: /remove band 4/i }));
    expect(screen.queryByLabelText('Band 4 rate (%)')).not.toBeInTheDocument();
  });

  it('confirms before saving the ladder, and says what it affects', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /save ladder/i }));

    expect(mockSaveIt).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: /confirm income tax ladder change/i });
    expect(within(confirm).getByText(new RegExp(financialYearLabel(thisYear)))).toBeInTheDocument();
    expect(within(confirm).getByText(/next payroll run/i)).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: /confirm.*save/i }));

    await waitFor(() => expect(mockSaveIt).toHaveBeenCalledTimes(1));
    const payload = mockSaveIt.mock.calls[0][0];
    expect(payload.financialYear).toBe(thisYear);
    expect(payload.regime).toBe('OLD');
    expect(payload.ageBand).toBe('GENERAL');
    expect(payload.slabs).toEqual([
      { fromAmount: 0, toAmount: 250000, rate: 0 },
      { fromAmount: 250000, toAmount: 500000, rate: 5 },
      { fromAmount: 500000, toAmount: null, rate: 20 },
    ]);
  });

  it("surfaces a gap refusal against the offending band rather than as a bare toast", async () => {
    mockSaveIt.mockRejectedValueOnce({
      // The server's real wording, from slabs.service.ts: it names a band by
      // the amount it starts at, never by a number.
      response: {
        data: {
          message:
            'The band starting at 250000.00 has an upper bound of 400000.00, but the ' +
            'next band starts at 500000.00, leaving the income between them taxed at nothing',
        },
      },
    });
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /save ladder/i }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /confirm income tax ladder change/i }),
      ).getByRole('button', { name: /confirm.*save/i }),
    );

    await waitFor(() =>
      expect(
        within(bandRow(1)).getByText(/leaving the income between them taxed at nothing/i),
      ).toBeInTheDocument(),
    );
  });

  it('surfaces a refusal that does not name a band as a general ladder notice', async () => {
    mockSaveIt.mockRejectedValueOnce({
      response: { data: { message: 'The ladder must start at zero.' } },
    });
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /save ladder/i }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /confirm income tax ladder change/i }),
      ).getByRole('button', { name: /confirm.*save/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/the ladder must start at zero/i)).toBeInTheDocument(),
    );
  });

  it('confirms before deleting the configuration', async () => {
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /delete configuration/i }));
    const confirm = screen.getByRole('dialog', { name: /delete income tax configuration/i });
    expect(mockDeleteIt).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockDeleteIt).toHaveBeenCalledWith('itc-1'));
  });

  it('does not offer to delete a configuration that has not been saved yet', async () => {
    mockListIt.mockResolvedValue({ data: [] });
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /delete configuration/i })).not.toBeInTheDocument();
  });

  it('surfaces an error toast when saving fails without a per-band message', async () => {
    mockSaveIt.mockRejectedValueOnce(new Error('network down'));
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /save ladder/i }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /confirm income tax ladder change/i }),
      ).getByRole('button', { name: /confirm.*save/i }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('keeps the lowest band starting at zero when a band above it is removed', async () => {
    // The first band's lower bound is not editable, because a ladder must
    // start at zero. Removing band one would otherwise leave 250000 sitting at
    // index nought with a disabled input, and no way back: the server refuses
    // the ladder and the page offers no means of fixing it.
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(within(bandRow(0)).getByRole('button', { name: /remove/i }));

    await waitFor(() =>
      expect(screen.getByLabelText('Band 1 from (₹)')).toHaveValue('0'),
    );
  });

  it('closes the confirmation when the server refuses a band, so the refusal is visible', async () => {
    mockSaveIt.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'The band starting at 250000.00 leaves a gap after 200000.00: income in ' +
            'that range would be taxed at nothing',
        },
      },
    });
    render(<AdminSlabsPage />);
    await waitFor(() => expect(mockListIt).toHaveBeenCalled());
    await screen.findByLabelText('Band 3 rate (%)');

    fireEvent.click(screen.getByRole('button', { name: /save ladder/i }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /confirm income tax ladder change/i }),
      ).getByRole('button', { name: /confirm.*save/i }),
    );

    // The dialog sitting open over the row hides the very message it caused,
    // and invites the reader to confirm the same refusal again.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /confirm income tax ladder change/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
