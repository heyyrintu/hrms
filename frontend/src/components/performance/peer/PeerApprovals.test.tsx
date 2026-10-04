import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PeerApprovals } from './PeerApprovals';
import { peerApi } from '@/lib/api-performance-peer';
import type { CycleQuestion } from '@/lib/api-performance-reviews';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api', () => ({ api: {}, employeesApi: { getAll: jest.fn() } }));
jest.mock('@/lib/api-performance-peer', () => ({
  peerApi: { listForReview: jest.fn(), add: jest.fn(), decide: jest.fn() },
}));

const mocked = peerApi as jest.Mocked<typeof peerApi>;
const person = (id: string, f: string) => ({ id, firstName: f, lastName: 'X' });
const questions: CycleQuestion[] = [
  { id: 'q1', text: 'Collaboration', type: 'RATING', audience: 'PEER', isRequired: true, sortOrder: 1 },
];
const props = { reviewId: 'r1', employeeId: 'emp', reviewerId: 'boss', maxPeers: 5, canEdit: true, questions };

describe('PeerApprovals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listForReview.mockResolvedValue({
      data: [
        { id: 'p1', status: 'NOMINATED', closed: false, peer: person('a', 'Alice'), nominatedBy: person('emp', 'Eve') },
        {
          id: 'p2', status: 'SUBMITTED', closed: false, peer: person('b', 'Bob'), submittedAt: '2026-03-01T12:00:00Z',
          overallComment: 'Solid colleague',
          answers: [{ cycleQuestionId: 'q1', audience: 'PEER', rating: 5, text: null }],
        },
        { id: 'p3', status: 'DECLINED', closed: false, peer: person('c', 'Cara') },
      ],
    } as never);
  });

  it('approves and rejects nominated peers', async () => {
    mocked.decide.mockResolvedValue({} as never);
    render(<PeerApprovals {...props} />);
    await screen.findByText('Alice X');
    fireEvent.click(screen.getByRole('button', { name: 'Approve Alice X' }));
    await waitFor(() => expect(mocked.decide).toHaveBeenCalledWith('r1', 'p1', true));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Alice X' }));
    await waitFor(() => expect(mocked.decide).toHaveBeenCalledWith('r1', 'p1', false));
  });

  it('shows named submitted feedback with answers', async () => {
    render(<PeerApprovals {...props} />);
    expect(await screen.findByText('Bob X')).toBeInTheDocument();
    expect(screen.getByText('Solid colleague')).toBeInTheDocument();
    expect(screen.getByText('Collaboration')).toBeInTheDocument();
    expect(screen.getByText('5 / 5')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
  });

  it('does not offer decisions when editing is off', async () => {
    render(<PeerApprovals {...props} canEdit={false} />);
    await screen.findByText('Alice X');
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('shows a load error with Retry instead of the empty state', async () => {
    mocked.listForReview.mockRejectedValueOnce(new Error('boom'));
    render(<PeerApprovals {...props} />);
    expect(await screen.findByText('Failed to load peers.')).toBeInTheDocument();
    expect(screen.queryByText('No peers nominated yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Alice X')).toBeInTheDocument();
  });
});
