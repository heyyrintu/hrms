import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PollWidget } from './PollWidget';
import { pollsApi } from '@/lib/api-polls';

jest.mock('@/lib/api-polls', () => ({
  pollsApi: {
    active: jest.fn(),
    vote: jest.fn(),
  },
}));

const openPoll = {
  id: 'poll-1',
  question: 'Best snack?',
  status: 'ACTIVE' as const,
  closesAt: null,
  createdAt: '2026-03-15T12:00:00Z',
  hasVoted: false,
  totalVotes: null,
  options: [
    { id: 'opt-1', order: 0, label: 'Chips', voteCount: null },
    { id: 'opt-2', order: 1, label: 'Cookies', voteCount: null },
  ],
};

describe('PollWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when there are no active polls', async () => {
    (pollsApi.active as jest.Mock).mockResolvedValue({ data: [] });

    const { container } = render(<PollWidget />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders up to 3 active polls with a radio + Vote before voting', async () => {
    (pollsApi.active as jest.Mock).mockResolvedValue({ data: [openPoll] });

    render(<PollWidget />);

    await waitFor(() => {
      expect(screen.getByText('Best snack?')).toBeInTheDocument();
    });
    expect(screen.getByText('Chips')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote' })).toBeDisabled();
  });

  it('votes and then shows percentage bars', async () => {
    (pollsApi.active as jest.Mock)
      .mockResolvedValueOnce({ data: [openPoll] })
      .mockResolvedValueOnce({
        data: [
          {
            ...openPoll,
            hasVoted: true,
            totalVotes: 4,
            options: [
              { id: 'opt-1', order: 0, label: 'Chips', voteCount: 3 },
              { id: 'opt-2', order: 1, label: 'Cookies', voteCount: 1 },
            ],
          },
        ],
      });
    (pollsApi.vote as jest.Mock).mockResolvedValue({ data: { success: true } });

    render(<PollWidget />);

    await waitFor(() => expect(screen.getByText('Best snack?')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Chips'));
    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));

    await waitFor(() => {
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
    expect(pollsApi.vote).toHaveBeenCalledWith('poll-1', 'opt-1');
    expect(screen.queryByRole('button', { name: 'Vote' })).not.toBeInTheDocument();
    expect(screen.queryByText('Some votes are still being counted')).not.toBeInTheDocument();
  });

  it('says some votes are still being counted when votes are pending', async () => {
    (pollsApi.active as jest.Mock).mockResolvedValue({
      data: [
        {
          ...openPoll,
          hasVoted: true,
          totalVotes: 3,
          pendingVotes: 1,
          options: [
            { id: 'opt-1', order: 0, label: 'Chips', voteCount: 2 },
            { id: 'opt-2', order: 1, label: 'Cookies', voteCount: 1 },
          ],
        },
      ],
    });

    render(<PollWidget />);

    await waitFor(() =>
      expect(screen.getByText('Some votes are still being counted')).toBeInTheDocument(),
    );
  });
});
