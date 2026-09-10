import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import StatutoryConfigPage from './page';
import type { IncomeTaxConfig, ProfessionalTaxSlab, StatutoryConfig } from '@/types';

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

// Mock UI components (imported from individual paths in this page)
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <span>
      <span>{label}</span>
      <input {...props} />
      {error ? <span role="alert">{error}</span> : null}
    </span>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options, placeholder, children, ...props }: any) => (
    <span>
      <span>{label}</span>
      <select {...props}>
        {children ??
          options?.map((option: any) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </span>
  ),
}));

// Mock API
const mockGetConfig = jest.fn();
const mockUpdateConfig = jest.fn();
const mockGetPtSlabs = jest.fn();
const mockGetIncomeTaxConfig = jest.fn();

jest.mock('@/lib/api', () => ({
  statutoryApi: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
    getProfessionalTaxSlabs: (...args: unknown[]) => mockGetPtSlabs(...args),
    getIncomeTaxConfig: (...args: unknown[]) => mockGetIncomeTaxConfig(...args),
  },
}));

const config: StatutoryConfig = {
  id: 'cfg-1',
  tenantId: 'tenant-1',

  pfEnabled: true,
  pfEmployeeRate: '12.00',
  pfEmployerRate: '12.00',
  epsRate: '8.33',
  pfWageCeiling: '15000.00',
  applyPfCeiling: false,
  edliRate: '0.50',
  pfAdminRate: '0.50',
  pfAdminMinimum: '500.00',

  esiEnabled: true,
  esiEmployeeRate: '0.75',
  esiEmployerRate: '3.25',
  esiWageLimit: '21000.00',

  ptEnabled: true,
  ptState: 'Karnataka',

  lwfEnabled: true,
  lwfEmployeeAmount: '20.00',
  lwfEmployerAmount: '40.00',
  lwfMonths: [1, 7],

  gratuityEnabled: true,
  gratuityDaysPerYear: '15.00',
  gratuityMonthDays: '26.00',
  gratuityMinYears: '5.00',
  gratuityExemptionCap: '2000000.00',

  leaveEncashmentEnabled: true,
  encashmentMonthDays: '30.00',

  ptMonths: [],
  encashmentExemptionCap: '2500000.00',
  encashmentExemptDaysPerYear: '30.00',
  encashmentExemptMonths: '10.00',
  encashmentGovernmentEmployer: false,
  proofVerificationRequired: false,
  proofCutoffMonth: 1,
  tdsEnabled: true,
  defaultTaxRegime: 'NEW',

  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

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
    februaryAmount: null,
    gender: null,
  },
];

const incomeTaxConfigs: IncomeTaxConfig[] = [
  {
    id: 'itc-1',
    financialYear: 2026,
    regime: 'NEW',
    ageBand: 'GENERAL',
    // Nil under the new regime: section 115BAC withdraws these deductions, so
    // inheriting the old regime's limits would suggest an eligibility that
    // does not exist.
    section80CLimit: '0.00',
    section80DLimit: '0.00',
    section80CCD1BLimit: '0.00',
    marginalReliefEnabled: true,
    standardDeduction: '75000.00',
    rebateIncomeLimit: '700000.00',
    rebateMaxAmount: '25000.00',
    cessRate: '4.00',
    surchargeSlabs: null,
    slabs: [
      { id: 's-1', fromAmount: '0.00', toAmount: '300000.00', rate: '0.00' },
      { id: 's-2', fromAmount: '300000.00', toAmount: '700000.00', rate: '5.00' },
      { id: 's-3', fromAmount: '700000.00', toAmount: null, rate: '20.00' },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfig.mockResolvedValue({ data: config });
  mockUpdateConfig.mockResolvedValue({ data: config });
  mockGetPtSlabs.mockResolvedValue({ data: ptSlabs });
  mockGetIncomeTaxConfig.mockResolvedValue({ data: incomeTaxConfigs });
});

describe('StatutoryConfigPage — no configuration row', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue({ data: null });
  });

  it('says plainly that nothing statutory is deducted', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/nothing statutory is deducted/i)).toBeInTheDocument();
    });
  });

  it('offers to set the configuration up', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /set up statutory deductions/i }),
      ).toBeInTheDocument();
    });
  });

  it('does not render an error, and does not render a form full of zeros', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/nothing statutory is deducted/i)).toBeInTheDocument();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('PF employee share (%)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('only shows the form once setup is chosen, prefilled with the statutory rates', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /set up statutory deductions/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /set up statutory deductions/i }));

    expect(screen.getByLabelText('PF employee share (%)')).toHaveValue('12');
    expect(screen.getByText(/nothing is saved yet/i)).toBeInTheDocument();
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });
});

describe('StatutoryConfigPage — saving', () => {
  it('sends only the fields that changed', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('PF employee share (%)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('PF employee share (%)'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ pfEmployeeRate: 10 });
  });

  it('does not resend a rate whose displayed form differs only in trailing zeros', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('PF employer share (%)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('PF employer share (%)'), {
      target: { value: '12.000' },
    });
    fireEvent.change(screen.getByLabelText('ESI wage limit (₹)'), {
      target: { value: '25000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ esiWageLimit: 25000 });
  });

  it('says a change applies from the next payroll run where it is saved', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/takes effect from the next payroll run/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/runs already computed are not recalculated/i),
    ).toBeInTheDocument();
  });
});

describe('StatutoryConfigPage — refusing bad entries before sending', () => {
  it('refuses a percentage above 100 and names the field', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('PF employee share (%)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('PF employee share (%)'), {
      target: { value: '150' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('PF employee share (%)'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/between 0 and 100/i);
  });

  it('refuses an unreadable entry rather than treating it as zero', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('ESI wage limit (₹)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('ESI wage limit (₹)'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('ESI wage limit (₹)'),
    );
  });

  it('refuses a negative amount', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('LWF employee amount (₹)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('LWF employee amount (₹)'), {
      target: { value: '-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('LWF employee amount (₹)'),
    );
  });

  it('refuses an emptied field rather than writing a rate nobody typed', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Pension scheme (EPS) share (%)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Pension scheme (EPS) share (%)'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Pension scheme (EPS) share (%)'),
    );
  });
});

describe('StatutoryConfigPage — the pension carve-out', () => {
  it('explains that EPS is carved out of the employer share rather than added to it', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /carved out of the employer's share, not added to it/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it('shows what is left of the employer share after the pension carve-out', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText('3.67%')).toBeInTheDocument();
    });
    expect(screen.getByText(/to provident fund/i)).toBeInTheDocument();
  });

  it('says the pension share is always computed on capped wages', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /always computed on wages capped at the ceiling, even when you contribute on full wages/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it('scopes the ceiling toggle to the employee and employer shares only', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(
        screen.getByLabelText('Cap the employee and employer shares at the ceiling'),
      ).toBeInTheDocument();
    });
  });
});

describe('StatutoryConfigPage — gratuity', () => {
  it('labels the section 10(10) figure as an exemption cap, not a maximum gratuity', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Section 10(10) exemption cap (₹)')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/caps the exempt part, never the amount payable/i),
    ).toBeInTheDocument();
  });
});

describe('StatutoryConfigPage — labour welfare fund months', () => {
  it('offers the collecting months as toggles rather than a free text box', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Labour welfare fund collected in January')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Labour welfare fund collected in January')).toBeChecked();
    expect(screen.getByLabelText('Labour welfare fund collected in July')).toBeChecked();
    expect(screen.getByLabelText('Labour welfare fund collected in March')).not.toBeChecked();
    expect(screen.queryByLabelText(/lwf months/i)).not.toBeInTheDocument();
  });

  it('sends the whole month list when a month is toggled', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Labour welfare fund collected in March')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Labour welfare fund collected in March'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ lwfMonths: [1, 3, 7] });
  });

  it('says most states do not collect monthly', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/most states do not collect every month/i)).toBeInTheDocument();
    });
  });
});

describe('StatutoryConfigPage — slab reference tables', () => {
  it('reads the professional tax slabs for the configured state', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(mockGetPtSlabs).toHaveBeenCalledWith('Karnataka');
    });
  });

  it('renders professional tax slabs as read-only reference', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/₹25,000 and above/)).toBeInTheDocument();
    });

    const table = screen.getByRole('table', { name: /professional tax slabs/i });
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });

  it('says how the slabs are changed', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/npm run prisma:seed-statutory/i).length).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByText(/docs\/india-statutory-payroll\.md/i).length,
    ).toBeGreaterThan(0);
  });

  it('renders income tax slabs with the standard deduction, rebate and cess', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/FY 2026-27/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Standard deduction')).toBeInTheDocument();
    expect(screen.getByText('₹75,000')).toBeInTheDocument();
    expect(screen.getByText('Section 87A rebate limit')).toBeInTheDocument();
    expect(screen.getByText('₹7,00,000')).toBeInTheDocument();
    expect(screen.getByText('Section 87A rebate amount')).toBeInTheDocument();
    expect(screen.getByText('₹25,000')).toBeInTheDocument();
    expect(screen.getByText('Health and education cess')).toBeInTheDocument();
    expect(screen.getByText('4%')).toBeInTheDocument();
  });

  it('renders income tax slabs as read-only reference', async () => {
    render(<StatutoryConfigPage />);

    const table = await screen.findByRole('table', {
      name: /income tax slabs for FY 2026-27, NEW regime/i,
    });
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('StatutoryConfigPage — no income tax slabs', () => {
  beforeEach(() => {
    mockGetIncomeTaxConfig.mockResolvedValue({ data: [] });
  });

  it('says no TDS is deducted rather than guessing', async () => {
    render(<StatutoryConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/no TDS is deducted/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/rather than a figure being guessed/i)).toBeInTheDocument();
  });
});

describe('StatutoryConfigPage — investment proofs', () => {
  it('offers the verification switch off, and says what turning it on does', async () => {
    render(<StatutoryConfigPage />);

    const toggle = await screen.findByLabelText(/Require verified proofs/i);
    expect(toggle).not.toBeChecked();
    // Turning this on raises the TDS of every employee without approved
    // proofs. Somebody has to decide that; it must not read like a tidy-up.
    expect(screen.getByText(/allows nothing under that head/i)).toBeInTheDocument();
  });

  it('sends the proof settings only when they change', async () => {
    render(<StatutoryConfigPage />);

    const toggle = await screen.findByLabelText(/Require verified proofs/i);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText(/Month verified amounts take over/i), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({
        proofVerificationRequired: true,
        proofCutoffMonth: 2,
      });
    });
  });
});

describe('StatutoryConfigPage — months a state collects professional tax in', () => {
  it('sends only the months that were ticked', async () => {
    // Empty means every month, which is what most states do. A half-yearly
    // state's slab amounts are period amounts, so deducting twelve times would
    // take six times what it levies.
    render(<StatutoryConfigPage />);

    fireEvent.click(await screen.findByLabelText('Professional tax collected in April'));
    fireEvent.click(screen.getByLabelText('Professional tax collected in October'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({ ptMonths: [4, 10] });
    });
  });
});

describe('StatutoryConfigPage — section 10(10AA)', () => {
  it('lets the encashment exemption parameters be set', async () => {
    render(<StatutoryConfigPage />);

    // A figure different from the seeded one, or nothing is sent: the page
    // deliberately patches only what changed.
    fireEvent.change(await screen.findByLabelText(/Encashment exemption cap/i), {
      target: { value: '3000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({ encashmentExemptionCap: 3000000 });
    });
  });

  it('says the cap limits the exemption and not the amount paid', async () => {
    render(<StatutoryConfigPage />);

    expect(
      await screen.findByText(/caps the exempt part, not what is paid/i),
    ).toBeInTheDocument();
  });
});
