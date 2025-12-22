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
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { cn } from '@/lib/utils';

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
    icon: <LayoutDashboard className="h-5 w-5" /> 
  },
  { 
    name: 'Attendance', 
    href: '/attendance', 
    icon: <Clock className="h-5 w-5" /> 
  },
  { 
    name: 'Employees', 
    href: '/employees', 
    icon: <Users className="h-5 w-5" />, 
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER] 
  },
  { 
    name: 'Leave', 
    href: '/leave', 
    icon: <Calendar className="h-5 w-5" /> 
  },
  { 
    name: 'Approvals', 
    icon: <ClipboardCheck className="h-5 w-5" />,
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER],
    children: [
      { name: 'OT Approvals', href: '/approvals/ot', icon: <Clock className="h-4 w-4" /> },
      { name: 'Leave Approvals', href: '/approvals/leave', icon: <Calendar className="h-4 w-4" /> },
    ]
  },
  { 
    name: 'Admin', 
    icon: <Settings className="h-5 w-5" />, 
    roles: [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN],
    children: [
      { name: 'OT Rules', href: '/admin/ot-rules', icon: <Clock className="h-4 w-4" /> },
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
  const [expandedItems, setExpandedItems] = useState<string[]>(['Approvals', 'Admin']);

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
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'text-gray-300 hover:bg-gray-800 hover:text-white'
            )}
          >
            <div className="flex items-center gap-3">
              {item.icon}
              {item.name}
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {isExpanded && filteredChildren && (
            <div className="ml-4 mt-1 space-y-1">
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
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-primary-600 text-white'
            : 'text-gray-300 hover:bg-gray-800 hover:text-white',
          isChild && 'text-sm'
        )}
      >
        {item.icon}
        {item.name}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gray-900 transition-transform duration-300 lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-gray-800 px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">H</span>
            </div>
            <span className="text-xl font-bold text-white">HRMS</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {filteredNavigation.map(item => renderNavItem(item))}
        </nav>

        {/* User info */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary-600 flex items-center justify-center">
              <span className="text-white font-medium">
                {user?.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.email}</p>
              <p className="text-xs text-gray-400">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
