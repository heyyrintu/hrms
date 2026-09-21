import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AccrualHistoryPage from './page';
import { accrualApi } from '@/lib/api';
import { carryForwardApi } from '@/lib/api-carry-forward';
import toast from 'react-hot-toast';

// Mock lucide-react icons
jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/lib/api', () => ({
  accrualApi: {
    getRuns: jest.fn(),
    triggerAccrual: jest.fn(),
    getRunEntries: jest.fn(),
  },
}));

jest.mock('@/lib/api-carry-forward', () => ({
  carryForwardApi: {
    getRuns: jest.fn(),
    run: jest.fn(),
  },
}));

const mockToast = toast as unknown as jest.Mock & {
  success: jest.Mock;
  error: jest.Mock;
};

const carryForwardRun = (overrides: Record<string, unknown> = {}) => ({
  id: 'cf-1',
  fromYear: 2025,
  toYear: 2026,
  triggerType: 'MANUAL_ADMIN',
  status: 'COMPLETED',
  processedCount: 42,
  failedCount: 1,
  startedAt: '2026-01-01T12:00:00.000Z',
  completedAt: '2026-01-01T12:01:00.000Z',
  ...overrides,
});

describe('AccrualHistoryPage carry-forward card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (accrualApi.getRuns as jest.Mock).mockResolvedValue({ data: { data: [] } });
    (carryForwardApi.getRuns as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('loads the carry-forward runs on first render', async () => {
    render(<AccrualHistoryPage />);

    await waitFor(() => {
      expect(carryForwardApi.getRuns).toHaveBeenCalled();
    });
    expect(await screen.findByText('Leave Carry-forward')).toBeInTheDocument();
  });

  it('shows an empty state when there are no carry-forward runs', async () => {
    render(<AccrualHistoryPage />);

    expect(await screen.findByText('No carry-forward runs yet')).toBeInTheDocument();
  });

  it('renders a run row with its years, status and counts', async () => {
    (carryForwardApi.getRuns as jest.Mock).mockResolvedValue({
      data: [carryForwardRun()],
    });

    render(<AccrualHistoryPage />);

    expect(await screen.findByText('2025')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('defaults the from-year input to last year', async () => {
    render(<AccrualHistoryPage />);

    const input = (await screen.findByLabelText('From year')) as HTMLInputElement;
    expect(input.value).toBe(String(new Date().getFullYear() - 1));
  });

  it('runs the carry-forward for the entered year and reloads the list', async () => {
    (carryForwardApi.run as jest.Mock).mockResolvedValue({
      data: { runId: 'cf-2', processedCount: 5, failedCount: 0, alreadyRan: false },
    });

    render(<AccrualHistoryPage />);

    const input = await screen.findByLabelText('From year');
    fireEvent.change(input, { target: { value: '2024' } });
    fireEvent.click(screen.getByText('Run year-end carry-forward'));

    await waitFor(() => {
      expect(carryForwardApi.run).toHaveBeenCalledWith(2024);
    });
    expect(mockToast.success).toHaveBeenCalled();
    // once on mount, once after the run
    expect(carryForwardApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it('reports an already-run year instead of claiming fresh work', async () => {
    (carryForwardApi.run as jest.Mock).mockResolvedValue({
      data: { runId: 'cf-1', processedCount: 42, failedCount: 1, alreadyRan: true },
    });

    render(<AccrualHistoryPage />);

    fireEvent.click(await screen.findByText('Run year-end carry-forward'));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('already run'),
      );
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('surfaces a failed carry-forward run as an error toast', async () => {
    (carryForwardApi.run as jest.Mock).mockRejectedValue({
      response: { data: { message: 'Carry-forward blew up' } },
    });

    render(<AccrualHistoryPage />);

    fireEvent.click(await screen.findByText('Run year-end carry-forward'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Carry-forward blew up',
        expect.anything(),
      );
    });
  });
});
