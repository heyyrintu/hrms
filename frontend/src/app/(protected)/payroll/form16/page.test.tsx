import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import PayrollForm16Page from './page';

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
    user: { id: '1', email: 'payroll@test.com', role: 'HR_ADMIN', tenantId: 't1' },
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
    getForEmployee: jest.fn(),
    getQuartersForEmployee: jest.fn(),
    downloadForEmployee: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { form16Api, employeesApi } = require('@/lib/api');

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
  'No tax slabs are configured for this financial year, so the tax figures are nil.',
  'Part A is issued by TRACES against the returns actually filed and cannot be produced here.',
];

const certificate = {
  financialYear: 2026,
  financialYearLabel: 'FY 2026-27',
  assessmentYear: 'AY 2027-28',
  periodFrom: '2026-04-01',
  periodTo: '2027-03-31',
  regime: 'NEW',
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

const employees = [
  { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' },
  { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Iyer' },
];

const selectEmployee = async (id: string) => {
  const select = await screen.findByLabelText(/Employee/i);
  // Wait for the employee list to arrive: a select cannot take a value that has
  // no option yet.
  await waitFor(() => {
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
  });
  fireEvent.change(select, { target: { value: id } });
};

beforeEach(() => {
  jest.clearAllMocks();
  employeesApi.getAll.mockResolvedValue({ data: { data: employees } });
  form16Api.getForEmployee.mockResolvedValue({ data: certificate });
  form16Api.getQuartersForEmployee.mockResolvedValue({ data: quarterSummary });
  form16Api.downloadForEmployee.mockResolvedValue(undefined);
});

describe('PayrollForm16Page', () => {
  it('titles the page as Part B and never as a bare Form 16', async () => {
    render(<PayrollForm16Page />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Form 16 \(Part B\)/i })).toBeInTheDocument();
    });
  });

  it('explains that Part A comes from TRACES and is not produced here', async () => {
    render(<PayrollForm16Page />);

    await waitFor(() => {
      expect(screen.getAllByText(/Part A[\s\S]*TRACES/i).length).toBeGreaterThan(0);
    });
  });

  it('lists employees to pick from and prompts before one is chosen', async () => {
    render(<PayrollForm16Page />);

    await waitFor(() => {
      expect(employeesApi.getAll).toHaveBeenCalled();
    });

    expect(await screen.findByText(/EMP001/)).toBeInTheDocument();
    expect(screen.getByText(/EMP002/)).toBeInTheDocument();
    expect(screen.getByText(/Pick an employee/i)).toBeInTheDocument();
    expect(form16Api.getForEmployee).not.toHaveBeenCalled();
  });

  it('fetches the chosen employee certificate for the chosen year', async () => {
    render(<PayrollForm16Page />);

    await waitFor(() => {
      expect(employeesApi.getAll).toHaveBeenCalled();
    });

    await selectEmployee('e2');

    await waitFor(() => {
      expect(form16Api.getForEmployee).toHaveBeenCalledWith('e2', expect.any(Number));
    });
    expect(form16Api.getQuartersForEmployee).toHaveBeenCalledWith('e2', expect.any(Number));
  });

  it('renders the numbered statutory lines with their figures', async () => {
    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByText(/^1\. Gross salary$/)).toBeInTheDocument();
    });

    expect(screen.getByText('₹12,00,000.00')).toBeInTheDocument();
    expect(screen.getByText(/^2\. Less: allowances exempt under section 10$/)).toBeInTheDocument();
    expect(screen.getByText(/^3\. Balance$/)).toBeInTheDocument();
    expect(screen.getByText(/^4\. Deductions under section 16$/)).toBeInTheDocument();
    expect(screen.getByText(/^5\. Income chargeable under the head/)).toBeInTheDocument();
    expect(screen.getByText(/^6\(a\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^6\(b\)\. Income from house property$/)).toBeInTheDocument();
    expect(screen.getByText(/^7\. Gross total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^8\. Deductions under Chapter VI-A$/)).toBeInTheDocument();
    expect(screen.getByText(/^9\. Total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^10\. Tax on total income$/)).toBeInTheDocument();
    expect(screen.getByText(/^11\. Rebate under section 87A$/)).toBeInTheDocument();
    expect(screen.getByText(/^12\. Surcharge$/)).toBeInTheDocument();
    expect(screen.getByText(/^13\. Health and education cess$/)).toBeInTheDocument();
    expect(screen.getByText(/^14\. Total tax payable$/)).toBeInTheDocument();
    expect(screen.getByText(/^15\(a\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^15\(b\)\./)).toBeInTheDocument();
    expect(screen.getByText(/^15\. Total tax deducted$/)).toBeInTheDocument();
  });

  it('renders a negative house property figure as a negative amount', async () => {
    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByText('-₹1,50,000.00')).toBeInTheDocument();
    });
    expect(screen.queryByText('₹1,50,000.00')).not.toBeInTheDocument();
  });

  it('renders every note, including the service warnings', async () => {
    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByText(notes[0])).toBeInTheDocument();
    });
    expect(screen.getByText(notes[1])).toBeInTheDocument();
    expect(screen.getByText(quarterSummary.notes[0])).toBeInTheDocument();
  });

  it('shows the TRACES receipt column with a placeholder and the reconciliation caveat', async () => {
    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByText(/TRACES receipt number/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Issued by TRACES/i).length).toBeGreaterThanOrEqual(4);
    expect(
      screen.getByText(/what payroll deducted, not what has been reported in a filed return/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Form 24Q/).length).toBeGreaterThan(0);
  });

  it('explains calmly when the employee had no payslips in the year', async () => {
    form16Api.getForEmployee.mockResolvedValue({
      data: { ...certificate, hasPayslipsInYear: false, payslipCount: 0 },
    });

    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByText(/No payslips in this financial year/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/every figure below is nil/i)).toBeInTheDocument();
    expect(screen.getByText(/not an error/i)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces an error when the download fails', async () => {
    form16Api.downloadForEmployee.mockRejectedValue(new Error('network'));

    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Part B/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Download Part B/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Part B/i));
    });
  });

  it('surfaces an error when the certificate cannot be loaded', async () => {
    form16Api.getForEmployee.mockRejectedValue(new Error('boom'));

    render(<PayrollForm16Page />);
    await waitFor(() => expect(employeesApi.getAll).toHaveBeenCalled());
    await selectEmployee('e1');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Part B/i));
    });
  });

  it('ignores a slow certificate for an employee who is no longer selected', async () => {
    // Switching employees is a click apart, and one request can easily outlive
    // the next. If the older one wins, the page shows one colleague's tax
    // position under another colleague's name.
    const asha = { ...certificate, employee: { ...certificate.employee, name: 'Asha Rao', employeeCode: 'EMP001' } };
    const vikram = { ...certificate, employee: { ...certificate.employee, name: 'Vikram Iyer', employeeCode: 'EMP002' } };

    let releaseAsha = () => {};
    form16Api.getForEmployee.mockImplementation((id: string) =>
      id === 'e1'
        ? new Promise((resolve) => {
            releaseAsha = () => resolve({ data: asha });
          })
        : Promise.resolve({ data: vikram }),
    );

    render(<PayrollForm16Page />);
    await selectEmployee('e1');
    await selectEmployee('e2');
    await screen.findByText(/Vikram Iyer \(EMP002\)/);

    releaseAsha();
    // Let the stale request's continuation actually run. Without this the test
    // asserts before the overwrite could have happened and proves nothing.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(screen.queryByText(/Asha Rao \(EMP001\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/Vikram Iyer \(EMP002\)/)).toBeInTheDocument();
  });
});
