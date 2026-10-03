'use client';

import { Button } from '@/components/ui/Button';

interface GridPagerProps {
  meta?: { total: number; page: number; limit: number; totalPages: number };
  onPage: (page: number) => void;
}

/** Previous/next over the roster's employee rows; hidden when everything fits one page. */
export function GridPager({ meta, onPage }: GridPagerProps) {
  if (!meta || meta.total <= meta.limit) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-sm text-warm-600">
      <span>{`Page ${meta.page} of ${meta.totalPages} (${meta.total} employees)`}</span>
      <Button
        variant="secondary"
        disabled={meta.page <= 1}
        onClick={() => onPage(meta.page - 1)}
      >
        Previous page
      </Button>
      <Button
        variant="secondary"
        disabled={meta.page >= meta.totalPages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next page
      </Button>
    </div>
  );
}
