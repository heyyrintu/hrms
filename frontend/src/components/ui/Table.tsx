import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-warm-200 scroll-shadow', className)}>
      <table className="min-w-full divide-y divide-warm-200">
        {children}
      </table>
    </div>
  );
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

export function TableHeader({ children, className }: TableHeaderProps) {
  return (
    <thead className={cn('bg-warm-50', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={cn('divide-y divide-warm-100 bg-white', className)}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function TableRow({ children, className, onClick }: TableRowProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        onClick && 'cursor-pointer hover:bg-warm-50 active:bg-warm-100',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps {
  children?: ReactNode;
  className?: string;
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <th
      className={cn(
        'px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-semibold text-warm-500 uppercase tracking-wider',
        className
      )}
    >
      {children}
    </th>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
}

export function TableCell({ children, className }: TableCellProps) {
  return (
    <td className={cn('px-3 sm:px-4 py-2.5 sm:py-3 text-sm text-warm-800', className)}>
      {children}
    </td>
  );
}

interface EmptyStateProps {
  message?: string;
  colSpan?: number;
}

export function TableEmptyState({ message = 'No data found', colSpan = 1 }: EmptyStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-warm-400">
        <p className="text-sm">{message}</p>
      </td>
    </tr>
  );
}

interface LoadingStateProps {
  colSpan?: number;
}

export function TableLoadingState({ colSpan = 1 }: LoadingStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        <div className="flex items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <span className="ml-2.5 text-sm text-warm-500">Loading...</span>
        </div>
      </td>
    </tr>
  );
}
