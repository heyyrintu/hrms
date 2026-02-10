import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  gray: 'bg-warm-100 text-warm-600 ring-1 ring-inset ring-warm-200',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
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
