import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto, DocumentQueryDto } from './dto/document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { memoryStorage } from 'multer';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('employees/:employeeId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  private assertEmployeeAccess(user: AuthenticatedUser, employeeId: string) {
    if (
      user.role === UserRole.EMPLOYEE &&
      user.employeeId !== employeeId
    ) {
      throw new ForbiddenException('You can only access your own documents');
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get employee documents' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: DocumentQueryDto,
  ) {
    this.assertEmployeeAccess(user, employeeId);
    return this.documentsService.getDocuments(user.tenantId, employeeId, query);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.EMPLOYEE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload employee document' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    this.assertEmployeeAccess(user, employeeId);

    return this.documentsService.uploadDocument(
      user.tenantId,
      employeeId,
      file,
      dto,
      user.userId,
    );
  }

  @Get(':docId')
  @ApiOperation({ summary: 'Get document by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('docId') docId: string,
  ) {
    this.assertEmployeeAccess(user, employeeId);
    return this.documentsService.getDocumentById(user.tenantId, docId);
  }

  @Get(':docId/download')
  @ApiOperation({ summary: 'Download document file' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('docId') docId: string,
    @Res() res: Response,
  ) {
    this.assertEmployeeAccess(user, employeeId);

    const { filePath, fileName, mimeType } =
      await this.documentsService.downloadDocument(user.tenantId, docId);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', mimeType);
    res.sendFile(filePath);
  }

  @Post(':docId/verify')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Verify document' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async verifyDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('docId') docId: string,
  ) {
    return this.documentsService.verifyDocument(
      user.tenantId,
      docId,
      user.employeeId || user.userId,
    );
  }

  @Delete(':docId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Delete document' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('docId') docId: string,
  ) {
    return this.documentsService.deleteDocument(user.tenantId, docId);
  }
}
