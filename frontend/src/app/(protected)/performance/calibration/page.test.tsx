import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CalibrationPage from './page';
import { calibrationApi } from '@/lib/api-performance-calibration';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

let mockFlags: { isAdmin: boolean; isManager: boolean };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockFlags.isAdmin ? 'HR_ADMIN' : 'MANAGER', employee: { id: 'e1' } }, ...mockFlags }),
}));
jest.mock('@/lib/api', () => ({
  api: {},
  performanceApi: {
    getCycles: jest.fn().mockResolvedValue({ data: { data: [{ id: 'c1', name: 'FY26 H1', status: 'ACTIVE' }], meta: {} } }),
  },
  departmentsApi: { getAll: jest.fn().mockResolvedValue({ data: [{ id: 'd1', name: 'Engineering' }] }) },
}));
jest.mock('@/lib/api-performance-calibration', () => ({
  calibrationApi: { get: jest.fn(), calibrate: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const dist = { '1': 0, '2': 1, '3': 2, '4': 1, '5': 0, unrated: 0, total: 4 };
const view = {
  cycle: { id: 'c1', name: 'FY26 H1', status: 'ACTIVE' },
  overall: dist,
  byDepartment: [{ departmentId: 'd1', departmentName: 'Engineering', distribution: dist }],
  byManager: [{ reviewerId: 'm1', reviewerName: 'Meg Manager', distribution: dist }],
  reviews: [{
    reviewId: 'r1', employeeId: 'e5', employeeName: 'Ann Employee', employeeCode: 'E005', departmentName: 'Engineering',
    reviewerName: 'Meg Manager', status: 'APPROVED', managerRating: 4, overallRating: 4, calibratedRating: 3,
    calibrationReason: 'Normalising across teams', finalRating: 3, potentialRating: 5,
  }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (calibrationApi.get as jest.Mock).mockResolvedValue({ data: view });
  (calibrationApi.calibrate as jest.Mock).mockResolvedValue({ data: {} });
});

describe('CalibrationPage', () => {
  it('keeps the override action disabled until the reason has 10 characters', async () => {
    mockFlags = { isAdmin: true, isManager: true };
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('Ann Employee')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override'));
    const submit = screen.getByRole('button', { name: 'Apply override' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'long enough reason' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(calibrationApi.calibrate).toHaveBeenCalledWith('r1', 3, 'long enough reason'));
  });

  it('sends a null rating when reverting', async () => {
    mockFlags = { isAdmin: true, isManager: true };
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('Ann Employee')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override'));
    fireEvent.change(screen.getByLabelText('New rating'), { target: { value: 'REVERT' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'reverting the change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply override' }));
    await waitFor(() => expect(calibrationApi.calibrate).toHaveBeenCalledWith('r1', null, 'reverting the change'));
  });

  it('shows a manager the read-only banner and no override buttons', async () => {
    mockFlags = { isAdmin: false, isManager: true };
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('Ann Employee')).toBeInTheDocument());
    expect(screen.getByText(/Read-only: your reviewees/)).toBeInTheDocument();
    expect(screen.queryByText('Override')).not.toBeInTheDocument();
  });

  it('shows the review row ratings', async () => {
    mockFlags = { isAdmin: false, isManager: true };
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('Normalising across teams')).toBeInTheDocument());
  });
});
