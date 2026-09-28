import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EngagementPollsPage from './page';
import { pollsApi } from '@/lib/api-polls';

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

jest.mock('@/lib/api-polls', () => ({
  pollsApi: {
    list: jest.fn(),
    create: jest.fn(),
    close: jest.fn(),
    remove: jest.fn(),
  },
}));

const closedPoll = {
  id: 'poll-1',
  question: 'Best snack?',
  status: 'CLOSED' as const,
  closesAt: null,
  createdAt: '2026-03-15T12:00:00Z',
  totalVotes: 4,
  options: [
    { id: 'opt-1', order: 0, label: 'Chips', voteCount: 3 },
    { id: 'opt-2', order: 1, label: 'Cookies', voteCount: 1 },
  ],
};

describe('EngagementPollsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pollsApi.list as jest.Mock).mockResolvedValue({
      data: { data: [closedPoll], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
    });
  });

  it('renders the poll list with counts', async () => {
    render(<EngagementPollsPage />);

    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());
    expect(screen.getByText('3 votes (75%)')).toBeInTheDocument();
    expect(screen.queryByText('Some votes are still being counted')).not.toBeInTheDocument();
  });

  it('says some votes are still being counted when votes are pending', async () => {
    (pollsApi.list as jest.Mock).mockResolvedValue({
      data: {
        data: [{ ...closedPoll, status: 'ACTIVE', pendingVotes: 2 }],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    });

    render(<EngagementPollsPage />);

    await waitFor(() =>
      expect(screen.getByText('Some votes are still being counted')).toBeInTheDocument(),
    );
  });

  it('creates a poll with the right DTO shape', async () => {
    (pollsApi.create as jest.Mock).mockResolvedValue({ data: { id: 'poll-2' } });

    render(<EngagementPollsPage />);
    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new poll/i }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Tea or coffee?' } });
    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Tea' } });
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));

    await waitFor(() => {
      expect(pollsApi.create).toHaveBeenCalledWith({
        question: 'Tea or coffee?',
        options: ['Tea', 'Coffee'],
        closesAt: undefined,
      });
    });
  });

  it('supports adding a third option', async () => {
    render(<EngagementPollsPage />);
    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new poll/i }));
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));

    expect(screen.getByLabelText('Option 3')).toBeInTheDocument();
  });

  it('closes an active poll', async () => {
    (pollsApi.list as jest.Mock).mockResolvedValue({
      data: { data: [{ ...closedPoll, status: 'ACTIVE' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
    });
    (pollsApi.close as jest.Mock).mockResolvedValue({ data: { success: true } });

    render(<EngagementPollsPage />);
    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(pollsApi.close).toHaveBeenCalledWith('poll-1');
    });
  });

  it('deletes a poll after confirming', async () => {
    (pollsApi.remove as jest.Mock).mockResolvedValue({ data: { success: true } });

    render(<EngagementPollsPage />);
    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/permanently deletes/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => {
      expect(pollsApi.remove).toHaveBeenCalledWith('poll-1');
    });
  });
});
