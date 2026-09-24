import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import DelegationsPage from './page';

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

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-me', role: 'MANAGER' } }),
}));

jest.mock('@/lib/api-workflow', () => {
  const actual = jest.requireActual('@/lib/api-workflow');
  return {
    ...actual,
    workflowApi: {
      getDelegations: jest.fn(),
      createDelegation: jest.fn(),
      cancelDelegation: jest.fn(),
      searchUsers: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { workflowApi } = require('@/lib/api-workflow');

const me = { userId: 'u-me', name: 'Me Myself' };

const given = {
  id: 'd-1',
  delegator: me,
  delegate: { userId: 'u-2', name: 'Priya Das' },
  entityType: 'EXPENSE',
  startDate: '2099-01-10',
  endDate: '2099-01-20',
  reason: 'Conference',
  isActive: true,
  isCurrent: false,
};

const received = {
  id: 'd-2',
  delegator: { userId: 'u-3', name: 'Karan Mehta' },
  delegate: me,
  entityType: null,
  startDate: '2000-01-01',
  endDate: '2099-12-31',
  reason: null,
  isActive: true,
  isCurrent: true,
};

describe('DelegationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workflowApi.getDelegations.mockResolvedValue({ data: { given: [given], received: [received] } });
    workflowApi.createDelegation.mockResolvedValue({ data: {} });
    workflowApi.cancelDelegation.mockResolvedValue({ data: {} });
    workflowApi.searchUsers.mockResolvedValue({
      data: [
        { id: 'u-me', name: 'Me Myself', email: 'me@acme.test', role: 'MANAGER' },
        { id: 'u-5', name: 'Sunita Rao', email: 'sunita@acme.test', role: 'MANAGER' },
      ],
    });
  });

  it('lists what I delegated and what was delegated to me', async () => {
    render(<DelegationsPage />);

    const mine = await screen.findByTestId('delegation-d-1');
    expect(within(mine).getByText('Priya Das')).toBeInTheDocument();
    expect(within(mine).getByText('Upcoming')).toBeInTheDocument();
    expect(within(mine).getByText('Expense')).toBeInTheDocument();
    expect(within(mine).getByText('Conference')).toBeInTheDocument();

    const theirs = screen.getByTestId('delegation-d-2');
    expect(within(theirs).getByText('Karan Mehta')).toBeInTheDocument();
    expect(within(theirs).getByText('Active now')).toBeInTheDocument();
    expect(within(theirs).getByText('All types')).toBeInTheDocument();
    // Only the delegator can cancel.
    expect(within(theirs).queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('creates a delegation from the form', async () => {
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');

    fireEvent.change(screen.getByLabelText('Delegate to'), { target: { value: 'su' } });
    fireEvent.click(await screen.findByText('Sunita Rao'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-03-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2099-03-07' } });
    fireEvent.change(screen.getByLabelText('Request type'), { target: { value: 'LEAVE' } });
    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: ' Annual leave ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create delegation/ }));

    await waitFor(() =>
      expect(workflowApi.createDelegation).toHaveBeenCalledWith({
        delegateUserId: 'u-5',
        startDate: '2099-03-01',
        endDate: '2099-03-07',
        entityType: 'LEAVE',
        reason: 'Annual leave',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Delegated to Sunita Rao');
    await waitFor(() => expect(workflowApi.getDelegations).toHaveBeenCalledTimes(2));
  });

  it('leaves out the type and reason when they are not set', async () => {
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');

    fireEvent.change(screen.getByLabelText('Delegate to'), { target: { value: 'su' } });
    fireEvent.click(await screen.findByText('Sunita Rao'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-03-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2099-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Create delegation/ }));

    await waitFor(() =>
      expect(workflowApi.createDelegation).toHaveBeenCalledWith({
        delegateUserId: 'u-5',
        startDate: '2099-03-01',
        endDate: '2099-03-01',
      }),
    );
  });

  it('does not offer yourself as a delegate', async () => {
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');

    fireEvent.change(screen.getByLabelText('Delegate to'), { target: { value: 'm' } });
    await screen.findByText('Sunita Rao');
    const results = screen.getByRole('listbox', { name: 'Delegate to results' });
    expect(within(results).queryByText('Me Myself')).not.toBeInTheDocument();
  });

  it('refuses an end date before the start date', async () => {
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');

    fireEvent.change(screen.getByLabelText('Delegate to'), { target: { value: 'su' } });
    fireEvent.click(await screen.findByText('Sunita Rao'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-03-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2099-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Create delegation/ }));

    expect(toast.error).toHaveBeenCalledWith('End date cannot be before the start date');
    expect(workflowApi.createDelegation).not.toHaveBeenCalled();
  });

  it('requires a delegate', async () => {
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');
    fireEvent.click(screen.getByRole('button', { name: /Create delegation/ }));
    expect(toast.error).toHaveBeenCalledWith('Pick who should approve for you');
  });

  it('cancels one of my delegations after confirming', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DelegationsPage />);
    await screen.findByTestId('delegation-d-1');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel delegation to Priya Das' }));

    await waitFor(() => expect(workflowApi.cancelDelegation).toHaveBeenCalledWith('d-1'));
    expect(toast.success).toHaveBeenCalledWith('Delegation cancelled');
    confirmSpy.mockRestore();
  });
});
