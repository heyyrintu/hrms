import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PublicOfferPage from './page';
import { publicOfferApi } from '@/lib/api-careers';

const TOKEN = 'a'.repeat(64);

jest.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
}));

jest.mock('@/lib/api-careers', () => {
  const actual = jest.requireActual('@/lib/api-careers');
  return {
    ...actual,
    publicOfferApi: { get: jest.fn(), accept: jest.fn(), decline: jest.fn() },
  };
});

const mockApi = publicOfferApi as jest.Mocked<typeof publicOfferApi>;

const offer = (overrides: Record<string, unknown> = {}) => ({
  company: { name: 'Acme', logoUrl: 'https://cdn.example/logo.png' },
  candidateFirstName: 'Asha',
  jobTitle: 'Backend Engineer',
  content: '<p>Dear Asha,</p><p>We are pleased <script>alert(1)</script>to offer you the role.</p>',
  annualCtc: 1200000,
  joiningDate: '2026-04-01',
  expiresAt: '2026-03-25T12:00:00.000Z',
  status: 'SENT',
  respondedAt: null,
  ...overrides,
});

const httpError = (status: number, message?: string) =>
  Object.assign(new Error('fail'), { response: { status, data: { message } } });

describe('PublicOfferPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the letter as plain text with the key terms', async () => {
    mockApi.get.mockResolvedValue({ data: offer() } as any);
    const { container } = render(<PublicOfferPage />);

    expect(await screen.findByText(/your offer for Backend Engineer/)).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('₹12,00,000')).toBeInTheDocument();
    const letter = screen.getByLabelText('Offer letter');
    expect(letter.textContent).toContain('We are pleased');
    // Never rendered as markup.
    expect(container.querySelector('script')).toBeNull();
    expect(letter.querySelector('p')).toBeNull();
    // The logo cannot leak the token through the Referer header.
    expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows the invalid-link message on 404', async () => {
    mockApi.get.mockRejectedValue(httpError(404));
    render(<PublicOfferPage />);
    expect(await screen.findByText('This offer link is invalid or has expired')).toBeInTheDocument();
    expect(screen.queryByText('Accept offer')).not.toBeInTheDocument();
  });

  it('accepts with the typed full name', async () => {
    mockApi.get.mockResolvedValue({ data: offer() } as any);
    mockApi.accept.mockResolvedValue({
      data: offer({ status: 'ACCEPTED', respondedAt: '2026-03-16T12:00:00.000Z' }),
    } as any);
    render(<PublicOfferPage />);

    fireEvent.click(await screen.findByText('Accept offer'));
    fireEvent.change(screen.getByLabelText('Type your full name to accept this offer'), {
      target: { value: '  Asha Rao ' },
    });
    fireEvent.click(screen.getByText('I accept'));

    await waitFor(() => expect(mockApi.accept).toHaveBeenCalledWith(TOKEN, 'Asha Rao'));
    expect(await screen.findByText(/You accepted this offer/)).toBeInTheDocument();
    expect(screen.queryByText('Accept offer')).not.toBeInTheDocument();
  });

  it('shows the server message when the name does not match', async () => {
    mockApi.get.mockResolvedValue({ data: offer() } as any);
    mockApi.accept.mockRejectedValue(
      httpError(400, 'Please type your full name exactly as it appears on the offer'),
    );
    render(<PublicOfferPage />);

    fireEvent.click(await screen.findByText('Accept offer'));
    fireEvent.change(screen.getByLabelText('Type your full name to accept this offer'), {
      target: { value: 'Someone' },
    });
    fireEvent.click(screen.getByText('I accept'));

    expect(await screen.findByRole('alert')).toHaveTextContent('exactly as it appears');
  });

  it('declines with a reason', async () => {
    mockApi.get.mockResolvedValue({ data: offer() } as any);
    mockApi.decline.mockResolvedValue({ data: offer({ status: 'DECLINED' }) } as any);
    render(<PublicOfferPage />);

    fireEvent.click(await screen.findByText('Decline'));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Accepted elsewhere' } });
    fireEvent.click(screen.getByText('Decline offer'));

    await waitFor(() => expect(mockApi.decline).toHaveBeenCalledWith(TOKEN, 'Accepted elsewhere'));
    expect(await screen.findByText(/You declined this offer/)).toBeInTheDocument();
  });

  it('shows terminal states without answer buttons', async () => {
    mockApi.get.mockResolvedValue({ data: offer({ status: 'WITHDRAWN' }) } as any);
    render(<PublicOfferPage />);
    expect(await screen.findByText(/This offer has been withdrawn by Acme/)).toBeInTheDocument();
    expect(screen.queryByText('Accept offer')).not.toBeInTheDocument();
  });

  it('offers a retry on a network error', async () => {
    mockApi.get.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce({ data: offer() } as any);
    render(<PublicOfferPage />);
    fireEvent.click(await screen.findByText('Try again'));
    expect(await screen.findByText('Accept offer')).toBeInTheDocument();
  });
});
