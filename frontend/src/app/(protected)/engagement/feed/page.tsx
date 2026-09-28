'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FeedItemCard } from '@/components/engagement/feed/FeedItemCard';
import { feedApi, type FeedItem, type FeedReactionKind } from '@/lib/api-feed';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import toast from 'react-hot-toast';

export default function EngagementFeedPage() {
  const { hasRole } = useAuth();
  const canHide = hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await feedApi.list();
      setItems(res.data.items);
      setNextCursor(res.data.nextCursor);
    } catch {
      toast.error('Failed to load the feed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await feedApi.list(nextCursor);
      setItems((prev) => [...prev, ...res.data.items]);
      setNextCursor(res.data.nextCursor);
    } catch {
      toast.error('Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleReact = async (id: string, kind: FeedReactionKind) => {
    const previous = items;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const already = item.myReactions.includes(kind);
        return {
          ...item,
          myReactions: already
            ? item.myReactions.filter((k) => k !== kind)
            : [...item.myReactions, kind],
          reactionCounts: {
            ...item.reactionCounts,
            [kind]: item.reactionCounts[kind] + (already ? -1 : 1),
          },
        };
      }),
    );

    try {
      const res = await feedApi.react(id, kind);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, reactionCounts: res.data.reactionCounts, myReactions: res.data.myReactions }
            : item,
        ),
      );
    } catch {
      setItems(previous);
      toast.error('Failed to react');
    }
  };

  const handleHide = async (id: string) => {
    try {
      await feedApi.hide(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      toast.success('Hidden from the feed');
    } catch {
      toast.error('Failed to hide');
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Feed</h1>
        <p className="text-warm-500">Recognition, announcements and celebrations across the company.</p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-warm-500">Nothing here yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              canHide={canHide}
              onReact={(kind) => handleReact(item.id, kind)}
              onHide={canHide ? () => handleHide(item.id) : undefined}
            />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
