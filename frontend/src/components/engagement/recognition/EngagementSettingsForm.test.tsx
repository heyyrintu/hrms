import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EngagementSettingsForm } from './EngagementSettingsForm';
import { recognitionApi } from '@/lib/api-recognition';

jest.mock('@/lib/api-recognition', () => ({
  recognitionApi: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

describe('EngagementSettingsForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recognitionApi.getSettings as jest.Mock).mockResolvedValue({
      data: {
        pointsEnabled: false,
        monthlyPointsAllowance: 100,
        showBirthdays: true,
        showAnniversaries: true,
      },
    });
  });

  it('loads and shows the current settings, hiding the allowance input while points are off', async () => {
    render(<EngagementSettingsForm />);

    await waitFor(() => expect(screen.getByLabelText('Points enabled')).toBeInTheDocument());
    expect(screen.queryByLabelText(/Monthly points allowance/)).not.toBeInTheDocument();
  });

  it('shows the allowance input once points are toggled on', async () => {
    render(<EngagementSettingsForm />);
    await waitFor(() => expect(screen.getByLabelText('Points enabled')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Points enabled'));

    expect(screen.getByLabelText(/Monthly points allowance/)).toBeInTheDocument();
  });

  it('saves the edited settings', async () => {
    (recognitionApi.updateSettings as jest.Mock).mockResolvedValue({
      data: { pointsEnabled: true, monthlyPointsAllowance: 250, showBirthdays: true, showAnniversaries: true },
    });

    render(<EngagementSettingsForm />);
    await waitFor(() => expect(screen.getByLabelText('Points enabled')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Points enabled'));
    fireEvent.change(screen.getByLabelText(/Monthly points allowance/), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() =>
      expect(recognitionApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ pointsEnabled: true, monthlyPointsAllowance: 250 }),
      ),
    );
  });
});
