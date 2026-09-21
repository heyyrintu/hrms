import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WebhooksAdminPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock react-hot-toast
const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
};
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (...args: any[]) => mockToast.success(...args),
    error: (...args: any[]) => mockToast.error(...args),
  },
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
  webhooksApi: {
    getEvents: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    test: jest.fn(),
    getLogs: jest.fn(),
  },
}));

// Mock @/lib/utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webhooksApi } = require('@/lib/api');

const events = [
  'employee.created',
  'leave.approved',
  'payroll.run_completed',
];

const webhook = {
  id: 'wh-1',
  url: 'https://example.com/hooks',
  events: ['leave.approved'],
  description: 'Payroll bridge',
  isActive: true,
  hasSecret: true,
  secretHint: '••••alue',
  createdAt: '2026-01-01T12:00:00Z',
  updatedAt: '2026-01-01T12:00:00Z',
};

describe('WebhooksAdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webhooksApi.getEvents.mockResolvedValue({ data: { events } });
    webhooksApi.list.mockResolvedValue({ data: [webhook] });
    webhooksApi.getLogs.mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
    });
  });

  it('renders the Webhooks heading', async () => {
    render(<WebhooksAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Webhooks')).toBeInTheDocument();
    });
  });

  it('lists webhooks with their url, events and active state', async () => {
    render(<WebhooksAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('https://example.com/hooks')).toBeInTheDocument();
    });
    expect(screen.getByText('leave.approved')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows that a webhook is signed without revealing the secret', async () => {
    render(<WebhooksAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/Signed \(••••alue\)/)).toBeInTheDocument();
    });
  });

  it('renders the empty state when there are no webhooks', async () => {
    webhooksApi.list.mockResolvedValue({ data: [] });
    render(<WebhooksAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('No Webhooks Yet')).toBeInTheDocument();
    });
  });

  it('renders the event catalogue as checkboxes in the create form', async () => {
    render(<WebhooksAdminPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Add Webhook').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByText('Add Webhook')[0]);

    await waitFor(() => {
      expect(screen.getByText('employee.created')).toBeInTheDocument();
    });
    expect(screen.getByText('payroll.run_completed')).toBeInTheDocument();
    // One per event, plus the "Active" toggle.
    expect(screen.getAllByRole('checkbox').length).toBe(events.length + 1);
  });

  it('creates a webhook from the form', async () => {
    webhooksApi.create.mockResolvedValue({ data: { id: 'wh-2' } });
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Add Webhook').length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(screen.getAllByText('Add Webhook')[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('https://example.com/hooks/hrms')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('https://example.com/hooks/hrms'), {
      target: { value: 'https://new.example/hook' },
    });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(webhooksApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://new.example/hook',
          events: ['employee.created'],
        })
      );
    });
  });

  it('surfaces a successful test delivery', async () => {
    webhooksApi.test.mockResolvedValue({
      data: { id: 'log-1', status: 'SUCCESS', httpStatus: 200 },
    });
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Send test to https://example.com/hooks')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Send test to https://example.com/hooks'));

    await waitFor(() => {
      expect(webhooksApi.test).toHaveBeenCalledWith('wh-1');
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('200')
      );
    });
  });

  it('surfaces a failed test delivery', async () => {
    webhooksApi.test.mockResolvedValue({
      data: {
        id: 'log-1',
        status: 'FAILED',
        httpStatus: 500,
        errorMessage: 'Endpoint responded 500',
      },
    });
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Send test to https://example.com/hooks')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Send test to https://example.com/hooks'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining('Endpoint responded 500')
      );
    });
  });

  it('opens the delivery log for a webhook', async () => {
    webhooksApi.getLogs.mockResolvedValue({
      data: {
        data: [
          {
            id: 'log-1',
            event: 'leave.approved',
            status: 'FAILED',
            httpStatus: 500,
            responseBody: null,
            errorMessage: 'Endpoint responded 500',
            attemptCount: 3,
            triggeredAt: '2026-02-11T09:00:00Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
      },
    });
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(
        screen.getByLabelText('Delivery log for https://example.com/hooks')
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Delivery log for https://example.com/hooks'));

    await waitFor(() => {
      expect(screen.getByText('Delivery Log')).toBeInTheDocument();
      expect(webhooksApi.getLogs).toHaveBeenCalledWith('wh-1', { page: 1, limit: 25 });
    });
    expect(screen.getByText('FAILED')).toBeInTheDocument();
  });

  it('filters the delivery log by status', async () => {
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(
        screen.getByLabelText('Delivery log for https://example.com/hooks')
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Delivery log for https://example.com/hooks'));

    await waitFor(() => {
      expect(screen.getByLabelText('Filter deliveries by status')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Filter deliveries by status'), {
      target: { value: 'FAILED' },
    });

    await waitFor(() => {
      expect(webhooksApi.getLogs).toHaveBeenLastCalledWith('wh-1', {
        page: 1,
        limit: 25,
        status: 'FAILED',
      });
    });
  });

  it('deletes a webhook after confirmation', async () => {
    webhooksApi.delete.mockResolvedValue({ data: { message: 'Webhook deleted' } });
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Delete https://example.com/hooks')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Delete https://example.com/hooks'));

    await waitFor(() => {
      expect(screen.getByText('Delete Webhook')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(webhooksApi.delete).toHaveBeenCalledWith('wh-1');
    });
  });

  it('reports a load failure instead of rendering a broken page', async () => {
    webhooksApi.list.mockRejectedValue(new Error('boom'));
    render(<WebhooksAdminPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Could not load webhooks.');
    });
  });
});
