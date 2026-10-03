import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FeedbackRequestsPage from './page';
import { peerApi } from '@/lib/api-performance-peer';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', role: 'EMPLOYEE', employee: { id: 'e1' } },
    isAuthenticated: true,
    isLoading: false,
    hasRole: jest.fn().mockReturnValue(false),
  }),
}));

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
}));
jest.mock('@/lib/api-performance-peer', () => ({
  peerApi: { myRequests: jest.fn(), submit: jest.fn(), decline: jest.fn() },
}));

const api = peerApi as jest.Mocked<typeof peerApi>;

const questions = [
  { id: 'q1', text: 'Collaboration', type: 'RATING', audience: 'PEER', isRequired: true, sortOrder: 1 },
  { id: 'q2', text: 'Strengths', type: 'TEXT', audience: 'PEER', isRequired: false, sortOrder: 2 },
  { id: 'q3', text: 'Not for peers', type: 'TEXT', audience: 'MANAGER', isRequired: true, sortOrder: 3 },
];
const req = (over = {}) => ({
  id: 'pr1', status: 'APPROVED', closed: false, reviewee: { id: 'x', firstName: 'Ann', lastName: 'Lee' },
  cycle: { id: 'c1', name: 'H1 2026' }, questions, answers: [], overallComment: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  api.myRequests.mockResolvedValue({
    data: [
      req(),
      req({ id: 'pr2', reviewee: { id: 'y', firstName: 'Bob', lastName: 'Ray' }, status: 'SUBMITTED',
        answers: [{ cycleQuestionId: 'q1', audience: 'PEER', rating: 4, text: null }], overallComment: 'Good' }),
      req({ id: 'pr3', reviewee: { id: 'z', firstName: 'Cy', lastName: 'Fox' }, status: 'DECLINED' }),
      req({ id: 'pr4', reviewee: { id: 'w', firstName: 'Di', lastName: 'Poe' }, status: 'APPROVED', closed: true }),
    ],
  } as never);
});

describe('FeedbackRequestsPage', () => {
  it('groups requests into Open, Submitted and Closed or declined', async () => {
    render(<FeedbackRequestsPage />);
    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
    const open = screen.getByTestId('group-open');
    const submitted = screen.getByTestId('group-submitted');
    const closed = screen.getByTestId('group-closed');
    expect(open).toHaveTextContent('Ann Lee');
    expect(open).not.toHaveTextContent('Bob Ray');
    expect(submitted).toHaveTextContent('Bob Ray');
    expect(closed).toHaveTextContent('Cy Fox');
    expect(closed).toHaveTextContent('Di Poe');
  });

  it('shows an empty state when there are no requests', async () => {
    api.myRequests.mockResolvedValue({ data: [] } as never);
    render(<FeedbackRequestsPage />);
    expect(await screen.findByText('No feedback requests')).toBeInTheDocument();
  });

  it('submits PEER answers and an overall comment only when complete', async () => {
    api.submit.mockResolvedValue({ data: req({ status: 'SUBMITTED' }) } as never);
    render(<FeedbackRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Give feedback for Ann Lee' }));
    expect(await screen.findByText('Collaboration')).toBeInTheDocument();
    expect(screen.queryByText('Not for peers')).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Submit feedback' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Collaboration: 5' }));
    expect(submit).toBeDisabled(); // overall comment required
    fireEvent.change(screen.getByLabelText('Overall comment'), { target: { value: 'Great teammate' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith('pr1', {
        answers: [{ cycleQuestionId: 'q1', rating: 5 }],
        overallComment: 'Great teammate',
      }),
    );
  });

  it('declines only after confirmation', async () => {
    api.decline.mockResolvedValue({ data: req({ status: 'DECLINED' }) } as never);
    render(<FeedbackRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Give feedback for Ann Lee' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(api.decline).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decline' }));
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith('pr1'));
  });

  it('shows submitted answers read-only', async () => {
    render(<FeedbackRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View feedback for Bob Ray' }));
    expect(await screen.findByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit feedback' })).not.toBeInTheDocument();
  });

  it('shows a load error with Retry instead of the empty state', async () => {
    api.myRequests.mockRejectedValueOnce(new Error('boom'));
    render(<FeedbackRequestsPage />);
    expect(await screen.findByText('Failed to load feedback requests.')).toBeInTheDocument();
    expect(screen.queryByText('No feedback requests')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
  });

  it('sends trimmed text and omits whitespace-only answers on submit', async () => {
    api.submit.mockResolvedValue({ data: req({ status: 'SUBMITTED' }) } as never);
    render(<FeedbackRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Give feedback for Ann Lee' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Collaboration: 3' }));
    fireEvent.change(screen.getByLabelText('Strengths'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Overall comment'), { target: { value: ' Nice ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith('pr1', { answers: [{ cycleQuestionId: 'q1', rating: 3 }], overallComment: 'Nice' }),
    );
  });
});
