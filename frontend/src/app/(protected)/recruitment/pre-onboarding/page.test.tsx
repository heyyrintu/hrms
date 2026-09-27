import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PreOnboardingPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';
import { employeesApi } from '@/lib/api';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api-recruitment', () => ({
  recruitmentApi: {
    listPreOnboarding: jest.fn(),
    createPreOnboarding: jest.fn(),
    revokePreOnboarding: jest.fn(),
    resendPreOnboarding: jest.fn(),
    completePreOnboarding: jest.fn(),
  },
}));
jest.mock('@/lib/api', () => ({ employeesApi: { getAll: jest.fn() } }));

const mockApi = recruitmentApi as jest.Mocked<typeof recruitmentApi>;
const mockEmployees = employeesApi as jest.Mocked<typeof employeesApi>;

Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });

const invite = (overrides: Record<string, unknown> = {}) => ({
  id: 'invite-1',
  employee: { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao', joinDate: '2026-04-01' },
  offerId: null,
  status: 'INVITED',
  expiresAt: '2026-04-15T00:00:00.000Z',
  submittedAt: null,
  lastAccessedAt: null,
  documents: [
    { key: 'photo_id', label: 'Government photo ID', category: 'ID_PROOF', required: true, uploaded: false, fileName: null, uploadedAt: null, verified: false },
  ],
  personalDetails: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

describe('PreOnboardingPage (HR)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists invites with status and document counts', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [invite()] } as any);
    render(<PreOnboardingPage />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getAllByText('Invited').length).toBeGreaterThan(0);
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('expands a row to show the document checklist', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [invite()] } as any);
    render(<PreOnboardingPage />);
    fireEvent.click(await screen.findByText('Asha Rao'));
    expect(await screen.findByText('Not uploaded')).toBeInTheDocument();
  });

  it('creates an invite and shows the link once', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [] } as any);
    mockEmployees.getAll.mockResolvedValue({ data: [{ id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao' }] } as any);
    mockApi.createPreOnboarding.mockResolvedValue({
      data: { invite: invite(), link: 'https://hrms.test/pre-onboarding/abc' },
    } as any);
    render(<PreOnboardingPage />);
    await screen.findByText(/No pre-onboarding invites/);

    fireEvent.click(screen.getByText('New invite'));
    await screen.findByText('Choose an employee');
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'emp-1' } });
    fireEvent.click(screen.getByText('Send invite'));

    await waitFor(() => expect(mockApi.createPreOnboarding).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'emp-1' })));
    expect(await screen.findByText('https://hrms.test/pre-onboarding/abc')).toBeInTheDocument();
  });

  it('revokes a live invite', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [invite()] } as any);
    mockApi.revokePreOnboarding.mockResolvedValue({ data: invite({ status: 'REVOKED' }) } as any);
    render(<PreOnboardingPage />);
    await screen.findByText('Asha Rao');
    fireEvent.click(screen.getByText('Revoke'));
    await waitFor(() => expect(mockApi.revokePreOnboarding).toHaveBeenCalledWith('invite-1'));
  });

  it('shows Complete for a submitted invite', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [invite({ status: 'SUBMITTED' })] } as any);
    render(<PreOnboardingPage />);
    await screen.findByText('Asha Rao');
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('hides Complete and Revoke for a completed invite', async () => {
    mockApi.listPreOnboarding.mockResolvedValue({ data: [invite({ status: 'COMPLETED' })] } as any);
    render(<PreOnboardingPage />);
    await screen.findByText('Asha Rao');
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument();
  });
});
