import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PerformancePage from './page';
import { reviewsApi } from '@/lib/api-performance-reviews';
import { goalsApi } from '@/lib/api-performance-goals';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext (real stored-user shape: employee id is nested)
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'emp@test.com', role: 'EMPLOYEE', tenantId: 't1', employee: { id: 'emp1' } },
    isAuthenticated: true,
    isLoading: false,
    isManager: false,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(false),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-performance-reviews', () => ({
  reviewsApi: { myReviews: jest.fn(), get: jest.fn(), questions: jest.fn(), submitSelf: jest.fn() },
}));
jest.mock('@/lib/api-performance-goals', () => ({ goalsApi: { list: jest.fn() } }));
jest.mock('@/components/performance/peer/PeerNominations', () => ({
  PeerNominations: (p: { reviewId: string }) => <div data-testid="peer-nominations">peers for {p.reviewId}</div>,
}));

const reviews = reviewsApi as jest.Mocked<typeof reviewsApi>;
const goals = goalsApi as jest.Mocked<typeof goalsApi>;

const cycle = (over = {}) => ({
  id: 'c1', name: 'H1 2026', startDate: '2026-01-01', endDate: '2026-06-30', status: 'ACTIVE',
  peerFeedbackEnabled: false, maxPeers: 5, ...over,
});
const review = (over = {}) => ({
  id: 'r1', cycleId: 'c1', employeeId: 'emp1', reviewerId: 'mgr1', status: 'PENDING', relation: 'SELF',
  released: false, cycle: cycle(), reviewer: { id: 'mgr1', firstName: 'Mia', lastName: 'Boss' },
  selfRating: null, selfComments: null, selfSubmittedAt: null, ...over,
});
const questions = [
  { id: 'q1', text: 'Key achievement', type: 'TEXT', audience: 'SELF', isRequired: true, sortOrder: 1 },
  { id: 'q2', text: 'Manager only question', type: 'TEXT', audience: 'MANAGER', isRequired: true, sortOrder: 2 },
];

beforeEach(() => {
  jest.clearAllMocks();
  reviews.myReviews.mockResolvedValue({ data: { data: [], meta: {} } } as never);
  reviews.questions.mockResolvedValue({ data: questions } as never);
  goals.list.mockResolvedValue({ data: [] } as never);
});

describe('PerformancePage', () => {
  it('renders the My Performance heading', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('My Performance')).toBeInTheDocument();
    });
  });

  it('renders the Reviews and Goals tabs', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('My Reviews')).toBeInTheDocument();
      expect(screen.getByText('My Goals')).toBeInTheDocument();
    });
  });

  it('renders the empty reviews state', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    });
  });

  it('blocks self-review submit until required answers are given, then submits answers', async () => {
    reviews.myReviews.mockResolvedValue({ data: { data: [review()], meta: {} } } as never);
    reviews.get.mockResolvedValue({ data: review() } as never);
    reviews.submitSelf.mockResolvedValue({ data: review({ status: 'SELF_REVIEW' }) } as never);
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Self Review' }));
    expect(await screen.findByText('Key achievement')).toBeInTheDocument();
    expect(screen.queryByText('Manager only question')).not.toBeInTheDocument();

    const submit = screen.getAllByRole('button', { name: 'Submit Self Review' }).pop() as HTMLElement;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Key achievement/), { target: { value: 'Shipped v2' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(reviews.submitSelf).toHaveBeenCalledTimes(1));
    expect(reviews.submitSelf).toHaveBeenCalledWith('r1', {
      selfRating: 3,
      selfComments: undefined,
      answers: [{ cycleQuestionId: 'q1', text: 'Shipped v2' }],
    });
  });

  it('shows awaiting-release and no rating for a submitted, unreleased review', async () => {
    const r = review({ status: 'COMPLETED', selfRating: 4, selfSubmittedAt: '2026-03-01T12:00:00Z' });
    reviews.myReviews.mockResolvedValue({ data: { data: [r], meta: {} } } as never);
    // Defensive: even if a rating leaked into the payload it must not render.
    reviews.get.mockResolvedValue({ data: { ...r, finalRating: 5, overallRating: 5 } } as never);
    render(<PerformancePage />);
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByText(/Submitted/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting release/)).toBeInTheDocument();
    expect(screen.queryByTestId('final-rating')).not.toBeInTheDocument();
    expect(screen.queryByText('Final rating')).not.toBeInTheDocument();
  });

  it('shows released results with the final rating', async () => {
    const r = review({
      status: 'COMPLETED', released: true, selfRating: 4, selfSubmittedAt: '2026-03-01T12:00:00Z',
      cycle: cycle({ status: 'COMPLETED' }),
    });
    reviews.myReviews.mockResolvedValue({ data: { data: [r], meta: {} } } as never);
    reviews.get.mockResolvedValue({ data: { ...r, finalRating: 4, managerComments: 'Great work' } } as never);
    render(<PerformancePage />);
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByTestId('final-rating')).toHaveTextContent('4 / 5');
    expect(screen.getByText('Great work')).toBeInTheDocument();
  });

  it('shows peer nominations when the cycle enables peer feedback', async () => {
    const r = review({ status: 'SELF_REVIEW', selfRating: 4, cycle: cycle({ peerFeedbackEnabled: true }) });
    reviews.myReviews.mockResolvedValue({ data: { data: [r], meta: {} } } as never);
    reviews.get.mockResolvedValue({ data: r } as never);
    render(<PerformancePage />);
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByTestId('peer-nominations')).toBeInTheDocument();
  });

  it('goals tab links to /performance/goals and shows key-result progress', async () => {
    goals.list.mockResolvedValue({
      data: [{
        id: 'g1', ownerType: 'EMPLOYEE', title: 'Grow revenue', description: null, targetDate: '2026-12-31',
        status: 'IN_PROGRESS', progress: 40, weight: 1, shareOnFeed: false, completedAt: null, reviewId: null,
        parentGoalId: null, employeeId: 'emp1', departmentId: null, isDerived: true, canEdit: true,
        keyResults: [{ id: 'k1', goalId: 'g1', title: 'Close 10 deals', metricType: 'NUMBER', startValue: 0,
          targetValue: 10, currentValue: 4, unit: null, weight: 1, progress: 40, sortOrder: 0 }],
      }],
    } as never);
    render(<PerformancePage />);
    fireEvent.click(await screen.findByText('My Goals'));
    expect(await screen.findByText('Grow revenue')).toBeInTheDocument();
    expect(screen.getByText('Close 10 deals')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manage goals/ })).toHaveAttribute('href', '/performance/goals');
    expect(goals.list).toHaveBeenCalledWith({ scope: 'mine' });
  });
});
