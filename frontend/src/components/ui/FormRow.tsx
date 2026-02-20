import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const colSpanClasses: Record<number, string> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
};

interface FormRowProps {
  children: ReactNode;
  className?: string;
  label?: string;
  required?: boolean;
  colSpan?: number;
  error?: string;
}

export function FormRow({ children, className, label, required, colSpan, error }: FormRowProps) {
  const colSpanClass = colSpan ? colSpanClasses[colSpan] || '' : '';
  return (
    <div className={cn('mb-3 sm:mb-4', colSpanClass, className)}>
      {label && (
        <label className="block text-sm font-medium text-warm-700 mb-1.5">
          {label}
          {required && <span className="text-primary-500 ml-1">*</span>}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
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
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export function FormGrid({ children, cols = 2, className }: FormGridProps) {
  return (
    <div className={cn('grid gap-3 sm:gap-4', colClasses[cols], className)}>
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
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 mt-5 sm:mt-6 pt-4 border-t border-warm-100', className)}>
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
