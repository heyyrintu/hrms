import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterExceptionFilter } from '../../employees/import/multer-error.filter';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AttendanceCaptureService } from './attendance-capture.service';

enum SelfieSide {
  in = 'in',
  out = 'out',
}

/** Capture policy and selfies (Keka wave G, WS-A). */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance-capture')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceCaptureController {
  constructor(private readonly capture: AttendanceCaptureService) {}

  @Get('policy')
  @ApiOperation({ summary: 'Punch policy status for the caller (IP verdict, selfie, covering request)' })
  getPolicy(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.capture.getPolicyStatus(user, req.ip);
  }

  @Post('selfie')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload a punch selfie (JPEG/PNG/WebP, max 2 MB)' })
  // Multer aborts an oversized upload before the handler runs; the filter maps it to 400.
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadSelfie(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.capture.uploadSelfie(user, file);
  }

  @Get('selfies/:sessionId/:which')
  @ApiOperation({ summary: 'Stream a session selfie (employee, direct manager, HR)' })
  async getSelfie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Param('which', new ParseEnumPipe(SelfieSide)) which: SelfieSide,
    @Res() res: Response,
  ) {
    const { path, mimeType } = await this.capture.getSelfie(user, sessionId, which);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path);
  }
}
