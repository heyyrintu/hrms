import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MyInterviewsPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';

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

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockHasRole = jest.fn();
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', employeeId: 'emp-p1' }, hasRole: mockHasRole }),
}));

jest.mock('@/lib/api-recruitment', () => {
  const actual = jest.requireActual('@/lib/api-recruitment');
  return {
    ...actual,
    recruitmentApi: { myInterviews: jest.fn(), getFeedback: jest.fn(), submitFeedback: jest.fn() },
  };
});

const mockApi = recruitmentApi as jest.Mocked<typeof recruitmentApi>;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const interview = (overrides: Record<string, unknown> = {}) => ({
  id: 'int-1',
  applicationId: 'app-1',
  candidate: { id: 'c1', firstName: 'Asha', lastName: 'Rao' },
  jobOpening: { id: 'o1', title: 'Backend Engineer' },
  roundName: 'Technical',
  scheduledStart: inDays(2),
  scheduledEnd: inDays(2.05),
  mode: 'VIDEO',
  location: null,
  meetingLink: 'https://meet.example/x',
  status: 'SCHEDULED',
  notes: null,
  panel: [{ id: 'emp-p1', employeeCode: 'E1', firstName: 'Pan', lastName: 'One' }],
  feedbackSubmittedBy: [] as string[],
  myFeedbackDue: true,
  ...overrides,
});

describe('MyInterviewsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(false);
  });

  it('splits upcoming and past interviews', async () => {
    mockApi.myInterviews.mockResolvedValue({
      data: [
        interview(),
        interview({ id: 'int-2', roundName: 'HR round', status: 'COMPLETED', scheduledStart: inDays(-3), scheduledEnd: inDays(-2.9) }),
      ],
    } as any);
    render(<MyInterviewsPage />);

    expect(await screen.findByText('Backend Engineer · Technical')).toBeInTheDocument();
    expect(screen.queryByText('Backend Engineer · HR round')).not.toBeInTheDocument();
    expect(screen.getByText('Feedback due')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Past (1)' }));
    expect(screen.getByText('Backend Engineer · HR round')).toBeInTheDocument();
    // An employee cannot open the application page.
    expect(screen.queryByText('Open application')).not.toBeInTheDocument();
  });

  it('submits a scorecard from the feedback form', async () => {
    mockApi.myInterviews.mockResolvedValue({ data: [interview()] } as any);
    mockApi.submitFeedback.mockResolvedValue({ data: { id: 'fb-1' } } as any);
    render(<MyInterviewsPage />);

    fireEvent.click(await screen.findByText('Give feedback'));
    expect(screen.getAllByTestId('score-row')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Overall rating (1–5)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Recommendation'), { target: { value: 'STRONG_HIRE' } });
    fireEvent.change(screen.getByLabelText('Rating 1'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Strengths'), { target: { value: 'Clear thinker' } });
    fireEvent.click(screen.getByText('Submit feedback'));

    await waitFor(() => expect(mockApi.submitFeedback).toHaveBeenCalled());
    const [id, payload] = mockApi.submitFeedback.mock.calls[0];
    expect(id).toBe('int-1');
    expect(payload).toMatchObject({
      overallRating: 5,
      recommendation: 'STRONG_HIRE',
      strengths: 'Clear thinker',
      concerns: null,
    });
    expect(payload.scores[0]).toEqual({ criterion: 'Technical skills', rating: 4, comment: null });
    await waitFor(() => expect(mockApi.myInterviews).toHaveBeenCalledTimes(2));
  });

  it('prefills my earlier scorecard when updating', async () => {
    mockApi.myInterviews.mockResolvedValue({
      data: [interview({ myFeedbackDue: false, feedbackSubmittedBy: ['emp-p1'] })],
    } as any);
    mockApi.getFeedback.mockResolvedValue({
      data: {
        visible: true,
        items: [
          {
            id: 'fb-1',
            interviewId: 'int-1',
            interviewer: { id: 'emp-p1', employeeCode: 'E1', firstName: 'Pan', lastName: 'One' },
            overallRating: 2,
            recommendation: 'NO_HIRE',
            scores: [{ criterion: 'Depth', rating: 2, comment: 'thin' }],
            strengths: null,
            concerns: 'Gaps',
            submittedAt: '2026-03-15T12:00:00.000Z',
          },
        ],
      },
    } as any);
    render(<MyInterviewsPage />);

    fireEvent.click(await screen.findByText('Update feedback'));
    await screen.findByText('Update feedback', { selector: 'button[type="submit"]' });
    expect(await screen.findByLabelText('Criterion 1')).toHaveValue('Depth');
    expect(screen.getByLabelText('Concerns')).toHaveValue('Gaps');
  });

  it("tells a panelist others' feedback is hidden until they submit", async () => {
    mockApi.myInterviews.mockResolvedValue({ data: [interview()] } as any);
    mockApi.getFeedback.mockResolvedValue({ data: { visible: false, items: [] } } as any);
    render(<MyInterviewsPage />);

    fireEvent.click(await screen.findByText('Panel feedback'));
    expect(await screen.findByText(/Submit your own scorecard/)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockApi.myInterviews.mockResolvedValue({ data: [] } as any);
    render(<MyInterviewsPage />);
    expect(await screen.findByText('No upcoming interviews.')).toBeInTheDocument();
  });
});
