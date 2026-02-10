import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FormRowProps {
  children: ReactNode;
  className?: string;
  label?: string;
  required?: boolean;
  colSpan?: number;
}

export function FormRow({ children, className, label, required, colSpan }: FormRowProps) {
  const colSpanClass = colSpan ? `md:col-span-${colSpan}` : '';
  return (
    <div className={cn('mb-4', colSpanClass, className)}>
      {label && (
        <label className="block text-sm font-medium text-warm-700 mb-1.5">
          {label}
          {required && <span className="text-primary-500 ml-1">*</span>}
        </label>
      )}
      {children}
    </div>
  );
}

interface FormGridProps {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}

const colClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
};

export function FormGrid({ children, cols = 2, className }: FormGridProps) {
  return (
    <div className={cn('grid gap-4', colClasses[cols], className)}>
      {children}
    </div>
  );
}

interface FormActionsProps {
  children: ReactNode;
  className?: string;
}

export function FormActions({ children, className }: FormActionsProps) {
  return (
    <div className={cn('flex justify-end gap-3 mt-6 pt-4 border-t border-warm-100', className)}>
      {children}
    </div>
  );
}

interface FormErrorProps {
  message?: string;
  className?: string;
}

export function FormError({ message, className }: FormErrorProps) {
  if (!message) return null;

  return (
    <div className={cn('p-3 rounded-lg bg-red-50 border border-red-200', className)}>
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

interface FormSuccessProps {
  message?: string;
  className?: string;
}

export function FormSuccess({ message, className }: FormSuccessProps) {
  if (!message) return null;

  return (
    <div className={cn('p-3 rounded-lg bg-emerald-50 border border-emerald-200', className)}>
      <p className="text-sm text-emerald-700">{message}</p>
    </div>
  );
}
