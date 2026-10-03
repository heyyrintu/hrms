'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { attendanceCaptureApi } from '@/lib/api-attendance-capture';

interface SelfieCaptureProps {
  open: boolean;
  onCancel: () => void;
  /** Called with the upload id once the photo is stored. */
  onCaptured: (uploadId: string) => void;
}

const CAMERA_UNAVAILABLE =
  'Camera not available. Allow camera access in your browser, or use a device with a camera, to clock in.';

/**
 * A modal that takes one front-camera frame, previews it, and uploads it. The
 * punch is only sent after `onCaptured`, so with no camera or permission the
 * employee sees an error and Confirm stays disabled.
 */
export function SelfieCapture({ open, onCancel, onCaptured }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const clearPhoto = useCallback(() => {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setBlob(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(null);
    setUploadError(null);

    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia) {
      setCameraError(CAMERA_UNAVAILABLE);
      return;
    }
    getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setCameraError(CAMERA_UNAVAILABLE);
      });

    return () => {
      cancelled = true;
      stopCamera();
      clearPhoto();
    };
  }, [open, stopCamera, clearPhoto]);

  // The <video> only mounts once the stream exists, so attach it afterwards.
  useEffect(() => {
    const video = videoRef.current;
    if (video && streamRef.current && !blob) {
      video.srcObject = streamRef.current;
      void video.play?.().catch(() => undefined);
    }
  }, [ready, blob]);

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video?.videoWidth || 640;
    canvas.height = video?.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx || !video) {
      setUploadError('Could not read the camera. Try again.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (b) => {
        if (!b) {
          setUploadError('Could not capture the photo. Try again.');
          return;
        }
        setUploadError(null);
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
      },
      'image/jpeg',
      0.85,
    );
  };

  const confirm = async () => {
    if (!blob) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await attendanceCaptureApi.uploadSelfie(blob);
      onCaptured(res.data.uploadId);
    } catch (error: any) {
      setUploadError(error?.response?.data?.message || 'Failed to upload the selfie');
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onCancel} title="Take a selfie" size="md">
      <div className="space-y-3">
        {cameraError ? (
          <p role="alert" className="text-sm text-red-600">
            {cameraError}
          </p>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Selfie preview" className="w-full rounded-lg" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-warm-100" />
        )}
        {uploadError && (
          <p role="alert" className="text-sm text-red-600">
            {uploadError}
          </p>
        )}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
        {previewUrl ? (
          <Button variant="secondary" onClick={clearPhoto} disabled={uploading}>
            Retake
          </Button>
        ) : (
          <Button variant="secondary" onClick={takePhoto} disabled={!ready || !!cameraError}>
            Take photo
          </Button>
        )}
        <Button onClick={confirm} loading={uploading} disabled={!blob || !!cameraError}>
          Confirm
        </Button>
      </ModalFooter>
    </Modal>
  );
}
