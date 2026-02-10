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
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-40 lg:left-64">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900">
            {selectedCount} request{selectedCount > 1 ? 's' : ''} selected
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClearSelection}
            disabled={loading}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Clear
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            onClick={onRejectSelected}
            disabled={loading}
          >
            <X className="w-4 h-4 mr-1" />
            Reject Selected
          </Button>
          <Button
            size="sm"
            onClick={onApproveSelected}
            loading={loading}
            className="bg-green-600 hover:bg-green-700"
          >
            <Check className="w-4 h-4 mr-1" />
            Approve Selected
          </Button>
        </div>
      </div>
    </div>
  );
}
