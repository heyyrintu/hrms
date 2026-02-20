'use client';

import { Button } from '@/components/ui/Button';
import { Check, X, Trash2 } from 'lucide-react';

interface BulkApprovalBarProps {
  selectedCount: number;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
  onClearSelection: () => void;
  loading?: boolean;
}

export function BulkApprovalBar({
  selectedCount,
  onApproveSelected,
  onRejectSelected,
  onClearSelection,
  loading = false,
}: BulkApprovalBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-warm-200 shadow-elevated p-3 sm:p-4 z-40 lg:left-[260px] safe-bottom">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-sm font-medium text-warm-900">
            {selectedCount} selected
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClearSelection}
            disabled={loading}
          >
            <Trash2 className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            onClick={onRejectSelected}
            disabled={loading}
            className="flex-1 sm:flex-none"
          >
            <X className="w-4 h-4 sm:mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={onApproveSelected}
            loading={loading}
            className="bg-emerald-600 hover:bg-emerald-700 flex-1 sm:flex-none"
          >
            <Check className="w-4 h-4 sm:mr-1" />
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
