import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('document-expiry')
@ApiBearerAuth()
@Controller('employees/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class DocumentExpiryController {
  constructor(private documentsService: DocumentsService) {}

  @Get('expiring')
  @ApiOperation({ summary: 'Get documents expiring within N days' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Days ahead to check (default 30)' })
  @ApiResponse({ status: 200, description: 'List of expiring documents' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpiringDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ) {
    const daysAhead = days ? parseInt(days, 10) : 30;
    return this.documentsService.getExpiringDocuments(
      user.tenantId,
      isNaN(daysAhead) ? 30 : daysAhead,
    );
  }

  @Get('expired')
  @ApiOperation({ summary: 'Get already expired documents' })
  @ApiResponse({ status: 200, description: 'List of expired documents' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpiredDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.getExpiredDocuments(user.tenantId);
  }

  @Post('send-expiry-alerts')
  @ApiOperation({ summary: 'Send expiry alert notifications to employees' })
  @ApiResponse({ status: 201, description: 'Alerts sent successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async sendExpiryAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { days?: number },
  ) {
    const daysAhead = body.days || 30;
    return this.documentsService.sendExpiryAlerts(user.tenantId, daysAhead);
  }
}
