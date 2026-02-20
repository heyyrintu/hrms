'use client';

import { SalaryStructure } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

interface SalaryStructureSelectorProps {
  structures: SalaryStructure[];
  selectedId: string;
  onChange: (structureId: string) => void;
  loading?: boolean;
  className?: string;
}

export function SalaryStructureSelector({
  structures,
  selectedId,
  onChange,
  loading,
  className,
}: SalaryStructureSelectorProps) {
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-4', className)}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (structures.length === 0) {
    return (
      <div className={cn('text-center py-4 text-warm-500 text-sm', className)}>
        <p>No salary structures available</p>
        <p className="text-xs mt-1">Create a salary structure first</p>
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-3', className)}>
      {structures.map((structure) => (
        <button
          key={structure.id}
          type="button"
          onClick={() => onChange(structure.id)}
          className={cn(
            'p-4 border-2 rounded-lg text-left transition-all',
            selectedId === structure.id
              ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-200'
              : 'border-warm-200 hover:border-warm-300 hover:bg-warm-50'
          )}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="font-medium text-warm-900">{structure.name}</p>
              {structure.description && (
                <p className="text-xs text-warm-500 mt-1">{structure.description}</p>
              )}
            </div>
            {selectedId === structure.id && (
              <div className="ml-2">
                <div className="h-5 w-5 rounded-full bg-primary-600 flex items-center justify-center">
                  <svg
                    className="h-3 w-3 text-white"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-warm-400">
            <span>{structure.components.length} component{structure.components.length !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>{structure.components.filter(c => c.type === 'earning').length} earnings</span>
            <span>•</span>
            <span>{structure.components.filter(c => c.type === 'deduction').length} deductions</span>
          </div>
        </button>
      ))}
    </div>
  );
}
