import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { EmployeeImportService } from './employee-import.service';
import { MulterExceptionFilter } from './multer-error.filter';
import {
  EMPLOYEE_IMPORT_TEMPLATE,
  ImportEmployeesDto,
  ImportEmployeesQueryDto,
  MAX_IMPORT_FILE_SIZE,
} from './dto/import-employees.dto';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees/import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeImportController {
  constructor(private importService: EmployeeImportService) {}

  /**
   * Download the CSV header line to fill in.
   * GET /api/employees/import/template
   */
  @Get('template')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Download the employee import CSV template' })
  @ApiResponse({ status: 200, description: 'CSV template' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="employee-import-template.csv"',
    );
    return res.send(EMPLOYEE_IMPORT_TEMPLATE);
  }

  /**
   * Validate (and optionally create) a CSV of employees.
   * POST /api/employees/import?dryRun=true
   */
  @Post()
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        initialPassword: { type: 'string', minLength: 8 },
      },
    },
  })
  @ApiOperation({
    summary: 'Bulk import employees from a CSV file',
    description:
      'All-or-nothing: if any row is invalid the whole file is rejected with the full error list. Pass dryRun=true to validate without writing.',
  })
  @ApiResponse({ status: 201, description: 'Import result' })
  @ApiResponse({ status: 400, description: 'Invalid file or invalid rows' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  // The filter turns multer's own abort (which happens inside the interceptor,
  // before this handler runs) into a 400 instead of a 500.
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE } }),
  )
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportEmployeesDto,
    @Query() query: ImportEmployeesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('A CSV file is required');
    }
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      throw new BadRequestException(
        `CSV file is larger than ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)} MB`,
      );
    }

    return this.importService.importFromCsv(
      user.tenantId,
      user.userId,
      file.buffer.toString('utf8'),
      { dryRun: query.dryRun === true, initialPassword: dto.initialPassword },
    );
  }
}
