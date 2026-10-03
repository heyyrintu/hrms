import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PeerNominations } from './PeerNominations';
import { peerApi } from '@/lib/api-performance-peer';
import { employeesApi } from '@/lib/api';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api', () => ({ api: {}, employeesApi: { getAll: jest.fn() } }));
jest.mock('@/lib/api-performance-peer', () => ({
  peerApi: { listForReview: jest.fn(), add: jest.fn(), withdraw: jest.fn() },
}));

const mocked = peerApi as jest.Mocked<typeof peerApi>;
const emp = employeesApi as jest.Mocked<typeof employeesApi>;
const person = (id: string, f: string) => ({ id, firstName: f, lastName: 'X' });

const props = { reviewId: 'r1', employeeId: 'me', reviewerId: 'boss', maxPeers: 3, canEdit: true };

describe('PeerNominations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listForReview.mockResolvedValue({
      data: [
        { id: 'p1', status: 'NOMINATED', closed: false, peer: person('a', 'Alice') },
        { id: 'p2', status: 'APPROVED', closed: false, peer: person('b', 'Bob') },
        { id: 'p3', status: 'REJECTED', closed: false, peer: person('c', 'Cara') },
      ],
    } as never);
  });

  it('lists nominations with status chips and remaining slots', async () => {
    render(<PeerNominations {...props} />);
    expect(await screen.findByText('Alice X')).toBeInTheDocument();
    expect(screen.getByText('Nominated')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 slots remaining')).toBeInTheDocument();
  });

  it('withdraws only NOMINATED peers', async () => {
    mocked.withdraw.mockResolvedValue({} as never);
    render(<PeerNominations {...props} />);
    await screen.findByText('Alice X');
    expect(screen.getAllByRole('button', { name: /Withdraw/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Alice X' }));
    await waitFor(() => expect(mocked.withdraw).toHaveBeenCalledWith('r1', 'p1'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('searches employees, excluding self, reviewer and existing peers, and adds one', async () => {
    emp.getAll.mockResolvedValue({
      data: { data: [person('me', 'Me'), person('boss', 'Boss'), person('a', 'Alice'), person('z', 'Zed')] },
    } as never);
    mocked.add.mockResolvedValue({} as never);
    render(<PeerNominations {...props} />);
    await screen.findByText('Alice X');
    fireEvent.change(screen.getByPlaceholderText('Search colleagues'), { target: { value: 'ze' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Zed X')).toBeInTheDocument();
    expect(screen.queryByText('Me X')).not.toBeInTheDocument();
    expect(screen.queryByText('Boss X')).not.toBeInTheDocument();
    expect(screen.getAllByText('Alice X')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Nominate Zed X' }));
    await waitFor(() => expect(mocked.add).toHaveBeenCalledWith('r1', 'z'));
  });

  it('hides the add box when no slots remain or editing is off', async () => {
    mocked.listForReview.mockResolvedValue({
      data: [1, 2, 3].map((n) => ({ id: `p${n}`, status: 'APPROVED', closed: false, peer: person(`id${n}`, `P${n}`) })),
    } as never);
    const { rerender } = render(<PeerNominations {...props} />);
    await screen.findByText('P1 X');
    expect(screen.queryByPlaceholderText('Search colleagues')).not.toBeInTheDocument();
    mocked.listForReview.mockResolvedValue({ data: [] } as never);
    rerender(<PeerNominations {...props} canEdit={false} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Search colleagues')).not.toBeInTheDocument());
  });
});
