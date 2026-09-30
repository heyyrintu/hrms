import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GiveRecognitionModal } from './GiveRecognitionModal';
import { employeesApi } from '@/lib/api';
import { recognitionApi } from '@/lib/api-recognition';

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

jest.mock('@/contexts/AuthContext', () => ({
  // The REAL stored-user shape: the employee id is nested, never top-level.
  useAuth: () => ({
    user: { id: 'u-1', tenantId: 't1', role: 'EMPLOYEE', employee: { id: 'emp-self' } },
  }),
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, ...props }: any) => (
    <label>
      {label}
      <input aria-label={label ?? props.id} {...props} />
    </label>
  ),
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ options, placeholder, ...props }: any) => (
    <select {...props}>
      <option value="">{placeholder}</option>
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-recognition', () => ({
  recognitionApi: {
    badges: jest.fn(),
    me: jest.fn(),
    give: jest.fn(),
  },
}));

const employees = [
  { id: 'emp-self', firstName: 'Me', lastName: 'Self', employeeCode: 'E0' },
  { id: 'r-1', firstName: 'Alice', lastName: 'A', employeeCode: 'E1' },
  { id: 'r-2', firstName: 'Bob', lastName: 'B', employeeCode: 'E2' },
];

describe('GiveRecognitionModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (employeesApi.getAll as jest.Mock).mockResolvedValue({ data: { data: employees } });
    (recognitionApi.badges as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 'b-1', name: 'Team Player', icon: '🤝', points: 10, isActive: true }] },
    });
    (recognitionApi.me as jest.Mock).mockResolvedValue({
      data: { pointsEnabled: false, remainingThisMonth: 40 },
    });
    (recognitionApi.give as jest.Mock).mockResolvedValue({ data: { id: 'rec-1' } });
  });

  it('excludes the current employee from the recipient list', async () => {
    render(<GiveRecognitionModal isOpen onClose={jest.fn()} onGiven={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('employee-option-r-1')).toBeInTheDocument());
    expect(screen.queryByTestId('employee-option-emp-self')).not.toBeInTheDocument();
  });

  it('hides the points input when points are disabled', async () => {
    render(<GiveRecognitionModal isOpen onClose={jest.fn()} onGiven={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('employee-option-r-1')).toBeInTheDocument());
    expect(screen.queryByLabelText('Points per recipient')).not.toBeInTheDocument();
  });

  it('shows the points input and remaining allowance when points are enabled', async () => {
    (recognitionApi.me as jest.Mock).mockResolvedValue({
      data: { pointsEnabled: true, remainingThisMonth: 40 },
    });

    render(<GiveRecognitionModal isOpen onClose={jest.fn()} onGiven={jest.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Points per recipient')).toBeInTheDocument());
    expect(screen.getByText(/40 points left this month/)).toBeInTheDocument();
  });

  it('submits the give DTO with selected recipients and message', async () => {
    const onGiven = jest.fn();
    render(<GiveRecognitionModal isOpen onClose={jest.fn()} onGiven={onGiven} />);

    await waitFor(() => expect(screen.getByTestId('employee-option-r-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('employee-option-r-1').querySelector('input')!);
    fireEvent.change(screen.getByPlaceholderText('What did they do?'), {
      target: { value: 'Great work on the release' },
    });
    fireEvent.click(screen.getByText('Send Recognition'));

    await waitFor(() =>
      expect(recognitionApi.give).toHaveBeenCalledWith({
        recipientIds: ['r-1'],
        message: 'Great work on the release',
        badgeId: undefined,
        points: undefined,
      }),
    );
    expect(onGiven).toHaveBeenCalled();
  });
});
