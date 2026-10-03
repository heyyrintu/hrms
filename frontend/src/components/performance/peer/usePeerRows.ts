import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { peerApi, type PeerRow } from '@/lib/api-performance-peer';

export function usePeerRows(reviewId: string) {
  const [rows, setRows] = useState<PeerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await peerApi.listForReview(reviewId);
      setRows(res.data);
    } catch {
      setError(true);
      toast.error('Failed to load peers');
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, error, reload };
}

export function errorMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}
