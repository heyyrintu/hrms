import { assertDocument, assertResume, MAX_UPLOAD_SIZE_BYTES } from './upload-guards';

function file(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'file.bin',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: 10,
    buffer: Buffer.from([]),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
    ...overrides,
  } as Express.Multer.File;
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n...');
const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const DOC_BYTES = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

describe('assertResume', () => {
  it('accepts a real PDF', () => {
    expect(() =>
      assertResume(file({ mimetype: 'application/pdf', buffer: PDF_BYTES, size: PDF_BYTES.length })),
    ).not.toThrow();
  });

  it('accepts a real DOCX', () => {
    expect(() =>
      assertResume(
        file({
          mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: DOCX_BYTES,
          size: DOCX_BYTES.length,
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a real legacy DOC', () => {
    expect(() =>
      assertResume(file({ mimetype: 'application/msword', buffer: DOC_BYTES, size: DOC_BYTES.length })),
    ).not.toThrow();
  });

  it('rejects a missing file', () => {
    expect(() => assertResume(undefined)).toThrow('Resume is required');
  });

  it('rejects an empty file', () => {
    expect(() => assertResume(file({ mimetype: 'application/pdf', buffer: Buffer.from([]), size: 0 }))).toThrow(
      'Resume is required',
    );
  });

  it('rejects a file over the size cap', () => {
    expect(() =>
      assertResume(
        file({
          mimetype: 'application/pdf',
          buffer: PDF_BYTES,
          size: MAX_UPLOAD_SIZE_BYTES + 1,
        }),
      ),
    ).toThrow('5 MB');
  });

  it('rejects a disallowed MIME type even with a valid-looking name', () => {
    expect(() =>
      assertResume(file({ mimetype: 'application/x-msdownload', buffer: EXE_BYTES, size: EXE_BYTES.length })),
    ).toThrow(/must be one of/);
  });

  it('rejects an executable renamed with a PDF MIME type (spoofed header, wrong magic bytes)', () => {
    expect(() =>
      assertResume(file({ mimetype: 'application/pdf', buffer: EXE_BYTES, size: EXE_BYTES.length })),
    ).toThrow(/does not look like a valid/);
  });

  it('rejects a JPEG claiming to be a PDF', () => {
    expect(() =>
      assertResume(file({ mimetype: 'application/pdf', buffer: JPEG_BYTES, size: JPEG_BYTES.length })),
    ).toThrow(/does not look like a valid/);
  });

  it('rejects an image MIME type for a resume', () => {
    expect(() =>
      assertResume(file({ mimetype: 'image/png', buffer: PNG_BYTES, size: PNG_BYTES.length })),
    ).toThrow(/must be one of/);
  });
});

describe('assertDocument', () => {
  it('accepts a real PDF', () => {
    expect(() =>
      assertDocument(file({ mimetype: 'application/pdf', buffer: PDF_BYTES, size: PDF_BYTES.length })),
    ).not.toThrow();
  });

  it('accepts a real JPEG', () => {
    expect(() =>
      assertDocument(file({ mimetype: 'image/jpeg', buffer: JPEG_BYTES, size: JPEG_BYTES.length })),
    ).not.toThrow();
  });

  it('accepts a real PNG', () => {
    expect(() =>
      assertDocument(file({ mimetype: 'image/png', buffer: PNG_BYTES, size: PNG_BYTES.length })),
    ).not.toThrow();
  });

  it('rejects a DOCX for a document upload', () => {
    expect(() =>
      assertDocument(
        file({
          mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: DOCX_BYTES,
          size: DOCX_BYTES.length,
        }),
      ),
    ).toThrow(/must be one of/);
  });

  it('rejects a spoofed MIME type with mismatched magic bytes', () => {
    expect(() =>
      assertDocument(file({ mimetype: 'image/png', buffer: JPEG_BYTES, size: JPEG_BYTES.length })),
    ).toThrow(/does not look like a valid/);
  });

  it('rejects a file over the size cap', () => {
    expect(() =>
      assertDocument(
        file({ mimetype: 'image/png', buffer: PNG_BYTES, size: MAX_UPLOAD_SIZE_BYTES + 1 }),
      ),
    ).toThrow('5 MB');
  });
});
