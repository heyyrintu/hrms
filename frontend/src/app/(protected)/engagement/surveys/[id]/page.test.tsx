import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RespondToSurveyPage from './page';
import { surveysApi } from '@/lib/api-surveys';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'survey-1' }),
}));

jest.mock('@/lib/api-surveys', () => ({
  surveysApi: {
    form: jest.fn(),
    submit: jest.fn(),
  },
}));

describe('RespondToSurveyPage', () => {
  const baseForm = {
    id: 'survey-1',
    title: 'Q1 Pulse',
    description: null,
    isAnonymous: false,
    status: 'ACTIVE',
    closesAt: null,
    submitted: false,
    questions: [
      { id: 'q-1', order: 0, type: 'TEXT', text: 'How do you feel?', required: true, options: [] },
    ],
  };

  it('posts my answers on submit', async () => {
    (surveysApi.form as jest.Mock).mockResolvedValue({ data: baseForm });
    (surveysApi.submit as jest.Mock).mockResolvedValue({ data: { submitted: true } });

    render(<RespondToSurveyPage />);

    await waitFor(() => expect(screen.getByText('Q1 Pulse')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('How do you feel?'), {
      target: { value: 'Pretty good' },
    });
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() =>
      expect(surveysApi.submit).toHaveBeenCalledWith('survey-1', {
        answers: [{ questionId: 'q-1', text: 'Pretty good' }],
      }),
    );
    await waitFor(() => expect(screen.getByText('Thanks, you have responded.')).toBeInTheDocument());
  });

  it('shows the anonymity notice for an anonymous survey', async () => {
    (surveysApi.form as jest.Mock).mockResolvedValue({
      data: { ...baseForm, isAnonymous: true },
    });

    render(<RespondToSurveyPage />);

    await waitFor(() =>
      expect(screen.getByTestId('anonymity-notice')).toHaveTextContent(
        'This survey is anonymous. Your answers are not linked to you in the application or its data.',
      ),
    );
  });

  it('shows "already responded" when submitted is true', async () => {
    (surveysApi.form as jest.Mock).mockResolvedValue({
      data: { ...baseForm, submitted: true },
    });

    render(<RespondToSurveyPage />);

    await waitFor(() => expect(screen.getByText('Thanks, you have responded.')).toBeInTheDocument());
  });

  it('shows "closed" for a survey past its closesAt', async () => {
    (surveysApi.form as jest.Mock).mockResolvedValue({
      data: { ...baseForm, closesAt: '2020-01-01T00:00:00Z' },
    });

    render(<RespondToSurveyPage />);

    await waitFor(() => expect(screen.getByText('This survey is closed.')).toBeInTheDocument());
  });
});
