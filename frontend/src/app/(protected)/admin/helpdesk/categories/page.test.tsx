import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HelpdeskCategoriesPage from './page';
import { helpdeskApi } from '@/lib/api-helpdesk';
import toast from 'react-hot-toast';

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

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <label>
      {label}
      <input aria-label={label} {...props} />
    </label>
  ),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api-helpdesk', () => {
  const actual = jest.requireActual('@/lib/api-helpdesk');
  return {
    ...actual,
    helpdeskApi: {
      getCategories: jest.fn(),
      createCategory: jest.fn(),
      updateCategory: jest.fn(),
    },
  };
});

const mockApi = helpdeskApi as jest.Mocked<typeof helpdeskApi>;

const category = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  name: 'Payroll',
  code: 'PAY',
  description: 'Pay related queries',
  slaHours: 48,
  isActive: true,
  ...overrides,
});

describe('HelpdeskCategoriesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCategories.mockResolvedValue({ data: [category()] } as any);
    mockApi.createCategory.mockResolvedValue({ data: category({ id: 'cat-2' }) } as any);
    mockApi.updateCategory.mockResolvedValue({ data: category() } as any);
  });

  it('lists categories including the inactive ones', async () => {
    mockApi.getCategories.mockResolvedValue({
      data: [
        category(),
        category({ id: 'cat-2', name: 'IT support', code: 'ITS', isActive: false }),
      ],
    } as any);

    render(<HelpdeskCategoriesPage />);

    expect(await screen.findByText('Payroll')).toBeInTheDocument();
    expect(screen.getByText('IT support')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(mockApi.getCategories).toHaveBeenCalledWith(true);
  });

  it('shows the empty state before anything is configured', async () => {
    mockApi.getCategories.mockResolvedValue({ data: [] } as any);

    render(<HelpdeskCategoriesPage />);

    expect(
      await screen.findByText(
        'No categories yet. Add one before employees can raise tickets.',
      ),
    ).toBeInTheDocument();
  });

  it('creates a category with the SLA as a number', async () => {
    render(<HelpdeskCategoriesPage />);
    await screen.findByText('Payroll');

    fireEvent.click(screen.getByText('New category'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'IT support' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'IT' } });
    fireEvent.change(screen.getByLabelText('SLA hours'), { target: { value: '24' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockApi.createCategory).toHaveBeenCalledWith({
        name: 'IT support',
        code: 'IT',
        description: undefined,
        slaHours: 24,
        isActive: true,
      }),
    );
  });

  it('edits an existing category through the update endpoint', async () => {
    render(<HelpdeskCategoriesPage />);
    await screen.findByText('Payroll');

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('SLA hours'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockApi.updateCategory).toHaveBeenCalledWith(
        'cat-1',
        expect.objectContaining({ slaHours: 12, code: 'PAY' }),
      ),
    );
    expect(mockApi.createCategory).not.toHaveBeenCalled();
  });

  it('refuses a category with no name or code', async () => {
    render(<HelpdeskCategoriesPage />);
    await screen.findByText('Payroll');

    fireEvent.click(screen.getByText('New category'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Name and code are required'),
    );
    expect(mockApi.createCategory).not.toHaveBeenCalled();
  });

  it('refuses a non-positive SLA', async () => {
    render(<HelpdeskCategoriesPage />);
    await screen.findByText('Payroll');

    fireEvent.click(screen.getByText('New category'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'IT' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'IT' } });
    fireEvent.change(screen.getByLabelText('SLA hours'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('SLA hours must be a positive number'),
    );
    expect(mockApi.createCategory).not.toHaveBeenCalled();
  });

  it('reports a duplicate code from the server', async () => {
    mockApi.createCategory.mockRejectedValue({ response: { status: 409 } });

    render(<HelpdeskCategoriesPage />);
    await screen.findByText('Payroll');

    fireEvent.click(screen.getByText('New category'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Payroll 2' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'PAY' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('That code is already in use'),
    );
  });
});
