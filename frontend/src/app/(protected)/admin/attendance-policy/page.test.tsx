import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AttendancePolicyPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock react-hot-toast
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (...args: any[]) => mockToast.success(...args),
    error: (...args: any[]) => mockToast.error(...args),
  },
}));

jest.mock('@/lib/api-attendance-policy', () => ({
  attendancePolicyApi: {
    get: jest.fn(),
    update: jest.fn(),
    markAbsent: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendancePolicyApi } = require('@/lib/api-attendance-policy');

/** The shift fields only appear once the policy has loaded. */
async function waitForForm() {
  await waitFor(() =>
    expect(screen.getByLabelText('Grace minutes')).toBeInTheDocument(),
  );
}

const policy = {
  id: 'pol-1',
  tenantId: 't1',
  defaultShiftStart: '09:30',
  defaultGraceMinutes: 10,
  lateMarksPerHalfDay: 3,
  autoMarkAbsent: true,
  absentIsLop: false,
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
};

describe('AttendancePolicyPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attendancePolicyApi.get.mockResolvedValue({ data: policy });
    attendancePolicyApi.update.mockResolvedValue({ data: policy });
    attendancePolicyApi.markAbsent.mockResolvedValue({
      data: { marked: 2, skipped: 1 },
    });
  });

  it('renders the heading', async () => {
    render(<AttendancePolicyPage />);
    expect(screen.getByText('Attendance Policy')).toBeInTheDocument();
    await waitFor(() => expect(attendancePolicyApi.get).toHaveBeenCalled());
  });

  it('fills the form from the saved policy', async () => {
    render(<AttendancePolicyPage />);

    await waitFor(() =>
      expect(screen.getByLabelText('Default shift start (HH:mm)')).toHaveValue('09:30'),
    );
    expect(screen.getByLabelText('Grace minutes')).toHaveValue(10);
    expect(screen.getByLabelText('Late marks per half day (blank for none)')).toHaveValue(3);
    expect(
      screen.getByLabelText('Mark missing days absent automatically each night'),
    ).toBeChecked();
    expect(screen.getByLabelText('Absent days are loss of pay')).not.toBeChecked();
  });

  it('shows a blank late-mark box when the penalty is switched off', async () => {
    attendancePolicyApi.get.mockResolvedValue({
      data: { ...policy, lateMarksPerHalfDay: null },
    });

    render(<AttendancePolicyPage />);

    await waitFor(() =>
      expect(
        screen.getByLabelText('Late marks per half day (blank for none)'),
      ).toHaveValue(null),
    );
  });

  it('sends a null late-mark threshold when the box is cleared', async () => {
    render(<AttendancePolicyPage />);
    await waitForForm();

    fireEvent.change(
      screen.getByLabelText('Late marks per half day (blank for none)'),
      { target: { value: '' } },
    );
    fireEvent.click(screen.getByText('Save policy'));

    await waitFor(() =>
      expect(attendancePolicyApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ lateMarksPerHalfDay: null }),
      ),
    );
  });

  it('saves the edited numbers as numbers', async () => {
    render(<AttendancePolicyPage />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Grace minutes'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByLabelText('Absent days are loss of pay'));
    fireEvent.click(screen.getByText('Save policy'));

    await waitFor(() =>
      expect(attendancePolicyApi.update).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultShiftStart: '09:30',
          defaultGraceMinutes: 20,
          absentIsLop: true,
        }),
      ),
    );
  });

  it('refuses to save a shift start that is not a clock time', async () => {
    render(<AttendancePolicyPage />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Default shift start (HH:mm)'), {
      target: { value: '9am' },
    });
    fireEvent.click(screen.getByText('Save policy'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(attendancePolicyApi.update).not.toHaveBeenCalled();
  });

  it('sweeps absentees for the chosen date and reports the counts', async () => {
    render(<AttendancePolicyPage />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-03-16' },
    });
    fireEvent.click(screen.getByText('Mark absentees'));

    await waitFor(() =>
      expect(attendancePolicyApi.markAbsent).toHaveBeenCalledWith('2026-03-16'),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Marked 2 absent, skipped 1');
  });

  it('will not sweep without a date', async () => {
    render(<AttendancePolicyPage />);
    await waitForForm();

    fireEvent.click(screen.getByText('Mark absentees'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Pick a date to sweep'));
    expect(attendancePolicyApi.markAbsent).not.toHaveBeenCalled();
  });
});
