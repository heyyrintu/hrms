import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SurveyBuilder } from './SurveyBuilder';
import { departmentsApi, branchesApi } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  departmentsApi: { getAll: jest.fn() },
  branchesApi: { getAll: jest.fn() },
}));

describe('SurveyBuilder', () => {
  beforeEach(() => {
    (departmentsApi.getAll as jest.Mock).mockResolvedValue({ data: [] });
    (branchesApi.getAll as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('adds a choice question and submits the DTO shape', async () => {
    const onSubmit = jest.fn();
    render(<SurveyBuilder onSubmit={onSubmit} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Q1 Pulse' },
    });

    // First question is TEXT by default; fill its text.
    fireEvent.change(screen.getByLabelText('Question 1 text'), {
      target: { value: 'How do you feel?' },
    });

    // Add a second question and switch it to SINGLE_CHOICE.
    fireEvent.click(screen.getByText('Add question'));
    fireEvent.change(screen.getByLabelText('Question 2 type'), {
      target: { value: 'SINGLE_CHOICE' },
    });
    fireEvent.change(screen.getByLabelText('Question 2 text'), {
      target: { value: 'Favourite colour?' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Question 2 option 1')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Question 2 option 1'), {
      target: { value: 'Red' },
    });
    fireEvent.change(screen.getByLabelText('Question 2 option 2'), {
      target: { value: 'Green' },
    });

    fireEvent.submit(screen.getByTestId('survey-builder-form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.title).toBe('Q1 Pulse');
    expect(payload.audienceType).toBe('ALL');
    expect(payload.audienceIds).toEqual([]);
    expect(payload.questions).toEqual([
      { type: 'TEXT', text: 'How do you feel?', required: true, options: [] },
      {
        type: 'SINGLE_CHOICE',
        text: 'Favourite colour?',
        required: true,
        options: ['Red', 'Green'],
      },
    ]);
  });
});
