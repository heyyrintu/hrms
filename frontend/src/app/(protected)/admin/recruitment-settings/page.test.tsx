import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecruitmentSettingsPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api-recruitment', () => ({
  recruitmentApi: { getSettings: jest.fn(), updateSettings: jest.fn() },
}));

const mockApi = recruitmentApi as jest.Mocked<typeof recruitmentApi>;

const settings = (overrides: Record<string, unknown> = {}) => ({
  careersPageEnabled: false,
  careersIntro: null,
  offerExpiryDays: 7,
  preOnboardingExpiryDays: 14,
  preOnboardingDocuments: [{ key: 'photo_id', label: 'Government photo ID', category: 'ID_PROOF', required: true }],
  careersUrl: 'https://hrms.test/careers/acme',
  ...overrides,
});

Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });

describe('RecruitmentSettingsPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and shows the current settings', async () => {
    mockApi.getSettings.mockResolvedValue({ data: settings() } as any);
    render(<RecruitmentSettingsPage />);
    expect(await screen.findByText('https://hrms.test/careers/acme')).toBeInTheDocument();
    expect(screen.getByDisplayValue('photo_id')).toBeInTheDocument();
  });

  it('saves the updated settings', async () => {
    mockApi.getSettings.mockResolvedValue({ data: settings() } as any);
    mockApi.updateSettings.mockResolvedValue({ data: settings({ careersPageEnabled: true }) } as any);
    render(<RecruitmentSettingsPage />);
    await screen.findByText('https://hrms.test/careers/acme');

    fireEvent.click(screen.getByText('Publish the public careers page'));
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() =>
      expect(mockApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ careersPageEnabled: true, offerExpiryDays: 7, preOnboardingExpiryDays: 14 }),
      ),
    );
  });

  it('adds and removes a checklist item', async () => {
    mockApi.getSettings.mockResolvedValue({ data: settings() } as any);
    render(<RecruitmentSettingsPage />);
    await screen.findByText('https://hrms.test/careers/acme');

    fireEvent.click(screen.getByText('Add document'));
    expect(screen.getAllByLabelText('Key')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Remove Government photo ID'));
    expect(screen.getAllByLabelText('Key')).toHaveLength(1);
  });

  it('rejects an invalid checklist key before saving', async () => {
    const toast = jest.requireMock('react-hot-toast').default;
    mockApi.getSettings.mockResolvedValue({ data: settings() } as any);
    render(<RecruitmentSettingsPage />);
    await screen.findByText('https://hrms.test/careers/acme');

    fireEvent.change(screen.getByDisplayValue('photo_id'), { target: { value: 'Bad Key!' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('lower-case')));
    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });
});
