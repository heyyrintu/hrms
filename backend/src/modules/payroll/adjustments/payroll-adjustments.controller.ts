import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OneTimePaymentsService } from './one-time-payments.service';
import { SalaryArrearsService } from './salary-arrears.service';
import { SalaryHoldsService } from './salary-holds.service';
import { PayrollReimbursementsService } from './payroll-reimbursements.service';
import { PayrollSettingsService } from './payroll-settings.service';

/**
 * WS-C1 (Keka wave C) routes, all HR_ADMIN / SUPER_ADMIN. Scaffold shell —
 * WS-C1 adds the handlers listed in the spec's "C API summary":
 *   GET|POST /payroll/runs/:id/one-time-payments, DELETE /payroll/one-time-payments/:id,
 *   GET /payroll/arrears, POST /payroll/arrears/detect, POST /payroll/arrears/:id/cancel,
 *   GET|POST /payroll/runs/:id/holds, GET /payroll/holds, DELETE /payroll/holds/:id,
 *   POST /payroll/holds/:id/release, POST /payroll/holds/:id/void,
 *   GET /payroll/runs/:id/reimbursements,
 *   POST /payroll/runs/:id/settlements, DELETE /payroll/runs/:id/settlements/:settlementId,
 *   GET|PUT /payroll/settings.
 * (POST /payroll/runs/off-cycle lives on PayrollController.)
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class PayrollAdjustmentsController {
  constructor(
    private readonly oneTimePayments: OneTimePaymentsService,
    private readonly arrears: SalaryArrearsService,
    private readonly holds: SalaryHoldsService,
    private readonly reimbursements: PayrollReimbursementsService,
    private readonly settings: PayrollSettingsService,
  ) {}
}
