import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { GlMappingService } from './gl-mapping.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingExportService } from './accounting-export.service';

/**
 * WS-C2 (Keka wave C) routes, HR_ADMIN / SUPER_ADMIN. Scaffold shell — WS-C2
 * adds: GET|PUT /payroll/accounting/config, GET|PUT /payroll/accounting/gl-mappings,
 * GET /payroll/accounting/runs/:runId/journal?allowUnmapped=,
 * GET /payroll/accounting/runs/:runId/export?format=csv|tally&allowUnmapped=.
 */
@ApiTags('payroll-accounting')
@ApiBearerAuth()
@Controller('payroll/accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class PayrollAccountingController {
  constructor(
    private readonly mappings: GlMappingService,
    private readonly config: AccountingConfigService,
    private readonly exports: AccountingExportService,
  ) {}
}
