import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AttendanceRequestsPage from './page';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (...a: any[]) => mockToast.success(...a),
    error: (...a: any[]) => mockToast.error(...a),
  },
}));

jest.mock('@/lib/api-attendance-requests', () => ({
  attendanceRequestsApi: {
    getMine: jest.fn(),
    create: jest.fn(),
    cancel: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendanceRequestsApi } = require('@/lib/api-attendance-requests');

const req = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  employeeId: 'e1',
  type: 'WFH',
  fromDate: '2099-01-05T00:00:00.000Z',
  toDate: '2099-01-06T00:00:00.000Z',
  days: 2,
  reason: 'Plumber visit',
  location: null,
  status: 'PENDING',
  approverNote: null,
  decidedAt: null,
  cancelledAt: null,
  createdAt: '2098-12-30T00:00:00.000Z',
  ...over,
});

describe('AttendanceRequestsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attendanceRequestsApi.getMine.mockResolvedValue({ data: [] });
    attendanceRequestsApi.create.mockResolvedValue({ data: req() });
    attendanceRequestsApi.cancel.mockResolvedValue({ data: req({ status: 'CANCELLED' }) });
  });

  it('lists my requests with status badges', async () => {
    attendanceRequestsApi.getMine.mockResolvedValue({
      data: [
        req({ id: 'a', reason: 'Plumber visit', status: 'PENDING' }),
        req({ id: 'b', type: 'ON_DUTY', reason: 'Client site', location: 'Pune', status: 'APPROVED' }),
        req({ id: 'c', reason: 'Fever', status: 'REJECTED' }),
      ],
    });
    render(<AttendanceRequestsPage />);

    expect(await screen.findByText('Plumber visit')).toBeInTheDocument();
    expect(screen.getByText('Client site')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    render(<AttendanceRequestsPage />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
  });

  it('shows an error state with a retry that reloads', async () => {
    attendanceRequestsApi.getMine.mockRejectedValueOnce(new Error('boom'));
    render(<AttendanceRequestsPage />);

    expect(await screen.findByText('Failed to load your requests')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(attendanceRequestsApi.getMine).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
  });

  it('offers Cancel only on PENDING requests and on APPROVED ones that have not ended', async () => {
    attendanceRequestsApi.getMine.mockResolvedValue({
      data: [
        req({ id: 'pending', reason: 'pending one', status: 'PENDING' }),
        req({ id: 'future', reason: 'future approved', status: 'APPROVED' }),
        req({
          id: 'past',
          reason: 'past approved',
          status: 'APPROVED',
          fromDate: '2020-01-05T00:00:00.000Z',
          toDate: '2020-01-06T00:00:00.000Z',
        }),
        req({ id: 'rej', reason: 'rejected one', status: 'REJECTED' }),
      ],
    });
    render(<AttendanceRequestsPage />);
    await screen.findByText('pending one');

    const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
    expect(within(rowOf('pending one')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(rowOf('future approved')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(rowOf('past approved')).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(rowOf('rejected one')).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('cancels a request and reloads the list', async () => {
    attendanceRequestsApi.getMine.mockResolvedValue({ data: [req({ id: 'pending', reason: 'pending one' })] });
    render(<AttendanceRequestsPage />);
    await screen.findByText('pending one');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(attendanceRequestsApi.cancel).toHaveBeenCalledWith('pending'));
    expect(mockToast.success).toHaveBeenCalled();
    await waitFor(() => expect(attendanceRequestsApi.getMine).toHaveBeenCalledTimes(2));
  });

  describe('create form', () => {
    const fill = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

    it('hides Location for work from home and shows it for on duty', async () => {
      render(<AttendanceRequestsPage />);
      await screen.findByText('No requests yet');

      expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();

      fill('Type', 'ON_DUTY');
      expect(screen.getByLabelText('Location')).toBeInTheDocument();

      fill('Type', 'WFH');
      expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
    });

    it('submits a WFH request without a location', async () => {
      render(<AttendanceRequestsPage />);
      await screen.findByText('No requests yet');

      fill('From', '2026-03-16');
      fill('To', '2026-03-18');
      fill('Reason', 'Plumber');
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

      await waitFor(() =>
        expect(attendanceRequestsApi.create).toHaveBeenCalledWith({
          type: 'WFH',
          fromDate: '2026-03-16',
          toDate: '2026-03-18',
          reason: 'Plumber',
        }),
      );
      expect(mockToast.success).toHaveBeenCalled();
      await waitFor(() => expect(attendanceRequestsApi.getMine).toHaveBeenCalledTimes(2));
    });

    it('submits an on-duty request with its location', async () => {
      render(<AttendanceRequestsPage />);
      await screen.findByText('No requests yet');

      fill('Type', 'ON_DUTY');
      fill('From', '2026-03-16');
      fill('To', '2026-03-16');
      fill('Reason', 'Client visit');
      fill('Location', 'Pune');
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

      await waitFor(() =>
        expect(attendanceRequestsApi.create).toHaveBeenCalledWith({
          type: 'ON_DUTY',
          fromDate: '2026-03-16',
          toDate: '2026-03-16',
          reason: 'Client visit',
          location: 'Pune',
        }),
      );
    });

    it('refuses an incomplete form or a reversed range without calling the API', async () => {
      render(<AttendanceRequestsPage />);
      await screen.findByText('No requests yet');

      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      expect(mockToast.error).toHaveBeenCalledWith('Fill in the dates and a reason');

      fill('From', '2026-03-18');
      fill('To', '2026-03-16');
      fill('Reason', 'x');
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      expect(mockToast.error).toHaveBeenCalledWith('The end date cannot be before the start date');

      expect(attendanceRequestsApi.create).not.toHaveBeenCalled();
    });

    it('shows the server message when the request is refused', async () => {
      attendanceRequestsApi.create.mockRejectedValue({
        response: { data: { message: 'You already have a pending or approved request overlapping these dates' } },
      });
      render(<AttendanceRequestsPage />);
      await screen.findByText('No requests yet');

      fill('From', '2026-03-16');
      fill('To', '2026-03-16');
      fill('Reason', 'x');
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

      await waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith(
          'You already have a pending or approved request overlapping these dates',
        ),
      );
    });
  });
});
