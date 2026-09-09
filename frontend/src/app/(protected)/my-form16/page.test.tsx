import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
import MyForm16Page from './page';

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

// Mock UI components
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
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
  form16Api: {
    getMine: jest.fn(),
    getMyQuarters: jest.fn(),
    downloadMine: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { form16Api } = require('@/lib/api');

const quarters = [
  {
    quarter: 'Q1',
    months: ['April', 'May', 'June'],
    amountPaid: '285000.00',
    taxDeducted: '9750.00',
    payslipCount: 3,
    tracesReceiptNumber: null,
  },
  {
    quarter: 'Q2',
    months: ['July', 'August', 'September'],
    amountPaid: '285000.00',
    taxDeducted: '9750.00',
    payslipCount: 3,
    tracesReceiptNumber: null,
  },
  {
    quarter: 'Q3',
    months: ['October', 'November', 'December'],
    amountPaid: '285000.00',
    taxDeducted: '9750.00',
    payslipCount: 3,
    tracesReceiptNumber: null,
  },
  {
    quarter: 'Q4',
    months: ['January', 'February', 'March'],
    amountPaid: '285000.00',
    taxDeducted: '9750.00',
    payslipCount: 3,
    tracesReceiptNumber: null,
  },
];

const notes = [
  'Part A of this certificate is issued by TRACES against the returns actually filed, and is not produced here.',
  'Declared investment amounts were accepted as given and were not checked against the statutory ceilings.',
];

const certificate = {
  financialYear: 2026,
  financialYearLabel: 'FY 2026-27',
  assessmentYear: 'AY 2027-28',
  periodFrom: '2026-04-01',
  periodTo: '2027-03-31',
  regime: 'OLD',
  employer: {
    name: 'Drona Logitech Private Limited',
    address: 'Sector V, Kolkata 700091',
    tan: 'CALD12345A',
    pan: 'AAACD1234B',
  },
  employee: {
    id: 'e1',
    name: 'Asha Rao',
    employeeCode: 'EMP001',
    pan: 'ABCPR1234C',
    designation: 'Senior Engineer',
  },
  hasPayslipsInYear: true,
  payslipCount: 12,
  grossSalary: '1200000.00',
  allowancesExemptSection10: '120000.00',
  balance: '1080000.00',
  deductionsSection16: {
    standardDeduction: '50000.00',
    professionalTax: '2400.00',
    total: '52400.00',
  },
  incomeChargeableUnderSalaries: '1027600.00',
  otherIncome: '15000.00',
  incomeFromHouseProperty: '-150000.00',
  grossTotalIncome: '892600.00',
  deductionsChapterVIA: {
    section80C: '145000.00',
    section80D: '25000.00',
    section80CCD1B: '50000.00',
    section80CCD2: '36000.00',
    otherDeductions: '0.00',
    total: '256000.00',
  },
  totalIncome: '636600.00',
  taxOnTotalIncome: '38820.00',
  rebateSection87A: '0.00',
  surcharge: '0.00',
  healthAndEducationCess: '1552.80',
  totalTaxPayable: '40372.80',
  taxDeductedByEmployer: '39000.00',
  taxDeductedByPreviousEmployer: '1000.00',
  totalTaxDeducted: '40000.00',
  balanceTaxPayable: '372.80',
  refundDue: '0.00',
  providentFundEmployeeContribution: '72000.00',
  quarterlyTds: quarters,
  notes,
};

const quarterSummary = {
  financialYear: 2026,
  financialYearLabel: 'FY 2026-27',
  employee: certificate.employee,
  quarters,
  totalAmountPaid: '1140000.00',
  totalTaxDeducted: '39000.00',
  notes: ['Quarterly figures come from processed payslips, not from a filed return.'],
};

beforeEach(() => {
  jest.clearAllMocks();
  form16Api.getMine.mockResolvedValue({ data: certificate });
  form16Api.getMyQuarters.mockResolvedValue({ data: quarterSummary });
  form16Api.downloadMine.mockResolvedValue(undefined);
});

describe('MyForm16Page', () => {
  it('titles the page as Part B and never as a bare Form 16', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /My Form 16 \(Part B\)/i })).toBeInTheDocument();
    });
  });

  it('explains that Part A comes from TRACES and is not produced here', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getAllByText(/Part A[\s\S]*TRACES/i).length).toBeGreaterThan(0);
    });
  });

  it('renders the numbered statutory lines with their figures', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByText(/^1\. Gross salary$/)).toBeInTheDocument();
    });

    expect(screen.getByText('₹12,00,000.00')).toBeInTheDocument();
    expect(screen.getByText(/^2\. Less: allowances exempt under section 10$/)).toBeInTheDocument();
    expect(screen.getByText('₹1,20,000.00')).toBeInTheDocument();
    expect(screen.getByText(/^3\. Balance$/)).toBeInTheDocument();
    expect(screen.getByText(/^4\. Deductions under section 16$/)).toBeInTheDocument();
    expect(screen.getByText(/Standard deduction/)).toBeInTheDocument();
    expect(screen.getByText(/Professional tax/)).toBeInTheDocument();
    expect(screen.getByText(/^5\. Income chargeable under the head/)).toBeInTheDocument();
    expect(screen.getByText(/^6\(a\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^6\(b\)\. Income from house property$/)).toBeInTheDocument();
    expect(screen.getByText(/^7\. Gross total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^8\. Deductions under Chapter VI-A$/)).toBeInTheDocument();
    expect(screen.getByText(/Section 80C\b/)).toBeInTheDocument();
    expect(screen.getByText(/Section 80D\b/)).toBeInTheDocument();
    expect(screen.getByText(/Section 80CCD\(1B\)/)).toBeInTheDocument();
    expect(screen.getByText(/Section 80CCD\(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/^9\. Total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^10\. Tax on total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^11\. Rebate under section 87A$/)).toBeInTheDocument();
    expect(screen.getByText(/^12\. Surcharge$/)).toBeInTheDocument();
    expect(screen.getByText(/^13\. Health and education cess$/)).toBeInTheDocument();
    expect(screen.getByText(/^14\. Total tax payable$/)).toBeInTheDocument();
    expect(screen.getByText(/^15\(a\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^15\(b\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^15\. Total tax deducted$/)).toBeInTheDocument();
    expect(screen.getByText(/Balance tax payable/)).toBeInTheDocument();
    expect(screen.getByText(/Refund due/)).toBeInTheDocument();

    // A few figures, in the Indian numbering system, straight from the strings.
    expect(screen.getByText('₹6,36,600.00')).toBeInTheDocument();
    expect(screen.getByText('₹40,372.80')).toBeInTheDocument();
    expect(screen.getByText('₹1,552.80')).toBeInTheDocument();
  });

  it('renders a negative house property figure as a negative amount', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByText('-₹1,50,000.00')).toBeInTheDocument();
    });

    // Never as a positive.
    expect(screen.queryByText('₹1,50,000.00')).not.toBeInTheDocument();
  });

  it('renders every note the service attached to the certificate', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByText(notes[0])).toBeInTheDocument();
    });
    expect(screen.getByText(notes[1])).toBeInTheDocument();
    expect(screen.getByText(quarterSummary.notes[0])).toBeInTheDocument();
  });

  it('renders the quarterly TDS table with a visible TRACES receipt placeholder', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByText('Q1')).toBeInTheDocument();
    });

    expect(screen.getByText('Q4')).toBeInTheDocument();
    expect(screen.getByText(/TRACES receipt number/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Issued by TRACES/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/April, May, June/)).toBeInTheDocument();
  });

  it('says the quarterly figures are what payroll deducted, not what was filed', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(
        screen.getByText(/what payroll deducted, not what has been reported in a filed return/i),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Form 24Q/).length).toBeGreaterThan(0);
  });

  it('explains calmly when there were no payslips in the year', async () => {
    form16Api.getMine.mockResolvedValue({
      data: {
        ...certificate,
        hasPayslipsInYear: false,
        payslipCount: 0,
      },
    });

    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByText(/No payslips in this financial year/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/every figure below is nil/i)).toBeInTheDocument();
    expect(screen.getByText(/not an error/i)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces an error when the download fails', async () => {
    form16Api.downloadMine.mockRejectedValue(new Error('network'));

    render(<MyForm16Page />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Part B/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Download Part B/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Part B/i));
    });
  });

  it('reloads the certificate when a different financial year is chosen', async () => {
    render(<MyForm16Page />);

    await waitFor(() => {
      expect(form16Api.getMine).toHaveBeenCalled();
    });

    const defaultYear = form16Api.getMine.mock.calls[0][0] as number;
    expect(typeof defaultYear).toBe('number');

    fireEvent.change(screen.getByLabelText(/Financial year/i), {
      target: { value: String(defaultYear - 1) },
    });

    await waitFor(() => {
      expect(form16Api.getMine).toHaveBeenCalledWith(defaultYear - 1);
    });
  });
});
