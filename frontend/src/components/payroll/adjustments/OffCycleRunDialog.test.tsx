import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';

import { OffCycleRunDialog } from './OffCycleRunDialog';

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

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return { ...actual, payrollDepthApi: { createOffCycleRun: jest.fn() } };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { employeesApi } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

const employees = [
  { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' },
  { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Shah' },
];

describe('OffCycleRunDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    employeesApi.getAll.mockResolvedValue({ data: { data: employees } });
    payrollDepthApi.createOffCycleRun.mockResolvedValue({ data: { id: 'run-9' } });
  });

  it('does not load employees while closed', () => {
    render(<OffCycleRunDialog isOpen={false} onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(employeesApi.getAll).not.toHaveBeenCalled();
  });

  it('creates an off-cycle run with the chosen employees, reason and salary toggle', async () => {
    const onCreated = jest.fn();
    render(<OffCycleRunDialog isOpen onClose={jest.fn()} onCreated={onCreated} />);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: String(new Date().getFullYear()) } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Missed joiner  ' } });
    fireEvent.click(screen.getByLabelText('Include the full month salary'));
    fireEvent.click(screen.getByLabelText('Asha Rao (EMP001)'));

    fireEvent.click(screen.getByRole('button', { name: 'Create off-cycle run' }));

    await waitFor(() =>
      expect(payrollDepthApi.createOffCycleRun).toHaveBeenCalledWith({
        month: 3,
        year: new Date().getFullYear(),
        reason: 'Missed joiner',
        includeSalary: true,
        employeeIds: ['e1'],
      }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });

  it('filters employees by the search text', async () => {
    render(<OffCycleRunDialog isOpen onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'emp002' } });
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    expect(screen.getByText('Vikram Shah')).toBeInTheDocument();
  });

  it('requires a reason and at least one employee', async () => {
    render(<OffCycleRunDialog isOpen onClose={jest.fn()} onCreated={jest.fn()} />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByRole('button', { name: 'Create off-cycle run' }));
    expect(await screen.findByText('Give a reason for this run')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Bonus payout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create off-cycle run' }));
    expect(await screen.findByText('Choose at least one employee')).toBeInTheDocument();
    expect(payrollDepthApi.createOffCycleRun).not.toHaveBeenCalled();
  });

  it('surfaces the backend message when creation fails', async () => {
    payrollDepthApi.createOffCycleRun.mockRejectedValue({
      response: { data: { message: 'EMP001 already has a payslip in March 2026' } },
    });
    render(<OffCycleRunDialog isOpen onClose={jest.fn()} onCreated={jest.fn()} />);
    await screen.findByText('Asha Rao');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Bonus payout' } });
    fireEvent.click(screen.getByLabelText('Asha Rao (EMP001)'));
    fireEvent.click(screen.getByRole('button', { name: 'Create off-cycle run' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('EMP001 already has a payslip in March 2026'),
    );
  });
});
