import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import { MAX_IMPORT_FILE_SIZE } from './dto/import-employees.dto';

const MAX_MB = MAX_IMPORT_FILE_SIZE / (1024 * 1024);

/**
 * Multer aborts an oversized or malformed multipart upload inside the
 * interceptor, before the route handler ever runs, and raises a `MulterError`.
 * Nest has no built-in mapping for it, and this backend installs no global
 * exception filter, so without this the caller gets a 500 for what is squarely
 * a bad request.
 */
export function multerErrorToBadRequest(error: MulterError): BadRequestException {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new BadRequestException(`File exceeds ${MAX_MB} MB`);
    case 'LIMIT_FILE_COUNT':
      return new BadRequestException('Only one file may be uploaded');
    case 'LIMIT_UNEXPECTED_FILE':
      return new BadRequestException(
        `Unexpected file field${error.field ? ` "${error.field}"` : ''}; send the CSV as "file"`,
      );
    default:
      return new BadRequestException(`Upload rejected: ${error.message}`);
  }
}

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter<MulterError> {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const badRequest = multerErrorToBadRequest(error);
    response.status(HttpStatus.BAD_REQUEST).json(badRequest.getResponse());
  }
}
