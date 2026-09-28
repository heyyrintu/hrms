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

  it('sends a date-only close as the end of that day in IST', async () => {
    const onSubmit = jest.fn();
    const { container } = render(<SurveyBuilder onSubmit={onSubmit} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Q1 Pulse' } });
    fireEvent.change(screen.getByLabelText('Question 1 text'), {
      target: { value: 'How do you feel?' },
    });
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-09-30' } });

    fireEvent.submit(screen.getByTestId('survey-builder-form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.closesAt).toBe('2026-09-30T23:59:59+05:30');
    // 23:59:59 IST is 18:29:59 UTC on the same day, not UTC midnight (05:30 IST).
    expect(new Date(payload.closesAt).toISOString()).toBe('2026-09-30T18:29:59.000Z');
  });

  it('omits closesAt when no date is picked', async () => {
    const onSubmit = jest.fn();
    render(<SurveyBuilder onSubmit={onSubmit} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Q1 Pulse' } });
    fireEvent.change(screen.getByLabelText('Question 1 text'), {
      target: { value: 'How do you feel?' },
    });
    fireEvent.submit(screen.getByTestId('survey-builder-form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].closesAt).toBeUndefined();
  });
});
