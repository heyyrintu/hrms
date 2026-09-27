import { BadRequestException } from '@nestjs/common';

/**
 * Type + size checks for the two public upload surfaces (Keka wave D, WS-D3):
 * careers-page resumes and pre-onboarding documents.
 *
 * The MIME type on a multipart upload is whatever the browser/client claims —
 * trivial to spoof. We also check the file's magic bytes so a renamed
 * `.exe` cannot ride in as a "PDF" just because the client set the header.
 * Both the declared MIME type and the magic bytes must agree with an
 * allowed kind; either one being wrong is rejected with a plain message
 * (no internal detail — this runs on an unauthenticated route).
 */

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

type FileKind = 'pdf' | 'doc' | 'docx' | 'jpeg' | 'png';

const MIME_TO_KINDS: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
};

/**
 * Magic-byte signatures. DOCX is a zip container, so it shares the `PK\x03\x04`
 * signature with any other Office Open XML / zip-based file — acceptable here
 * because the MIME type must also match `docx` and the file is never executed,
 * only stored and later downloaded by HR.
 */
function matchesSignature(buffer: Buffer, kind: FileKind): boolean {
  if (buffer.length < 4) return false;
  switch (kind) {
    case 'pdf':
      return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'doc':
      // OLE2 compound file header (also used by legacy .xls/.ppt).
      return (
        buffer[0] === 0xd0 &&
        buffer[1] === 0xcf &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xe0
      );
    case 'docx':
      return (
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x03 &&
        buffer[3] === 0x04
      );
    case 'jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );
    default:
      return false;
  }
}

function assertFile(
  file: Express.Multer.File | undefined | null,
  allowedMimeTypes: readonly string[],
  what: string,
): void {
  if (!file || !file.buffer || file.size === 0) {
    throw new BadRequestException(`${what} is required`);
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new BadRequestException(`${what} must be 5 MB or smaller`);
  }
  const kind = MIME_TO_KINDS[file.mimetype];
  if (!kind || !allowedMimeTypes.includes(file.mimetype)) {
    throw new BadRequestException(`${what} must be one of: ${allowedMimeTypes.join(', ')}`);
  }
  if (!matchesSignature(file.buffer, kind)) {
    throw new BadRequestException(`${what} does not look like a valid ${kind.toUpperCase()} file`);
  }
}

const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Careers-page resume upload: PDF, DOC or DOCX, ≤ 5 MB. */
export function assertResume(file: Express.Multer.File | undefined | null): void {
  assertFile(file, RESUME_MIME_TYPES, 'Resume');
}

/** Pre-onboarding document upload: PDF, JPEG or PNG, ≤ 5 MB. */
export function assertDocument(file: Express.Multer.File | undefined | null): void {
  assertFile(file, DOCUMENT_MIME_TYPES, 'Document');
}
