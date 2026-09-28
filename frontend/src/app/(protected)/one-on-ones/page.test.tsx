import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OneOnOnesPage from './page';
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

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
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
      list: jest.fn(),
      create: jest.fn(),
      counterparts: jest.fn(),
    },
  };
});

const mockApi = oneOnOnesApi as jest.Mocked<typeof oneOnOnesApi>;

const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: 'meeting-1',
  managerId: 'emp-mgr',
  employeeId: 'emp-1',
  scheduledAt: '2099-03-15T12:00:00.000Z',
  status: 'SCHEDULED',
  agenda: null,
  sharedNotes: null,
  createdById: 'emp-mgr',
  completedAt: null,
  createdAt: '2026-03-01T12:00:00.000Z',
  updatedAt: '2026-03-01T12:00:00.000Z',
  myRole: 'MANAGER',
  counterpart: { id: 'emp-1', firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1' },
  ...overrides,
});

describe('OneOnOnesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.list.mockResolvedValue({ data: [] } as any);
    mockApi.counterparts.mockResolvedValue({
      data: [{ id: 'emp-1', firstName: 'Eve', lastName: 'Employee', employeeCode: 'E-1', relation: 'REPORT' }],
    } as any);
    mockApi.create.mockResolvedValue({ data: { id: 'meeting-2' } } as any);
  });

  it('groups meetings into upcoming and past by scheduledAt', async () => {
    mockApi.list.mockResolvedValue({
      data: [
        meeting({ id: 'future-1', scheduledAt: '2099-01-01T00:00:00.000Z' }),
        meeting({
          id: 'past-1',
          scheduledAt: '2020-01-01T00:00:00.000Z',
          status: 'COMPLETED',
          counterpart: { id: 'emp-2', firstName: 'Past', lastName: 'Person', employeeCode: 'E-2' },
        }),
      ],
    } as any);

    render(<OneOnOnesPage />);

    const upcomingHeading = await screen.findByText('Upcoming');
    const pastHeading = screen.getByText('Past');

    // "Eve Employee" (future) sits under Upcoming, "Past Person" under Past.
    expect(upcomingHeading.parentElement?.textContent).toContain('Eve Employee');
    expect(pastHeading.parentElement?.textContent).toContain('Past Person');
  });

  it('shows empty states for both groups when there are no meetings', async () => {
    render(<OneOnOnesPage />);

    expect(await screen.findByText('No upcoming one-on-ones.')).toBeInTheDocument();
    expect(screen.getByText('No past one-on-ones yet.')).toBeInTheDocument();
  });

  it('schedules a one-on-one from the modal and posts the DTO', async () => {
    render(<OneOnOnesPage />);
    await screen.findByText('No upcoming one-on-ones.');

    fireEvent.click(screen.getByText('Schedule one-on-one'));

    fireEvent.change(screen.getByLabelText('With'), { target: { value: 'emp-1' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2099-03-15T12:00' } });
    fireEvent.change(screen.getByLabelText('Agenda (optional)'), { target: { value: 'Career growth' } });

    fireEvent.click(screen.getByText('Schedule'));

    await screen.findByText('Schedule one-on-one', { selector: 'h2' }).catch(() => undefined);

    expect(mockApi.create).toHaveBeenCalledWith({
      counterpartId: 'emp-1',
      scheduledAt: new Date('2099-03-15T12:00').toISOString(),
      agenda: 'Career growth',
    });
  });
});
