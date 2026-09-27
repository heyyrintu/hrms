import { Decimal } from '@prisma/client/runtime/library';
import { buildJournal, JournalMappingConfig, JournalPayslipInput } from './journal-builder';

function payslip(overrides: Partial<JournalPayslipInput> = {}): JournalPayslipInput {
  return {
    employeeId: 'emp-1',
    departmentName: null,
    branchName: null,
    basePay: 0,
    otPay: 0,
    earnings: [],
    deductions: [],
    netPay: 0,
    pfEmployee: 0,
    esiEmployee: 0,
    professionalTax: 0,
    lwfEmployee: 0,
    tds: 0,
    pfEmployer: 0,
    epsEmployer: 0,
    edliEmployer: 0,
    pfAdminEmployer: 0,
    esiEmployer: 0,
    lwfEmployer: 0,
    held: false,
    ...overrides,
  };
}

function config(overrides: Partial<JournalMappingConfig> = {}): JournalMappingConfig {
  return {
    mappings: new Map(),
    suspense: null,
    costCenterMode: 'NONE',
    allowUnmapped: false,
    ...overrides,
  };
}

describe('buildJournal', () => {
  it('produces a balanced journal for a plain run', () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['PF_EMPLOYEE', { glCode: '2001', glName: 'PF payable' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          basePay: 50000,
          pfEmployee: 1800,
          netPay: 48200,
        }),
      ],
      config({ mappings }),
    );

    expect(result.balanced).toBe(true);
    expect(result.totalDebit.toNumber()).toBe(50000);
    expect(result.totalCredit.toNumber()).toBe(50000);
    expect(result.unmappedKeys).toEqual([]);
  });

  it('does not double count statutory deduction lines already in JSON', () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['PF_EMPLOYEE', { glCode: '2001', glName: 'PF payable' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          basePay: 50000,
          // A statutory line also appears in the JSON deductions array, as
          // payroll writes it for the payslip view. It must be skipped so the
          // PF_EMPLOYEE column is the only source.
          deductions: [{ name: 'Provident Fund', amount: 1800, kind: 'STATUTORY' }],
          pfEmployee: 1800,
          netPay: 48200,
        }),
      ],
      config({ mappings }),
    );

    const pfLine = result.lines.find((l) => l.glCode === '2001');
    expect(pfLine?.credit).toBe(1800);
    expect(result.balanced).toBe(true);
  });

  it('books employer contributions as an expense and its payable for the same amount', () => {
    const mappings = new Map([
      ['PF_EMPLOYER', { glCode: '5001', glName: 'PF employer expense' }],
      ['PF_EMPLOYER_PAYABLE', { glCode: '2003', glName: 'PF employer payable' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [payslip({ pfEmployer: 1800, netPay: 1800 })],
      config({ mappings }),
    );

    const expense = result.lines.find((l) => l.glCode === '5001');
    const payable = result.lines.find((l) => l.glCode === '2003');
    expect(expense?.debit).toBe(1800);
    expect(payable?.credit).toBe(1800);
  });

  it("routes a held employee's net pay to HELD_SALARY instead of NET_PAY", () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
      ['HELD_SALARY', { glCode: '2099', glName: 'Held salary' }],
    ]);
    const result = buildJournal(
      [payslip({ basePay: 40000, netPay: 40000, held: true })],
      config({ mappings }),
    );

    expect(result.lines.find((l) => l.glCode === '2002')).toBeUndefined();
    const held = result.lines.find((l) => l.glCode === '2099');
    expect(held?.credit).toBe(40000);
    expect(result.balanced).toBe(true);
  });

  it('reports unmapped keys and drops their lines when no suspense is configured', () => {
    const result = buildJournal(
      [payslip({ basePay: 50000, netPay: 50000 })],
      config({ mappings: new Map() }),
    );

    expect(result.unmappedKeys).toEqual(['BASIC', 'NET_PAY']);
    expect(result.lines).toEqual([]);
    expect(result.balanced).toBe(true); // 0 == 0, both sides dropped equally
  });

  it('posts unmapped keys to the suspense account only when allowUnmapped is true', () => {
    const suspense = { glCode: '9999', glName: 'Suspense' };

    const blocked = buildJournal(
      [payslip({ basePay: 50000, netPay: 50000 })],
      config({ suspense, allowUnmapped: false }),
    );
    expect(blocked.lines).toEqual([]);
    expect(blocked.unmappedKeys).toEqual(['BASIC', 'NET_PAY']);

    const allowed = buildJournal(
      [payslip({ basePay: 50000, netPay: 50000 })],
      config({ suspense, allowUnmapped: true }),
    );
    expect(allowed.unmappedKeys).toEqual(['BASIC', 'NET_PAY']);
    const suspenseLines = allowed.lines.filter((l) => l.glCode === '9999');
    expect(suspenseLines).toHaveLength(2);
    expect(allowed.balanced).toBe(true);
  });

  it('sets the cost centre by department, branch, or Unassigned per costCenterMode', () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const payslips = [
      payslip({ basePay: 10000, netPay: 10000, departmentName: 'Engineering', branchName: null }),
      payslip({ basePay: 10000, netPay: 10000, departmentName: null, branchName: null }),
    ];

    const byDept = buildJournal(payslips, config({ mappings, costCenterMode: 'DEPARTMENT' }));
    const centres = byDept.lines.map((l) => l.costCenter).sort();
    expect(centres).toEqual(['Engineering', 'Engineering', 'Unassigned', 'Unassigned']);

    const none = buildJournal(payslips, config({ mappings, costCenterMode: 'NONE' }));
    expect(none.lines.every((l) => l.costCenter === null)).toBe(true);
  });

  it('aggregates lines by (glCode, costCenter, side) across employees', () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({ basePay: 10000, netPay: 10000, departmentName: 'Engineering' }),
        payslip({ basePay: 20000, netPay: 20000, departmentName: 'Engineering' }),
      ],
      config({ mappings, costCenterMode: 'DEPARTMENT' }),
    );

    const basic = result.lines.find((l) => l.glCode === '4001');
    expect(basic?.debit).toBe(30000);
    expect(result.balanced).toBe(true);
  });

  it('keeps paisa-exact rounding across many small amounts', () => {
    const mappings = new Map([
      ['BASIC', { glCode: '4001', glName: 'Salaries' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const payslips = Array.from({ length: 3 }, () =>
      payslip({ basePay: new Decimal('333.33'), netPay: new Decimal('333.33') }),
    );
    const result = buildJournal(payslips, config({ mappings }));
    const basic = result.lines.find((l) => l.glCode === '4001');
    expect(basic?.debit).toBe(999.99);
    expect(result.balanced).toBe(true);
  });

  it('resolves a one-time payment by its own name before falling back to ONE_TIME_EARNING', () => {
    const mappings = new Map([
      ['Diwali bonus', { glCode: '4010', glName: 'Bonus' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          earnings: [{ name: 'Diwali bonus', amount: 5000, kind: 'ONE_TIME', refId: 'otp-1' }],
          netPay: 5000,
        }),
      ],
      config({ mappings }),
    );

    const bonus = result.lines.find((l) => l.glCode === '4010');
    expect(bonus?.debit).toBe(5000);
    expect(bonus?.componentKeys).toEqual(['Diwali bonus']);
  });

  it('falls back to ONE_TIME_EARNING when the payment name has no mapping', () => {
    const mappings = new Map([
      ['ONE_TIME_EARNING', { glCode: '4099', glName: 'Other earnings' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          earnings: [{ name: 'Spot award', amount: 2000, kind: 'ONE_TIME', refId: 'otp-2' }],
          netPay: 2000,
        }),
      ],
      config({ mappings }),
    );

    const fallback = result.lines.find((l) => l.glCode === '4099');
    expect(fallback?.debit).toBe(2000);
    expect(fallback?.componentKeys).toEqual(['ONE_TIME_EARNING']);
  });

  it('resolves arrears and arrears recovery to their fixed system keys, not by line name', () => {
    const mappings = new Map([
      ['ARREARS', { glCode: '4020', glName: 'Arrears' }],
      ['ARREARS_RECOVERY', { glCode: '2020', glName: 'Arrears recovery' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          earnings: [{ name: 'Arrears', amount: 3000, kind: 'ARREAR' }],
          deductions: [{ name: 'Arrears recovery', amount: 1000, kind: 'ARREAR' }],
          netPay: 2000,
        }),
      ],
      config({ mappings }),
    );

    expect(result.lines.find((l) => l.glCode === '4020')?.debit).toBe(3000);
    expect(result.lines.find((l) => l.glCode === '2020')?.credit).toBe(1000);
    expect(result.balanced).toBe(true);
  });

  it('pools loan deduction lines into LOAN_RECOVERY', () => {
    const mappings = new Map([
      ['LOAN_RECOVERY', { glCode: '2030', glName: 'Loan recovery' }],
      ['NET_PAY', { glCode: '2002', glName: 'Salaries payable' }],
    ]);
    const result = buildJournal(
      [
        payslip({
          deductions: [
            { name: 'Loan EMI', amount: 1500, kind: 'LOAN' },
            { name: 'Salary advance recovery', amount: 500, kind: 'LOAN' },
          ],
          netPay: 2000,
        }),
      ],
      config({ mappings }),
    );

    expect(result.lines.find((l) => l.glCode === '2030')?.credit).toBe(2000);
  });
});
