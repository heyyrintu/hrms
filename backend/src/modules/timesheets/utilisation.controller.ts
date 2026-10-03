import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UtilisationService } from './utilisation.service';
import { UtilisationQueryDto } from './dto/utilisation.dto';

/**
 * Utilisation report (Keka wave G, WS-T). No @Roles / @RequirePermissions here:
 * the service branches on role and on `projects.reports.view`.
 */
@ApiTags('utilisation')
@ApiBearerAuth()
@Controller('utilisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UtilisationController {
  constructor(private readonly utilisation: UtilisationService) {}

  @Get()
  @ApiOperation({ summary: 'Utilisation against capacity, by employee or project' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Invalid or over-long range' })
  @ApiResponse({ status: 403, description: 'No report scope' })
  @ApiResponse({ status: 404, description: 'Project or employee outside scope' })
  get(@CurrentUser() user: AuthenticatedUser, @Query() query: UtilisationQueryDto) {
    return this.utilisation.build(user, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'The same report as CSV' })
  @ApiResponse({ status: 200, description: 'CSV file' })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UtilisationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.utilisation.exportCsv(user, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="utilisation-${query.from}-${query.to}-${query.groupBy}.csv"`,
    );
    return csv;
  }
}
