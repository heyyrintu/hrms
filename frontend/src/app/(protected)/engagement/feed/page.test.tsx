import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EngagementFeedPage from './page';
import { feedApi } from '@/lib/api-feed';

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

const mockHasRole = jest.fn().mockReturnValue(false);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', employeeId: 'emp-1', tenantId: 't1', role: 'EMPLOYEE' },
    hasRole: (...roles: string[]) => mockHasRole(...roles),
  }),
}));

jest.mock('@/lib/api-feed', () => ({
  feedApi: {
    list: jest.fn(),
    react: jest.fn(),
    hide: jest.fn(),
  },
}));

const item1 = {
  id: 'item-1',
  type: 'ANNOUNCEMENT' as const,
  sourceType: 'Announcement',
  sourceId: 'ann-1',
  title: 'Office closed Friday',
  body: 'Enjoy the long weekend',
  payload: {},
  occurredAt: '2026-03-15T12:00:00Z',
  actor: { id: 'emp-1', firstName: 'Ann', lastName: 'Author' },
  subject: null,
  reactionCounts: { LIKE: 2, CELEBRATE: 0 },
  myReactions: [],
};

describe('EngagementFeedPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(false);
  });

  it('renders feed items after loading', async () => {
    (feedApi.list as jest.Mock).mockResolvedValue({ data: { items: [item1], nextCursor: null } });

    render(<EngagementFeedPage />);

    await waitFor(() => {
      expect(screen.getByText('Office closed Friday')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no items', async () => {
    (feedApi.list as jest.Mock).mockResolvedValue({ data: { items: [], nextCursor: null } });

    render(<EngagementFeedPage />);

    await waitFor(() => {
      expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    });
  });

  it('toggles a reaction optimistically and reconciles with the server response', async () => {
    (feedApi.list as jest.Mock).mockResolvedValue({ data: { items: [item1], nextCursor: null } });
    (feedApi.react as jest.Mock).mockResolvedValue({
      data: { reactionCounts: { LIKE: 3, CELEBRATE: 0 }, myReactions: ['LIKE'] },
    });

    render(<EngagementFeedPage />);

    await waitFor(() => expect(screen.getByText('Office closed Friday')).toBeInTheDocument());

    fireEvent.click(screen.getByText('👍 2'));

    await waitFor(() => {
      expect(screen.getByText('👍 3')).toBeInTheDocument();
    });
    expect(feedApi.react).toHaveBeenCalledWith('item-1', 'LIKE');
  });

  it('appends items and updates the cursor on load more', async () => {
    const item2 = { ...item1, id: 'item-2', title: 'Second item' };
    (feedApi.list as jest.Mock)
      .mockResolvedValueOnce({ data: { items: [item1], nextCursor: 'item-1' } })
      .mockResolvedValueOnce({ data: { items: [item2], nextCursor: null } });

    render(<EngagementFeedPage />);

    await waitFor(() => expect(screen.getByText('Office closed Friday')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => {
      expect(screen.getByText('Second item')).toBeInTheDocument();
    });
    expect(feedApi.list).toHaveBeenLastCalledWith('item-1');
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });

  it('shows a Hide button for HR and hides the item on click', async () => {
    mockHasRole.mockReturnValue(true);
    (feedApi.list as jest.Mock).mockResolvedValue({ data: { items: [item1], nextCursor: null } });
    (feedApi.hide as jest.Mock).mockResolvedValue({ data: { success: true } });

    render(<EngagementFeedPage />);

    await waitFor(() => expect(screen.getByText('Office closed Friday')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Hide'));

    await waitFor(() => {
      expect(screen.queryByText('Office closed Friday')).not.toBeInTheDocument();
    });
    expect(feedApi.hide).toHaveBeenCalledWith('item-1');
  });
});
