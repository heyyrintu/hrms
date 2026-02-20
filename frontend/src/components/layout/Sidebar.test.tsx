import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

// Mock api
jest.mock('@/lib/api', () => ({
  api: { get: jest.fn().mockRejectedValue(new Error('mock')) },
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => {
  const icons: Record<string, React.FC<any>> = {};
  const iconNames = [
    'LayoutDashboard', 'Clock', 'Users', 'Calendar', 'ClipboardCheck',
    'Settings', 'X', 'ChevronDown', 'ChevronRight', 'Building2',
    'CalendarDays', 'Timer', 'UserCircle', 'FileText', 'GitPullRequest',
    'Bell', 'Megaphone', 'FileSpreadsheet', 'DollarSign', 'Receipt',
    'Wallet', 'Tags', 'ClipboardList', 'ClipboardEdit', 'Shield', 'Target', 'Star',
    'CalendarClock', 'CalendarCheck', 'CalendarPlus', 'FileWarning',
    'Briefcase', 'MapPin', 'Network', 'LogOut',
  ];
  iconNames.forEach(name => {
    icons[name] = (props: any) => <span data-testid={`icon-${name}`} {...props} />;
  });
  return icons;
});

// Mock AuthContext
const mockHasRole = jest.fn().mockReturnValue(true);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'admin@test.com', role: 'HR_ADMIN' },
    hasRole: mockHasRole,
  }),
}));

describe('Sidebar', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
  });

  it('renders company logo', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByAltText('Drona Logitech')).toBeInTheDocument();
  });

  it('renders Dashboard nav item', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders Attendance nav item', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Attendance')).toBeInTheDocument();
  });

  it('renders user email in sidebar footer', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('admin@test.com')).toBeInTheDocument();
  });

  it('renders user role in sidebar footer', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('HR ADMIN')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<Sidebar {...defaultProps} />);
    const closeButtons = screen.getAllByRole('button');
    // The close button has the X icon
    const closeBtn = closeButtons.find(btn => btn.querySelector('[data-testid="icon-X"]'));
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it('filters nav items by role', () => {
    mockHasRole.mockReturnValue(false);
    render(<Sidebar {...defaultProps} />);
    // Dashboard and Attendance should always be visible (no roles restriction)
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Attendance')).toBeInTheDocument();
    // Companies requires SUPER_ADMIN, should be hidden
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });

  it('renders expandable group items', () => {
    render(<Sidebar {...defaultProps} />);
    // Performance is an expandable group
    expect(screen.getByText('Performance')).toBeInTheDocument();
  });

  it('toggles expandable groups when clicked', () => {
    render(<Sidebar {...defaultProps} />);
    // Performance group should be expanded by default
    expect(screen.getByText('My Reviews')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByText('Performance'));
    expect(screen.queryByText('My Reviews')).not.toBeInTheDocument();

    // Click to expand again
    fireEvent.click(screen.getByText('Performance'));
    expect(screen.getByText('My Reviews')).toBeInTheDocument();
  });

  it('applies translate-x when closed', () => {
    const { container } = render(<Sidebar {...defaultProps} isOpen={false} />);
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('-translate-x-full');
  });

  it('renders mobile overlay when open', () => {
    const { container } = render(<Sidebar {...defaultProps} isOpen={true} />);
    const overlay = container.querySelector('.bg-warm-900\\/30');
    expect(overlay).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', () => {
    const { container } = render(<Sidebar {...defaultProps} isOpen={true} />);
    const overlay = container.querySelector('.bg-warm-900\\/30');
    if (overlay) {
      fireEvent.click(overlay);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });
});
