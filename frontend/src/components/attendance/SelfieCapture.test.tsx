import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SelfieCapture } from './SelfieCapture';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

jest.mock('@/lib/api-attendance-capture', () => ({
  attendanceCaptureApi: { uploadSelfie: jest.fn() },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attendanceCaptureApi } = require('@/lib/api-attendance-capture');

/** The button renders at once but is disabled until the stream is live. */
async function readyTakePhoto() {
  const button = await screen.findByRole('button', { name: 'Take photo' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

const setMediaDevices = (value: unknown) =>
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });

describe('SelfieCapture', () => {
  beforeEach(() => {
    // jsdom does not implement media playback.
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    setMediaDevices(undefined);
    jest.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <SelfieCapture open={false} onCancel={jest.fn()} onCaptured={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Camera not available" and a disabled Confirm when there is no camera API', async () => {
    setMediaDevices(undefined);
    render(<SelfieCapture open onCancel={jest.fn()} onCaptured={jest.fn()} />);

    expect(await screen.findByText(/Camera not available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('shows the permission error when the camera is refused', async () => {
    setMediaDevices({ getUserMedia: jest.fn().mockRejectedValue(new Error('denied')) });
    render(<SelfieCapture open onCancel={jest.fn()} onCaptured={jest.fn()} />);

    expect(await screen.findByText(/Camera not available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('captures a frame, uploads it on Confirm and hands back the upload id', async () => {
    const stop = jest.fn();
    setMediaDevices({
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    });
    const drawImage = jest.fn();
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as any);
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    (URL as any).createObjectURL = jest.fn().mockReturnValue('blob:preview');
    (URL as any).revokeObjectURL = jest.fn();
    attendanceCaptureApi.uploadSelfie.mockResolvedValue({ data: { uploadId: 'up-1' } });
    const onCaptured = jest.fn();

    render(<SelfieCapture open onCancel={jest.fn()} onCaptured={onCaptured} />);

    const takePhoto = await readyTakePhoto();
    await act(async () => {
      fireEvent.click(takePhoto);
    });
    expect(drawImage).toHaveBeenCalled();
    expect(screen.getByAltText('Selfie preview')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith('up-1'));
    expect(attendanceCaptureApi.uploadSelfie).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('Retake discards the preview', async () => {
    setMediaDevices({
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }),
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: jest.fn() } as any);
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    (URL as any).createObjectURL = jest.fn().mockReturnValue('blob:preview');
    (URL as any).revokeObjectURL = jest.fn();

    render(<SelfieCapture open onCancel={jest.fn()} onCaptured={jest.fn()} />);
    const takePhoto = await readyTakePhoto();
    await act(async () => {
      fireEvent.click(takePhoto);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    });

    expect(screen.queryByAltText('Selfie preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('Cancel calls onCancel and stops the camera', async () => {
    const stop = jest.fn();
    setMediaDevices({
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    });
    const onCancel = jest.fn();
    render(<SelfieCapture open onCancel={onCancel} onCaptured={jest.fn()} />);
    await readyTakePhoto();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('surfaces an upload failure and does not call onCaptured', async () => {
    setMediaDevices({
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }),
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: jest.fn() } as any);
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    (URL as any).createObjectURL = jest.fn().mockReturnValue('blob:preview');
    (URL as any).revokeObjectURL = jest.fn();
    attendanceCaptureApi.uploadSelfie.mockRejectedValue({
      response: { data: { message: 'Selfie must be 2 MB or smaller' } },
    });
    const onCaptured = jest.fn();

    render(<SelfieCapture open onCancel={jest.fn()} onCaptured={onCaptured} />);
    const takePhoto = await readyTakePhoto();
    await act(async () => {
      fireEvent.click(takePhoto);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(await screen.findByText('Selfie must be 2 MB or smaller')).toBeInTheDocument();
    expect(onCaptured).not.toHaveBeenCalled();
  });
});
