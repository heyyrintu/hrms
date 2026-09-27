import { classifyPayslipLine } from './payroll-lines.types';

describe('classifyPayslipLine', () => {
  it('keeps an explicit kind', () => {
    expect(classifyPayslipLine({ name: 'Bonus', kind: 'ONE_TIME' }, 'earning')).toBe('ONE_TIME');
  });

  it('reads a legacy earning as a component', () => {
    expect(classifyPayslipLine({ name: 'HRA' }, 'earning')).toBe('COMPONENT');
  });

  it('reads legacy statutory and loan deductions by name', () => {
    expect(classifyPayslipLine({ name: 'TDS' }, 'deduction')).toBe('STATUTORY');
    expect(classifyPayslipLine({ name: 'Provident Fund' }, 'deduction')).toBe('STATUTORY');
    expect(classifyPayslipLine({ name: 'Loan EMI' }, 'deduction')).toBe('LOAN');
    expect(classifyPayslipLine({ name: 'Canteen' }, 'deduction')).toBe('COMPONENT');
  });

  it('does not treat an earning named like a statutory line as statutory', () => {
    expect(classifyPayslipLine({ name: 'TDS' }, 'earning')).toBe('COMPONENT');
  });
});
