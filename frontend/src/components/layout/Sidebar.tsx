'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Clock,
  Users,
  Calendar,
  ClipboardCheck,
  Settings,
  X,
  ChevronDown,
  ChevronRight,
  Building2,
  CalendarDays,
  Timer,
  UserCircle,
  FileText,
  GitPullRequest,
  Bell,
  Megaphone,
  FileSpreadsheet,
  DollarSign,
  Receipt,
  Wallet,
  Tags,
  ClipboardList,
  ClipboardEdit,
  Shield,
  Target,
  Star,
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  FileWarning,
  Briefcase,
  MapPin,
  Network,
  LogOut,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface NavItem {
  name: string;
  href?: string;
  icon: React.ReactNode;
  roles?: UserRole[];
  children?: NavItem[];
}

const navigation: NavItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard className="h-[18px] w-[18px]" />
  },
  {
    name: 'Attendance',
    icon: <Clock className="h-[18px] w-[18px]" />,
    children: [
      { name: 'My Attendance', href: '/attendance', icon: <Clock className="h-4 w-4" /> },
      { name: 'Regularization', href: '/attendance/regularization', icon: <ClipboardEdit className="h-4 w-4" /> },
    ],
  },
  {
    name: 'Employees',
    href: '/employees',
    icon: <Users className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER]
  },
  {
    name: 'Org Chart',
    href: '/org-chart',
    icon: <Network className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER]
  },
  {
    name: 'Leave',
    href: '/leave',
    icon: <Calendar className="h-[18px] w-[18px]" />
  },
  {
    name: 'Comp-Off',
    href: '/leave/comp-off',
    icon: <CalendarPlus className="h-[18px] w-[18px]" />
  },
  {
    name: 'Payroll',
    icon: <DollarSign className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN],
    children: [
      { name: 'Payroll Runs', href: '/payroll', icon: <DollarSign className="h-4 w-4" /> },
      { name: 'Employee Payslips', href: '/payroll/payslips', icon: <Receipt className="h-4 w-4" /> },
    ],
  },
  {
    name: 'My Payslips',
    href: '/my-payslips',
    icon: <Receipt className="h-[18px] w-[18px]" />
  },
  {
    name: 'Expenses',
    href: '/expenses',
    icon: <Wallet className="h-[18px] w-[18px]" />
  },
  {
    name: 'Exit Management',
    href: '/exit-management',
    icon: <LogOut className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN],
  },
  {
    name: 'Onboarding',
    href: '/onboarding',
    icon: <ClipboardList className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN],
  },
  {
    name: 'My Onboarding',
    href: '/onboarding/my-tasks',
    icon: <ClipboardList className="h-[18px] w-[18px]" />
  },
  {
    name: 'Notifications',
    href: '/notifications',
    icon: <Bell className="h-[18px] w-[18px]" />
  },
  {
    name: 'My Letters',
    href: '/my-letters',
    icon: <FileText className="h-[18px] w-[18px]" />
  },
  {
    name: 'My Profile',
    href: '/my-profile',
    icon: <UserCircle className="h-[18px] w-[18px]" />
  },
  {
    name: 'Performance',
    icon: <Target className="h-[18px] w-[18px]" />,
    children: [
      { name: 'My Reviews', href: '/performance', icon: <Star className="h-4 w-4" /> },
      { name: 'Team Reviews', href: '/performance/team', icon: <Users className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER] },
      { name: 'Review Cycles', href: '/performance/cycles', icon: <Target className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN] },
    ],
  },
  {
    name: 'Approvals',
    icon: <ClipboardCheck className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER],
    children: [
      { name: 'OT Approvals', href: '/approvals/ot', icon: <Clock className="h-4 w-4" /> },
      { name: 'Leave Approvals', href: '/approvals/leave', icon: <Calendar className="h-4 w-4" /> },
      { name: 'Change Requests', href: '/approvals/change-requests', icon: <GitPullRequest className="h-4 w-4" />, roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN] },
      { name: 'Expense Claims', href: '/approvals/expenses', icon: <Wallet className="h-4 w-4" /> },
      { name: 'Comp-Off', href: '/approvals/comp-off', icon: <CalendarPlus className="h-4 w-4" /> },
      { name: 'Regularization', href: '/approvals/regularization', icon: <ClipboardEdit className="h-4 w-4" /> },
    ]
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: <FileSpreadsheet className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER],
  },
  {
    name: 'Companies',
    href: '/companies',
    icon: <Building2 className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN],
  },
  {
    name: 'Admin',
    icon: <Settings className="h-[18px] w-[18px]" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN],
    children: [
      { name: 'Departments', href: '/admin/departments', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Designations', href: '/admin/designations', icon: <Briefcase className="h-4 w-4" /> },
      { name: 'Branches', href: '/admin/branches', icon: <MapPin className="h-4 w-4" /> },
      { name: 'OT Rules', href: '/admin/ot-rules', icon: <Clock className="h-4 w-4" /> },
      { name: 'Holidays', href: '/admin/holidays', icon: <CalendarDays className="h-4 w-4" /> },
      { name: 'Shifts', href: '/admin/shifts', icon: <Timer className="h-4 w-4" /> },
      { name: 'Leave Types', href: '/admin/leave-types', icon: <FileText className="h-4 w-4" /> },
      { name: 'Leave Balances', href: '/admin/leave-balances', icon: <Calendar className="h-4 w-4" /> },
      { name: 'Accrual Rules', href: '/admin/accrual-rules', icon: <CalendarClock className="h-4 w-4" /> },
      { name: 'Accrual History', href: '/admin/accrual-history', icon: <CalendarCheck className="h-4 w-4" /> },
      { name: 'Announcements', href: '/admin/announcements', icon: <Megaphone className="h-4 w-4" /> },
      { name: 'Expense Categories', href: '/admin/expense-categories', icon: <Tags className="h-4 w-4" /> },
      { name: 'Onboarding Templates', href: '/admin/onboarding-templates', icon: <ClipboardList className="h-4 w-4" /> },
      { name: 'Document Expiry', href: '/admin/document-expiry', icon: <FileWarning className="h-4 w-4" /> },
      { name: 'Letters', href: '/admin/letters', icon: <FileText className="h-4 w-4" /> },
      { name: 'Audit Logs', href: '/admin/audit', icon: <Shield className="h-4 w-4" /> },
    ]
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, hasRole } = useAuth();
  const [expandedItems, setExpandedItems] = useState<string[]>(['Attendance', 'Performance', 'Approvals', 'Admin', 'Payroll']);
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
    api.get('/tenant-info')
      .then((r) => {
        // Compute absolute URL for the public logo endpoint (no auth required)
        setTenantLogoUrl(r.data.logoUrl ? `${base}/companies/${r.data.id}/logo` : null);
        setTenantName(r.data.name ?? null);
      })
      .catch(() => { /* fallback to static logo */ });
  }, [user]);

  const toggleExpand = (name: string) => {
    setExpandedItems(prev =>
      prev.includes(name)
        ? prev.filter(item => item !== name)
        : [...prev, name]
    );
  };

  const filteredNavigation = navigation.filter((item) => {
    if (!item.roles) return true;
    return hasRole(...item.roles);
  });

  const isActive = (href?: string) => {
    if (!href) return false;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderNavItem = (item: NavItem, isChild = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const active = isActive(item.href);

    // Filter children by role
    const filteredChildren = item.children?.filter(child => {
      if (!child.roles) return true;
      return hasRole(...child.roles);
    });

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpand(item.name)}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 sm:py-2 text-sm sm:text-[13px] font-medium transition-all duration-150',
              'text-warm-600 hover:bg-warm-100 hover:text-warm-900'
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-warm-400">{item.icon}</span>
              {item.name}
            </div>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-warm-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-warm-400" />
            )}
          </button>
          {isExpanded && filteredChildren && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-warm-200 pl-3">
              {filteredChildren.map(child => renderNavItem(child, true))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.name}
        href={item.href || '#'}
        onClick={() => {
          if (window.innerWidth < 1024) {
            onClose();
          }
        }}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 sm:py-2 text-sm sm:text-[13px] font-medium transition-all duration-150',
          active
            ? 'bg-primary-50 text-primary-700 shadow-soft'
            : 'text-warm-600 hover:bg-warm-100 hover:text-warm-900',
          isChild && 'text-sm sm:text-[13px] py-2 sm:py-1.5'
        )}
      >
        <span className={cn(
          active ? 'text-primary-500' : 'text-warm-400'
        )}>
          {item.icon}
        </span>
        {item.name}
        {active && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-500" />
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-warm-900/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-white border-r border-warm-200',
          'transition-transform duration-300 ease-out lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-warm-200 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            {tenantLogoUrl ? (
              <img
                src={tenantLogoUrl}
                alt={tenantName ?? 'Company'}
                className="h-10 w-auto object-contain max-w-[160px]"
              />
            ) : (
              <img
                src="/logo.png"
                alt="Drona Logitech"
                className="h-10 w-auto object-contain"
              />
            )}
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-3 sm:py-4">
          {filteredNavigation.map(item => renderNavItem(item))}
        </nav>

        {/* User info */}
        <div className="border-t border-warm-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-accent-100 ring-2 ring-white shadow-soft">
              <span className="text-primary-700 font-semibold text-sm">
                {user?.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-warm-800 truncate">{user?.email}</p>
              <p className="text-xs text-warm-400 font-medium">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
