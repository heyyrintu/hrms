import { Body, Controller, Get, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/permissions/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { GlMappingService } from './gl-mapping.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingExportService } from './accounting-export.service';
import { ExportQueryDto, JournalQueryDto, ReplaceGlMappingsDto, UpdateAccountingConfigDto } from './dto/accounting.dto';

/**
 * WS-C2 (Keka wave C) routes, HR_ADMIN / SUPER_ADMIN.
 */
@ApiTags('payroll-accounting')
@ApiBearerAuth()
@Controller('payroll/accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@RequirePermissions('payroll.accounting.manage')
export class PayrollAccountingController {
  constructor(
    private readonly mappings: GlMappingService,
    private readonly config: AccountingConfigService,
    private readonly exports: AccountingExportService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Get the tenant accounting export settings' })
  getConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.config.get(user.tenantId);
  }

  @Put('config')
  @ApiOperation({ summary: 'Update the tenant accounting export settings' })
  updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAccountingConfigDto) {
    return this.config.update(user, dto);
  }

  @Get('gl-mappings')
  @ApiOperation({ summary: 'Get the GL mapping set and every key that can be mapped' })
  getMappings(@CurrentUser() user: AuthenticatedUser) {
    return this.mappings.getMappings(user.tenantId);
  }

  @Put('gl-mappings')
  @ApiOperation({ summary: 'Replace the whole GL mapping set' })
  replaceMappings(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReplaceGlMappingsDto) {
    return this.mappings.replaceMappings(user, dto.mappings);
  }

  @Get('runs/:runId/journal')
  @ApiOperation({ summary: 'Preview the journal for a payroll run (COMPUTED, APPROVED or PAID)' })
  @ApiQuery({ name: 'allowUnmapped', required: false, type: Boolean })
  getJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId') runId: string,
    @Query() query: JournalQueryDto,
  ) {
    return this.exports.preview(user.tenantId, runId, query.allowUnmapped === 'true');
  }

  @Get('runs/:runId/export')
  @ApiOperation({ summary: 'Download the journal for an APPROVED or PAID payroll run' })
  @ApiQuery({ name: 'format', enum: ['csv', 'tally'] })
  @ApiQuery({ name: 'allowUnmapped', required: false, type: Boolean })
  async exportJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId') runId: string,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.exports.export(user, runId, query.format, query.allowUnmapped === 'true');
    res.setHeader('Content-Type', `${file.contentType}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.content;
  }
}
