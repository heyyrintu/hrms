'use client';

import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { attendanceCaptureApi } from '@/lib/api-attendance-capture';

interface SessionSelfieButtonProps {
  sessionId: string;
  which: 'in' | 'out';
}

/**
 * A camera button that fetches one session selfie as a blob (the route needs
 * the bearer token, so it cannot be a plain image URL) and shows it in a modal.
 */
export function SessionSelfieButton({ sessionId, which }: SessionSelfieButtonProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const open = async () => {
    setLoading(true);
    try {
      const res = await attendanceCaptureApi.getSelfie(sessionId, which);
      setUrl(URL.createObjectURL(res.data));
    } catch {
      toast.error('Selfie not available');
    } finally {
      setLoading(false);
    }
  };

  const label = which === 'in' ? 'Clock-in selfie' : 'Clock-out selfie';

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        title={label}
        aria-label={label}
        className="inline-flex items-center gap-0.5 text-xs text-primary-600 hover:underline disabled:opacity-50"
      >
        <Camera className="h-3 w-3" />
        {which === 'in' ? 'In' : 'Out'}
      </button>
      <Modal isOpen={!!url} onClose={() => setUrl(null)} title={label} size="md">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="w-full rounded-lg" />
        )}
      </Modal>
    </>
  );
}
