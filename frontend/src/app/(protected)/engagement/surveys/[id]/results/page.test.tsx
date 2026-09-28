import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SurveyResultsPage from './page';
import { surveysApi } from '@/lib/api-surveys';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'survey-1' }),
}));

jest.mock('@/lib/api-surveys', () => ({
  surveysApi: {
    results: jest.fn(),
    responses: jest.fn(),
  },
}));

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

describe('SurveyResultsPage', () => {
  it('renders the withheld state below the response minimum', async () => {
    (surveysApi.results as jest.Mock).mockResolvedValue({
      data: {
        surveyId: 'survey-1',
        isAnonymous: true,
        withheld: true,
        participantCount: 10,
        responseCount: 2,
        responseRate: 20,
      },
    });

    render(<SurveyResultsPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Results are hidden until at least 3 people respond.'),
      ).toBeInTheDocument(),
    );
  });

  it('renders the eNPS score and its promoter/passive/detractor split', async () => {
    (surveysApi.results as jest.Mock).mockResolvedValue({
      data: {
        surveyId: 'survey-1',
        isAnonymous: false,
        withheld: false,
        participantCount: 10,
        responseCount: 10,
        responseRate: 100,
        questions: [
          {
            questionId: 'q-enps',
            text: 'Recommend us?',
            type: 'ENPS',
            promoters: 5,
            passives: 2,
            detractors: 3,
            score: 20,
            distribution: {},
          },
        ],
      },
    });
    (surveysApi.responses as jest.Mock).mockResolvedValue({ data: [] });

    render(<SurveyResultsPage />);

    await waitFor(() => expect(screen.getByTestId('enps-score')).toHaveTextContent('20'));
    expect(screen.getByText('5 promoters · 2 passives · 3 detractors')).toBeInTheDocument();
  });

  it('shows how many anonymous responses are waiting for a batch release', async () => {
    (surveysApi.results as jest.Mock).mockResolvedValue({
      data: {
        surveyId: 'survey-1',
        isAnonymous: true,
        withheld: true,
        participantCount: 10,
        responseCount: 2,
        responseRate: 40,
        pendingCount: 2,
      },
    });

    render(<SurveyResultsPage />);

    await waitFor(() =>
      expect(
        screen.getByText('2 responses are waiting to be released in a batch.'),
      ).toBeInTheDocument(),
    );
    // Submitted = released + pending, matching the participation-based rate.
    expect(screen.getByText('4 / 10 (40%)')).toBeInTheDocument();
  });

  it('shows no pending notice when nothing is waiting', async () => {
    (surveysApi.results as jest.Mock).mockResolvedValue({
      data: {
        surveyId: 'survey-1',
        isAnonymous: true,
        withheld: true,
        participantCount: 10,
        responseCount: 2,
        responseRate: 20,
        pendingCount: 0,
      },
    });

    render(<SurveyResultsPage />);

    await waitFor(() => expect(screen.getByText('2 / 10 (20%)')).toBeInTheDocument());
    expect(screen.queryByText(/waiting to be released/)).not.toBeInTheDocument();
  });
});
