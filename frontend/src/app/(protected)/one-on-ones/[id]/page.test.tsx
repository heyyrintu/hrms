import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OneOnOneDetailPage from './page';
import { oneOnOnesApi } from '@/lib/api-one-on-ones';

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

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meeting-1' }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options = [], placeholder, ...props }: any) => (
    <label>
      {label}
      <select aria-label={label} {...props}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, ...props }: any) => (
    <label>
      {label}
      <input aria-label={label} {...props} />
    </label>
  ),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api-one-on-ones', () => {
  const actual = jest.requireActual('@/lib/api-one-on-ones');
  return {
    ...actual,
    oneOnOnesApi: {
      get: jest.fn(),
      update: jest.fn(),
      addItem: jest.fn(),
      updateItem: jest.fn(),
      removeItem: jest.fn(),
      savePrivateNote: jest.fn(),
      openItems: jest.fn(),
    },
  };
});

const mockApi = oneOnOnesApi as jest.Mocked<typeof oneOnOnesApi>;

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: 'meeting-1',
  managerId: 'emp-mgr',
  employeeId: 'emp-1',
  scheduledAt: '2026-03-15T12:00:00.000Z',
  status: 'SCHEDULED',
  agenda: 'Talk about goals',
  sharedNotes: 'Existing notes',
  createdById: 'emp-mgr',
  completedAt: null,
  createdAt: '2026-03-01T12:00:00.000Z',
  updatedAt: '2026-03-01T12:00:00.000Z',
  myRole: 'MANAGER',
  counterpart: { id: 'emp-1', firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1' },
  actionItems: [{ id: 'item-1', tenantId: 't', meetingId: 'meeting-1', text: 'Follow up', assigneeId: 'emp-mgr', isDone: false, dueDate: null, createdAt: '2026-03-01T12:00:00.000Z', updatedAt: '2026-03-01T12:00:00.000Z' }],
  myPrivateNote: 'my secret note',
  ...overrides,
});

describe('OneOnOneDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: detail() } as any);
    mockApi.openItems.mockResolvedValue({ data: [] } as any);
    mockApi.update.mockResolvedValue({ data: detail() } as any);
    mockApi.addItem.mockResolvedValue({ data: { id: 'item-2' } } as any);
    mockApi.updateItem.mockResolvedValue({ data: { id: 'item-1', isDone: true } } as any);
    mockApi.removeItem.mockResolvedValue({ data: {} } as any);
    mockApi.savePrivateNote.mockResolvedValue({ data: {} } as any);
  });

  it('saves the shared agenda and notes', async () => {
    render(<OneOnOneDetailPage />);
    await screen.findByLabelText('Shared notes');

    fireEvent.change(screen.getByLabelText('Shared notes'), {
      target: { value: 'Updated shared notes' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockApi.update).toHaveBeenCalledWith('meeting-1', {
        agenda: 'Talk about goals',
        sharedNotes: 'Updated shared notes',
      }),
    );
  });

  it('toggles an action item by calling updateItem', async () => {
    render(<OneOnOneDetailPage />);
    await screen.findByLabelText('Shared notes');

    fireEvent.click(screen.getByLabelText('Mark "Follow up" done'));

    await waitFor(() =>
      expect(mockApi.updateItem).toHaveBeenCalledWith('meeting-1', 'item-1', { isDone: true }),
    );
  });

  it('saves the private note', async () => {
    render(<OneOnOneDetailPage />);
    await screen.findByLabelText('Shared notes');

    fireEvent.change(screen.getByLabelText('Private note — only you can see this'), {
      target: { value: 'updated private note' },
    });
    fireEvent.click(screen.getByText('Save private note'));

    await waitFor(() =>
      expect(mockApi.savePrivateNote).toHaveBeenCalledWith('meeting-1', 'updated private note'),
    );
  });

  it('shows the private note label exactly', async () => {
    render(<OneOnOneDetailPage />);
    expect(await screen.findByText('Private note — only you can see this')).toBeInTheDocument();
  });

  it('offers Complete and Cancel for a scheduled meeting', async () => {
    render(<OneOnOneDetailPage />);
    await screen.findByLabelText('Shared notes');

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Complete'));
    await waitFor(() =>
      expect(mockApi.update).toHaveBeenCalledWith('meeting-1', { status: 'COMPLETED' }),
    );
  });

  it('does not offer status actions for a completed meeting', async () => {
    mockApi.get.mockResolvedValue({ data: detail({ status: 'COMPLETED' }) } as any);
    render(<OneOnOneDetailPage />);
    await screen.findByLabelText('Shared notes');

    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});
