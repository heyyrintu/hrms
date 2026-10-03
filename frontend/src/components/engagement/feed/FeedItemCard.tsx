'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getRelativeTime } from '@/lib/date-utils';
import type { FeedItem, FeedReactionKind } from '@/lib/api-feed';
import { EyeOff } from 'lucide-react';

const TYPE_ICON: Record<FeedItem['type'], string> = {
  BIRTHDAY: '🎉',
  WORK_ANNIVERSARY: '🎊',
  ANNOUNCEMENT: '📣',
  RECOGNITION: '👏',
  GOAL_COMPLETED: '🎯',
};

function iconFor(item: FeedItem): string {
  if (item.type === 'RECOGNITION') {
    const badge = (item.payload as { badge?: { icon?: string } } | undefined)?.badge;
    return badge?.icon || '👏';
  }
  return TYPE_ICON[item.type] ?? '📌';
}

function personName(person: FeedItem['actor']): string | null {
  if (!person) return null;
  return `${person.firstName} ${person.lastName}`.trim();
}

interface FeedItemCardProps {
  item: FeedItem;
  canHide?: boolean;
  onReact: (kind: FeedReactionKind) => void;
  onHide?: () => void;
}

export function FeedItemCard({ item, canHide, onReact, onHide }: FeedItemCardProps) {
  const actorName = personName(item.actor);

  return (
    <Card data-testid={`feed-item-${item.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none" aria-hidden>
            {iconFor(item)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-warm-900">{item.title}</p>
            {item.body && <p className="text-sm text-warm-600 mt-1">{item.body}</p>}
            <div className="flex items-center gap-2 mt-1 text-xs text-warm-400">
              {actorName && <span>{actorName}</span>}
              <span>{getRelativeTime(item.occurredAt)}</span>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <Button
                type="button"
                variant={item.myReactions.includes('LIKE') ? 'primary' : 'secondary'}
                onClick={() => onReact('LIKE')}
                className="h-8 px-3 text-sm"
              >
                👍 {item.reactionCounts.LIKE}
              </Button>
              <Button
                type="button"
                variant={item.myReactions.includes('CELEBRATE') ? 'primary' : 'secondary'}
                onClick={() => onReact('CELEBRATE')}
                className="h-8 px-3 text-sm"
              >
                🎉 {item.reactionCounts.CELEBRATE}
              </Button>

              {canHide && onHide && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onHide}
                  className="h-8 px-3 text-sm ml-auto flex items-center gap-1"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
