import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import WorkflowBuilderPage from './page';

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

jest.mock('@/lib/api-workflow', () => {
  const actual = jest.requireActual('@/lib/api-workflow');
  return {
    ...actual,
    workflowApi: {
      listDefinitions: jest.fn(),
      saveDefinition: jest.fn(),
      resetDefinition: jest.fn(),
      searchUsers: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { workflowApi } = require('@/lib/api-workflow');

const managerStep = {
  order: 1,
  name: 'Reporting manager',
  approverType: 'REPORTING_MANAGER',
  approverUserId: null,
  approverUserName: null,
  approverRole: null,
  minAmount: null,
  minDays: null,
};

const hrStep = { ...managerStep, name: 'HR admin', approverType: 'HR_ADMIN' };

const view = (entityType: string, overrides: Record<string, unknown> = {}) => ({
  entityType,
  isCustom: false,
  name: `${entityType} approval`,
  adminOverride: true,
  allowSelfApproval: true,
  steps: [['LOAN', 'PAYROLL_RUN'].includes(entityType) ? hrStep : managerStep],
  ...overrides,
});

const definitions = [
  view('LEAVE'),
  view('EXPENSE', {
    isCustom: true,
    steps: [
      managerStep,
      {
        order: 2,
        name: 'Finance',
        approverType: 'SPECIFIC_USER',
        approverUserId: 'u-fin',
        approverUserName: 'Farah Khan',
        approverRole: null,
        minAmount: 10000,
        minDays: null,
      },
    ],
  }),
  view('LOAN'),
  view('COMP_OFF'),
  view('REGULARIZATION'),
  view('PAYROLL_RUN', { allowSelfApproval: false }),
];

async function renderLoaded() {
  render(<WorkflowBuilderPage />);
  await screen.findByLabelText('Step 1 name');
}

describe('WorkflowBuilderPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workflowApi.listDefinitions.mockResolvedValue({ data: definitions });
    workflowApi.saveDefinition.mockImplementation((type: string, body: any) =>
      Promise.resolve({
        data: {
          entityType: type,
          isCustom: true,
          name: body.name,
          adminOverride: body.adminOverride,
          allowSelfApproval: body.allowSelfApproval,
          steps: body.steps.map((s: any, i: number) => ({
            order: i + 1,
            approverUserName: null,
            ...s,
          })),
        },
      }),
    );
    workflowApi.resetDefinition.mockResolvedValue({ data: view('EXPENSE') });
    workflowApi.searchUsers.mockResolvedValue({ data: [] });
  });

  it('shows six entity tabs and marks the built-in chain as Default', async () => {
    await renderLoaded();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Leave',
      'Expense',
      'Loan',
      'Comp-Off',
      'Regularization',
      'Payroll Run',
    ]);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset to default/ })).toBeDisabled();
  });

  it('shows a custom chain with its specific user and amount condition', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('tab', { name: /Expense/ }));

    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 2 name')).toHaveValue('Finance');
    expect(screen.getByText('Farah Khan')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 2 only when amount is at least')).toHaveValue(10000);
    expect(
      screen.queryByLabelText('Step 1 only when amount is at least'),
    ).not.toBeInTheDocument();
  });

  it('adds a step and saves the full chain with PUT', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    fireEvent.change(screen.getByLabelText('Step 2 name'), { target: { value: 'HR review' } });
    fireEvent.change(screen.getByLabelText('Step 2 approver'), { target: { value: 'ROLE' } });
    fireEvent.change(screen.getByLabelText('Step 2 role'), { target: { value: 'HR_ADMIN' } });
    fireEvent.change(screen.getByLabelText('Step 2 only when days are at least'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByLabelText('Allow the requester to approve their own request'));
    fireEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    await waitFor(() =>
      expect(workflowApi.saveDefinition).toHaveBeenCalledWith('LEAVE', {
        name: 'LEAVE approval',
        adminOverride: true,
        allowSelfApproval: false,
        steps: [
          {
            name: 'Reporting manager',
            approverType: 'REPORTING_MANAGER',
            approverUserId: null,
            approverRole: null,
            minAmount: null,
            minDays: null,
          },
          {
            name: 'HR review',
            approverType: 'ROLE',
            approverUserId: null,
            approverRole: 'HR_ADMIN',
            minAmount: null,
            minDays: 5,
          },
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Leave workflow saved');
    expect(await screen.findByText('Custom')).toBeInTheDocument();
  });

  it('shows amount conditions for payroll runs and none for regularization', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('tab', { name: /Payroll Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    expect(screen.getByLabelText('Step 2 only when amount is at least')).toBeInTheDocument();
    expect(screen.queryByLabelText('Step 2 only when days are at least')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Regularization/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    expect(screen.queryByLabelText(/only when/)).not.toBeInTheDocument();
  });

  it('picks a specific user through the user search', async () => {
    workflowApi.searchUsers.mockResolvedValue({
      data: [{ id: 'u-7', name: 'Ravi Nair', email: 'ravi@acme.test', role: 'MANAGER' }],
    });
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Step 1 approver'), {
      target: { value: 'SPECIFIC_USER' },
    });
    fireEvent.change(screen.getByLabelText('Step 1 user'), { target: { value: 'ravi' } });
    fireEvent.click(await screen.findByText('Ravi Nair'));
    fireEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    expect(workflowApi.searchUsers).toHaveBeenCalledWith('ravi');
    await waitFor(() => expect(workflowApi.saveDefinition).toHaveBeenCalled());
    const [, body] = workflowApi.saveDefinition.mock.calls[0];
    expect(body.steps[0]).toEqual(
      expect.objectContaining({ approverType: 'SPECIFIC_USER', approverUserId: 'u-7' }),
    );
  });

  it('refuses to save a specific-user step with no user picked', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Step 1 approver'), {
      target: { value: 'SPECIFIC_USER' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    expect(toast.error).toHaveBeenCalledWith('Step 1: pick the user who approves');
    expect(workflowApi.saveDefinition).not.toHaveBeenCalled();
  });

  it('moves and removes steps, dropping a condition that lands on step 1', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('tab', { name: /Expense/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(screen.getByLabelText('Step 1 name')).toHaveValue('Finance');
    expect(
      screen.queryByLabelText('Step 1 only when amount is at least'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    fireEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    await waitFor(() => expect(workflowApi.saveDefinition).toHaveBeenCalled());
    const [type, body] = workflowApi.saveDefinition.mock.calls[0];
    expect(type).toBe('EXPENSE');
    expect(body.steps).toEqual([
      {
        name: 'Finance',
        approverType: 'SPECIFIC_USER',
        approverUserId: 'u-fin',
        approverRole: null,
        minAmount: null,
        minDays: null,
      },
    ]);
  });

  it('resets a custom chain to the default after confirming', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await renderLoaded();
    fireEvent.click(screen.getByRole('tab', { name: /Expense/ }));

    fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }));

    await waitFor(() => expect(workflowApi.resetDefinition).toHaveBeenCalledWith('EXPENSE'));
    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.queryByLabelText('Step 2 name')).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('does not reset when the confirm is dismissed', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await renderLoaded();
    fireEvent.click(screen.getByRole('tab', { name: /Expense/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }));

    expect(workflowApi.resetDefinition).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('caps a chain at ten steps', async () => {
    await renderLoaded();
    const add = screen.getByRole('button', { name: /Add step/ });
    for (let i = 0; i < 9; i++) fireEvent.click(add);

    expect(within(document.body).getByLabelText('Step 10 name')).toBeInTheDocument();
    expect(add).toBeDisabled();
  });
});
