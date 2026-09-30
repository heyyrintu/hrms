import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BadgeManager } from './BadgeManager';
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

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/lib/api-recognition', () => ({
  recognitionApi: {
    badges: jest.fn(),
    createBadge: jest.fn(),
    updateBadge: jest.fn(),
    deactivateBadge: jest.fn(),
    reactivateBadge: jest.fn(),
  },
}));

const badges = [
  { id: 'b-1', name: 'Team Player', icon: '🤝', points: 10, isActive: true },
  { id: 'b-2', name: 'Old One', icon: '🗑️', points: 5, isActive: false },
];

describe('BadgeManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recognitionApi.badges as jest.Mock).mockResolvedValue({ data: { data: badges } });
    (recognitionApi.createBadge as jest.Mock).mockResolvedValue({ data: { id: 'b-3' } });
  });

  it('lists badges including inactive ones', async () => {
    render(<BadgeManager />);

    await waitFor(() => expect(screen.getByTestId('badge-b-1')).toBeInTheDocument());
    expect(screen.getByTestId('badge-b-2')).toBeInTheDocument();
    expect(screen.getByText(/inactive/)).toBeInTheDocument();
  });

  it('creates a badge from the form', async () => {
    render(<BadgeManager />);
    await waitFor(() => expect(screen.getByTestId('badge-b-1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('New Badge'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rising Star' } });
    fireEvent.change(screen.getByLabelText('Icon (an emoji)'), { target: { value: '⭐' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(recognitionApi.createBadge).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Rising Star', icon: '⭐' }),
      ),
    );
  });

  it('offers Reactivate only on inactive badges and reactivates then reloads', async () => {
    (recognitionApi.reactivateBadge as jest.Mock).mockResolvedValue({ data: {} });
    render(<BadgeManager />);
    await waitFor(() => expect(screen.getByTestId('badge-b-2')).toBeInTheDocument());

    expect(screen.getAllByRole('button', { name: 'Reactivate' })).toHaveLength(1);
    const inactiveCard = screen.getByTestId('badge-b-2');
    const activeCard = screen.getByTestId('badge-b-1');
    expect(inactiveCard).toContainElement(screen.getByRole('button', { name: 'Reactivate' }));
    expect(activeCard).not.toHaveTextContent('Reactivate');

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(recognitionApi.reactivateBadge).toHaveBeenCalledWith('b-2'));
    await waitFor(() => expect(recognitionApi.badges).toHaveBeenCalledTimes(2));
  });

  it('deactivates an active badge', async () => {
    render(<BadgeManager />);
    await waitFor(() => expect(screen.getByTestId('badge-b-1')).toBeInTheDocument());

    const card = screen.getByTestId('badge-b-1');
    fireEvent.click(card.querySelectorAll('button')[1]);

    await waitFor(() => expect(recognitionApi.deactivateBadge).toHaveBeenCalledWith('b-1'));
  });
});
