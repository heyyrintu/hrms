import { Badge } from '@/components/ui/Badge';
import type { PipelineStageCategory } from '@/lib/api-recruitment';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

export const STAGE_CATEGORY_COLORS: Record<PipelineStageCategory, BadgeVariant> = {
  APPLIED: 'gray',
  SCREENING: 'info',
  INTERVIEW: 'warning',
  OFFER: 'info',
  HIRED: 'success',
  REJECTED: 'danger',
};

/** A pipeline stage rendered as a colored badge, keyed off its category. */
export function StageBadge({ name, category }: { name: string; category: PipelineStageCategory }) {
  return <Badge variant={STAGE_CATEGORY_COLORS[category]}>{name}</Badge>;
}

export default StageBadge;
