import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { OneTimePaymentsService } from './one-time-payments.service';
import { SalaryArrearsService } from './salary-arrears.service';
import { SalaryHoldsService } from './salary-holds.service';
import { PayrollReimbursementsService } from './payroll-reimbursements.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollService } from '../payroll.service';
import {
  ArrearQueryDto,
  AttachSettlementDto,
  CreateOneTimePaymentDto,
  DetectArrearsDto,
  HoldQueryDto,
  HoldSalaryDto,
  ReleaseHoldDto,
  UpdatePayrollSettingsDto,
  VoidHoldDto,
} from './dto/adjustments.dto';

/**
 * WS-C1 (Keka wave C) routes, all HR_ADMIN / SUPER_ADMIN — the spec's
 * "C API summary" (POST /payroll/runs/off-cycle lives on PayrollController).
 * Static paths (`arrears/detect`, `holds`) never collide with the
 * parameterised ones.
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
    private readonly payroll: PayrollService,
  ) {}

  // ---------------------------------------------------------------- settings

  @Get('settings')
  @ApiOperation({ summary: 'Payroll switches (defaults when never saved)' })
  @ApiResponse({ status: 200, description: 'Success' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.get(user.tenantId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update the payroll switches' })
  @ApiResponse({ status: 200, description: 'Success' })
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePayrollSettingsDto) {
    return this.settings.update(user.tenantId, dto);
  }

  // ------------------------------------------------------- one-time payments

  @Get('runs/:id/one-time-payments')
  @ApiOperation({ summary: "A run's one-time payments" })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  listOneTimePayments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.oneTimePayments.listForRun(user.tenantId, id);
  }

  @Post('runs/:id/one-time-payments')
  @ApiOperation({
    summary: 'Add a bonus, incentive or deduction to a DRAFT or COMPUTED run',
    description: 'On a COMPUTED run this flags needsRecompute; the run cannot be approved until recomputed.',
  })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Validation, run status or employee eligibility' })
  @ApiResponse({ status: 404, description: 'Run or employee not found' })
  @ApiResponse({ status: 409, description: 'The run changed meanwhile' })
  createOneTimePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateOneTimePaymentDto,
  ) {
    return this.oneTimePayments.create(user, id, dto);
  }

  @Delete('one-time-payments/:id')
  @ApiOperation({ summary: 'Delete a one-time payment of a DRAFT or COMPUTED run' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Run is APPROVED or PAID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteOneTimePayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.oneTimePayments.remove(user.tenantId, id);
    return { message: 'One-time payment deleted' };
  }

  // ----------------------------------------------------------------- arrears

  @Get('arrears')
  @ApiOperation({ summary: 'Salary arrears, filtered by status and employee' })
  @ApiResponse({ status: 200, description: 'Success' })
  listArrears(@CurrentUser() user: AuthenticatedUser, @Query() query: ArrearQueryDto) {
    return this.arrears.list(user.tenantId, query);
  }

  @Post('arrears/detect')
  @HttpCode(200)
  @ApiOperation({ summary: "Detect arrears from an employee's backdated salary revisions (idempotent)" })
  @ApiResponse({ status: 200, description: 'Detection result' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  detectArrears(@CurrentUser() user: AuthenticatedUser, @Body() dto: DetectArrearsDto) {
    return this.arrears.detectForEmployee(user.tenantId, dto.employeeId);
  }

  @Post('arrears/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a PENDING arrear' })
  @ApiResponse({ status: 200, description: 'Cancelled' })
  @ApiResponse({ status: 400, description: 'Not PENDING' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Included in a run meanwhile' })
  cancelArrear(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.arrears.cancel(user.tenantId, id);
  }

  // ------------------------------------------------------------------- holds

  @Get('runs/:id/holds')
  @ApiOperation({ summary: 'Salary holds in a run' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  listRunHolds(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.holds.listForRun(user.tenantId, id);
  }

  @Post('runs/:id/holds')
  @ApiOperation({ summary: "Hold an employee's net pay in a DRAFT, COMPUTED or APPROVED run" })
  @ApiResponse({ status: 201, description: 'Held' })
  @ApiResponse({ status: 400, description: 'Run status or eligibility' })
  @ApiResponse({ status: 404, description: 'Run or employee not found' })
  @ApiResponse({ status: 409, description: 'Already held in this run' })
  holdSalary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: HoldSalaryDto,
  ) {
    return this.holds.hold(user, id, dto);
  }

  @Get('holds')
  @ApiOperation({ summary: 'Salary holds of the tenant' })
  @ApiResponse({ status: 200, description: 'Success' })
  listHolds(@CurrentUser() user: AuthenticatedUser, @Query() query: HoldQueryDto) {
    return this.holds.list(user.tenantId, query.status);
  }

  @Delete('holds/:id')
  @ApiOperation({ summary: 'Un-hold (HELD, run not PAID)' })
  @ApiResponse({ status: 200, description: 'Removed' })
  @ApiResponse({ status: 400, description: 'Not HELD, or run PAID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async unhold(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.holds.unhold(user.tenantId, id);
    return { message: 'Hold removed' };
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release held salary into a later DRAFT or COMPUTED run' })
  @ApiResponse({ status: 200, description: 'Released' })
  @ApiResponse({ status: 400, description: 'Hold or target not eligible' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Changed meanwhile' })
  releaseHold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReleaseHoldDto,
  ) {
    return this.holds.release(user, id, dto.targetRunId);
  }

  @Post('holds/:id/void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void a held salary (never paid)' })
  @ApiResponse({ status: 200, description: 'Voided' })
  @ApiResponse({ status: 400, description: 'Not HELD, or run not approved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  voidHold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VoidHoldDto,
  ) {
    return this.holds.void(user, id, dto.reason);
  }

  // ---------------------------------------------------------- reimbursements

  @Get('runs/:id/reimbursements')
  @ApiOperation({ summary: 'Expense claims a run reimburses (attached) or would (eligible)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  getRunReimbursements(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reimbursements.getForRun(user.tenantId, id);
  }

  // ------------------------------------------------------------- settlements

  @Get('runs/:id/settlements')
  @ApiOperation({ summary: 'Settlements an off-cycle run carries, and those it could carry' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  listRunSettlements(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payroll.listRunSettlements(user.tenantId, id);
  }

  @Post('runs/:id/settlements')
  @ApiOperation({ summary: 'Pay an APPROVED settlement through a DRAFT/COMPUTED off-cycle run' })
  @ApiResponse({ status: 201, description: 'Attached' })
  @ApiResponse({ status: 400, description: 'Run or settlement not eligible' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Already carried' })
  attachSettlement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachSettlementDto,
  ) {
    return this.payroll.attachSettlement(user.tenantId, id, dto.settlementId);
  }

  @Delete('runs/:id/settlements/:settlementId')
  @ApiOperation({ summary: 'Stop paying a settlement through the run' })
  @ApiResponse({ status: 200, description: 'Detached' })
  @ApiResponse({ status: 404, description: 'Not carried by the run' })
  detachSettlement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('settlementId') settlementId: string,
  ) {
    return this.payroll.detachSettlement(user.tenantId, id, settlementId);
  }
}
