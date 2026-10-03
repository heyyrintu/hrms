import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TeamReviewsPage from './page';
import { reviewsApi } from '@/lib/api-performance-reviews';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'mgr@test.com', role: 'MANAGER', tenantId: 't1', employee: { id: 'mgr1' } },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
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
  reviewsApi: { teamReviews: jest.fn(), get: jest.fn(), questions: jest.fn(), submitManager: jest.fn(), setPotential: jest.fn() },
}));
jest.mock('@/components/performance/peer/PeerApprovals', () => ({
  PeerApprovals: (p: { reviewId: string; canEdit: boolean }) => (
    <div data-testid="peer-approvals">approvals {p.reviewId} edit:{String(p.canEdit)}</div>
  ),
}));

const reviews = reviewsApi as jest.Mocked<typeof reviewsApi>;
const META = { total: 1, page: 1, limit: 20, totalPages: 1 };

const cycle = (over = {}) => ({
  id: 'c1', name: 'H1 2026', startDate: '2026-01-01', endDate: '2026-06-30', status: 'ACTIVE',
  peerFeedbackEnabled: false, maxPeers: 5, ...over,
});
const review = (over = {}) => ({
  id: 'r1', cycleId: 'c1', employeeId: 'emp1', reviewerId: 'mgr1', status: 'SELF_REVIEW', relation: 'REVIEWER',
  released: false, cycle: cycle(),
  employee: { id: 'emp1', employeeCode: 'E1', firstName: 'Ann', lastName: 'Lee', designation: { name: 'Engineer' }, department: { name: 'Eng' } },
  selfRating: 4, selfComments: 'Did well', selfSubmittedAt: '2026-03-01T12:00:00Z', ...over,
});
const questions = [
  { id: 'q1', text: 'Self question', type: 'TEXT', audience: 'SELF', isRequired: false, sortOrder: 1 },
  { id: 'q2', text: 'Delivery quality', type: 'TEXT', audience: 'MANAGER', isRequired: true, sortOrder: 2 },
];
const competencies = [
  { id: 'k1', name: 'Communication', expectedLevel: 3, managerRating: null, comment: null },
  { id: 'k2', name: 'Ownership', expectedLevel: 4, managerRating: null, comment: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  reviews.teamReviews.mockResolvedValue({ data: { data: [], meta: { ...META, total: 0, totalPages: 0 } } } as never);
  reviews.questions.mockResolvedValue({ data: questions } as never);
});

describe('TeamReviewsPage', () => {
  it('renders the Team Reviews heading', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText('Team Reviews')).toBeInTheDocument();
    });
  });

  it('renders the subtitle text', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Review your team members/)).toBeInTheDocument();
    });
  });

  it('renders the empty state when no team reviews exist', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText('No team reviews')).toBeInTheDocument();
    });
  });

  it('blocks manager submit until required answers and all competencies are rated', async () => {
    reviews.teamReviews.mockResolvedValue({ data: { data: [review()], meta: META } } as never);
    reviews.get.mockResolvedValue({ data: review({ competencyRatings: competencies, answers: [{ cycleQuestionId: 'q1', audience: 'SELF', rating: null, text: 'My self answer' }] }) } as never);
    reviews.submitManager.mockResolvedValue({ data: review() } as never);
    render(<TeamReviewsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Delivery quality')).toBeInTheDocument();
    expect(screen.getByText('My self answer')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit Manager Review' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Delivery quality/), { target: { value: 'Excellent' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Communication: 4' }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ownership: 5' }));
    expect(submit).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Potential: 2' }));
    fireEvent.click(submit);
    await waitFor(() => expect(reviews.submitManager).toHaveBeenCalledTimes(1));
    expect(reviews.submitManager).toHaveBeenCalledWith('r1', {
      managerRating: 3,
      managerComments: undefined,
      overallRating: 3,
      potentialRating: 2,
      answers: [{ cycleQuestionId: 'q2', text: 'Excellent' }],
      competencyRatings: [{ id: 'k1', rating: 4 }, { id: 'k2', rating: 5 }],
    });
  });

  it('shows calibration info and a potential editor while the cycle is active', async () => {
    const r = review({
      status: 'MANAGER_REVIEW', overallRating: 3, calibratedRating: 4, calibrationReason: 'Peer norm',
      potentialRating: 1, cycle: cycle({ peerFeedbackEnabled: true }),
    });
    reviews.teamReviews.mockResolvedValue({ data: { data: [r], meta: META } } as never);
    reviews.get.mockResolvedValue({ data: r } as never);
    reviews.setPotential.mockResolvedValue({ data: r } as never);
    render(<TeamReviewsPage />);
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByText('Calibrated from 3 to 4: Peer norm')).toBeInTheDocument();
    expect(screen.getByTestId('peer-approvals')).toHaveTextContent('edit:true');
    fireEvent.click(screen.getByRole('button', { name: 'Potential: 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save potential' }));
    await waitFor(() => expect(reviews.setPotential).toHaveBeenCalledWith('r1', 3));
  });

  it('has no potential editor once the cycle is completed', async () => {
    const r = review({
      status: 'COMPLETED', overallRating: 3, potentialRating: 2, cycle: cycle({ status: 'COMPLETED', peerFeedbackEnabled: true }),
    });
    reviews.teamReviews.mockResolvedValue({ data: { data: [r], meta: META } } as never);
    reviews.get.mockResolvedValue({ data: r } as never);
    render(<TeamReviewsPage />);
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByTestId('peer-approvals')).toHaveTextContent('edit:false');
    expect(screen.queryByRole('button', { name: 'Save potential' })).not.toBeInTheDocument();
    expect(screen.getByText('Potential: 2 / 3')).toBeInTheDocument();
  });

  it('offers no manager actions on the viewer own review', async () => {
    const r = review({ relation: 'SELF', employeeId: 'mgr1' });
    reviews.teamReviews.mockResolvedValue({ data: { data: [r], meta: META } } as never);
    render(<TeamReviewsPage />);
    await screen.findByText('Ann Lee');
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });
});
