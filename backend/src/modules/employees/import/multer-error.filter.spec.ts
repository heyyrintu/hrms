import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import { MulterExceptionFilter, multerErrorToBadRequest } from './multer-error.filter';

function fakeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('MulterExceptionFilter', () => {
  const filter = new MulterExceptionFilter();

  it('maps an oversized upload to a 400 naming the 2 MB limit', () => {
    const { host, status, json } = fakeHost();

    filter.catch(new MulterError('LIMIT_FILE_SIZE', 'file'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: 'File exceeds 2 MB' }),
    );
  });

  it('maps an unexpected file field to a 400 naming the field', () => {
    const { host, json } = fakeHost();

    filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'csv'), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Unexpected file field "csv"; send the CSV as "file"',
      }),
    );
  });

  it('maps every other multer code to a 400 rather than a 500', () => {
    const codes = [
      'LIMIT_PART_COUNT',
      'LIMIT_FILE_COUNT',
      'LIMIT_FIELD_KEY',
      'LIMIT_FIELD_VALUE',
      'LIMIT_FIELD_COUNT',
      'MISSING_FIELD_NAME',
    ] as const;

    for (const code of codes) {
      const mapped = multerErrorToBadRequest(new MulterError(code, 'file'));
      expect(mapped).toBeInstanceOf(BadRequestException);
      expect(mapped.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(typeof (mapped.getResponse() as { message: string }).message).toBe('string');
    }
  });
});
