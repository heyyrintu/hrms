import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AttendanceRequestApprovalsPage from './page';

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
    getPendingApprovals: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendanceRequestsApi } = require('@/lib/api-attendance-requests');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  employeeId: 'e1',
  type: 'WFH',
  fromDate: '2026-03-16T00:00:00.000Z',
  toDate: '2026-03-18T00:00:00.000Z',
  days: 3,
  reason: 'Plumber visit',
  location: null,
  status: 'PENDING',
  employee: { id: 'e1', firstName: 'Asha', lastName: 'Rao', employeeCode: 'E001' },
  ...over,
});

describe('AttendanceRequestApprovalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attendanceRequestsApi.getPendingApprovals.mockResolvedValue({ data: [row()] });
    attendanceRequestsApi.approve.mockResolvedValue({ data: row({ status: 'APPROVED' }) });
    attendanceRequestsApi.reject.mockResolvedValue({ data: row({ status: 'REJECTED' }) });
  });

  it('lists pending requests with the requester, type and reason', async () => {
    attendanceRequestsApi.getPendingApprovals.mockResolvedValue({
      data: [
        row(),
        row({ id: 'r2', type: 'ON_DUTY', reason: 'Client site', location: 'Pune' }),
      ],
    });
    render(<AttendanceRequestApprovalsPage />);

    expect(await screen.findByText('Plumber visit')).toBeInTheDocument();
    expect(screen.getByText('Client site')).toBeInTheDocument();
    expect(screen.getAllByText('Asha Rao').length).toBe(2);
    expect(screen.getByText('Work from home')).toBeInTheDocument();
    expect(screen.getByText('On duty')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    attendanceRequestsApi.getPendingApprovals.mockResolvedValue({ data: [] });
    render(<AttendanceRequestApprovalsPage />);
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });

  it('shows an error state with a retry', async () => {
    attendanceRequestsApi.getPendingApprovals.mockRejectedValueOnce(new Error('boom'));
    render(<AttendanceRequestApprovalsPage />);
    expect(await screen.findByText('Failed to load pending requests')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Plumber visit')).toBeInTheDocument();
  });

  it('approves with the typed note and drops the row', async () => {
    attendanceRequestsApi.getPendingApprovals
      .mockResolvedValueOnce({ data: [row()] })
      .mockResolvedValue({ data: [] });
    render(<AttendanceRequestApprovalsPage />);
    await screen.findByText('Plumber visit');

    fireEvent.click(screen.getByTitle('Approve'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(attendanceRequestsApi.approve).toHaveBeenCalledWith('r1', 'ok'));
    expect(mockToast.success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Plumber visit')).not.toBeInTheDocument());
  });

  it('approves without a note as undefined', async () => {
    render(<AttendanceRequestApprovalsPage />);
    await screen.findByText('Plumber visit');

    fireEvent.click(screen.getByTitle('Approve'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(attendanceRequestsApi.approve).toHaveBeenCalledWith('r1', undefined));
  });

  it('rejects with the typed note', async () => {
    attendanceRequestsApi.getPendingApprovals
      .mockResolvedValueOnce({ data: [row()] })
      .mockResolvedValue({ data: [] });
    render(<AttendanceRequestApprovalsPage />);
    await screen.findByText('Plumber visit');

    fireEvent.click(screen.getByTitle('Reject'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Need you in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    await waitFor(() =>
      expect(attendanceRequestsApi.reject).toHaveBeenCalledWith('r1', 'Need you in'),
    );
    await waitFor(() => expect(screen.queryByText('Plumber visit')).not.toBeInTheDocument());
  });

  it('keeps the row and shows the server message when the decision fails', async () => {
    attendanceRequestsApi.approve.mockRejectedValue({
      response: { data: { message: 'You are not an approver for this step' } },
    });
    render(<AttendanceRequestApprovalsPage />);
    await screen.findByText('Plumber visit');

    fireEvent.click(screen.getByTitle('Approve'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('You are not an approver for this step'),
    );
    // The row is still listed (the open dialog repeats the reason, hence All).
    expect(screen.getAllByText('Plumber visit').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Approve')).toBeInTheDocument();
  });
});
