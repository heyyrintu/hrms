import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-primary-100 text-primary-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  gray: 'bg-gray-100 text-gray-800',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}

// Helper function to get badge variant from status
export function getStatusBadgeVariant(status: string): BadgeVariant {
  const statusLower = status.toLowerCase();
  
  if (['present', 'approved', 'active', 'success'].includes(statusLower)) {
    return 'success';
  }
  if (['pending', 'wfh', 'half_day'].includes(statusLower)) {
    return 'warning';
  }
  if (['absent', 'rejected', 'cancelled', 'inactive', 'error'].includes(statusLower)) {
    return 'danger';
  }
  if (['leave', 'holiday'].includes(statusLower)) {
    return 'info';
  }
  return 'gray';
}
