import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PreOnboardingPortalPage from './page';
import { preOnboardingApi } from '@/lib/api-careers';

const TOKEN = 'a'.repeat(64);

jest.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
}));

jest.mock('@/lib/api-careers', () => {
  const actual = jest.requireActual('@/lib/api-careers');
  return {
    ...actual,
    preOnboardingApi: { get: jest.fn(), saveDetails: jest.fn(), uploadDocument: jest.fn(), submit: jest.fn() },
  };
});

const mockApi = preOnboardingApi as jest.Mocked<typeof preOnboardingApi>;

const portal = (overrides: Record<string, unknown> = {}) => ({
  company: { name: 'Acme Inc', logoUrl: null },
  employeeFirstName: 'Asha',
  joinDate: '2026-04-01',
  status: 'INVITED',
  expiresAt: '2026-03-25T12:00:00.000Z',
  documents: [
    { key: 'photo_id', label: 'Government photo ID', required: true, uploaded: false, fileName: null, uploadedAt: null },
    { key: 'photo', label: 'Passport photo', required: false, uploaded: false, fileName: null, uploadedAt: null },
  ],
  personalDetails: null,
  ...overrides,
});

const httpError = (status: number, message?: string) =>
  Object.assign(new Error('fail'), { response: { status, data: { message } } });

const pdfFile = () => new File(['%PDF-1.4'], 'id.pdf', { type: 'application/pdf' });

describe('PreOnboardingPortalPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the checklist and greets the employee', async () => {
    mockApi.get.mockResolvedValue({ data: portal() } as any);
    render(<PreOnboardingPortalPage />);
    expect(await screen.findByText('Welcome, Asha!')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('Government photo ID')).toBeInTheDocument();
    expect(screen.getAllByText('Not uploaded yet')).toHaveLength(2);
  });

  it('shows the invalid-link message on 404', async () => {
    mockApi.get.mockRejectedValue(httpError(404));
    render(<PreOnboardingPortalPage />);
    expect(await screen.findByText('This pre-onboarding link is invalid or has expired')).toBeInTheDocument();
  });

  it('disables submit until every required document is uploaded', async () => {
    mockApi.get.mockResolvedValue({ data: portal() } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');
    expect(screen.getByText('Submit')).toBeDisabled();
    expect(screen.getByText(/Still needed: Government photo ID/)).toBeInTheDocument();
  });

  it('uploads a document and re-enables submit once all required docs are in', async () => {
    mockApi.get.mockResolvedValue({ data: portal() } as any);
    mockApi.uploadDocument.mockResolvedValue({
      data: portal({
        status: 'IN_PROGRESS',
        documents: [
          { key: 'photo_id', label: 'Government photo ID', required: true, uploaded: true, fileName: 'id.pdf', uploadedAt: '2026-01-01T00:00:00Z' },
          { key: 'photo', label: 'Passport photo', required: false, uploaded: false, fileName: null, uploadedAt: null },
        ],
      }),
    } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');

    const uploadInputs = screen.getAllByText(/Upload/, { selector: 'label' });
    const fileInput = uploadInputs[0].querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdfFile()] } });

    await waitFor(() => expect(mockApi.uploadDocument).toHaveBeenCalledWith(TOKEN, 'photo_id', expect.any(File)));
    expect(await screen.findByText('Uploaded: id.pdf')).toBeInTheDocument();
    expect(screen.getByText('Submit')).not.toBeDisabled();
  });

  it('rejects an oversized document client-side', async () => {
    mockApi.get.mockResolvedValue({ data: portal() } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');

    const uploadInputs = screen.getAllByText(/Upload/, { selector: 'label' });
    const fileInput = uploadInputs[0].querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [bigFile] } });

    expect(await screen.findByText('File must be 5 MB or smaller')).toBeInTheDocument();
    expect(mockApi.uploadDocument).not.toHaveBeenCalled();
  });

  it('saves personal details', async () => {
    mockApi.get.mockResolvedValue({ data: portal() } as any);
    mockApi.saveDetails.mockResolvedValue({ data: portal({ status: 'IN_PROGRESS' }) } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByText('Save details'));

    await waitFor(() =>
      expect(mockApi.saveDetails).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ mobileNumber: '9999999999' })),
    );
    expect(await screen.findByText('Details saved')).toBeInTheDocument();
  });

  it('locks the form once submitted', async () => {
    mockApi.get.mockResolvedValue({
      data: portal({
        status: 'SUBMITTED',
        documents: [
          { key: 'photo_id', label: 'Government photo ID', required: true, uploaded: true, fileName: 'id.pdf', uploadedAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');

    expect(screen.getByText(/your details and documents have been submitted/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toBeDisabled();
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });

  it('submits once every required document is present', async () => {
    mockApi.get.mockResolvedValue({
      data: portal({
        documents: [
          { key: 'photo_id', label: 'Government photo ID', required: true, uploaded: true, fileName: 'id.pdf', uploadedAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    } as any);
    mockApi.submit.mockResolvedValue({ data: portal({ status: 'SUBMITTED' }) } as any);
    render(<PreOnboardingPortalPage />);
    await screen.findByText('Welcome, Asha!');

    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(mockApi.submit).toHaveBeenCalledWith(TOKEN));
  });
});
