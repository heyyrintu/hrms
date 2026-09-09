import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { GeneratedReturnFile, ReturnsService } from './returns.service';

/**
 * Downloads for the statutory returns and challans of a payroll run.
 *
 * Everything here is restricted to payroll administrators: these files carry
 * every employee's PAN, UAN, insurance number and bank account in one place,
 * which is a far wider exposure than any single payslip.
 *
 * Each endpoint returns the file as an attachment by default. Pass
 * `?download=false` to get the same thing as JSON with its warnings, which is
 * what the UI uses to show who was left out before anyone files anything.
 */
@ApiTags('payroll-returns')
@ApiBearerAuth()
@Controller('payroll/returns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class ReturnsController {
  constructor(private returnsService: ReturnsService) {}

  @Get(':payrollRunId/pf-ecr')
  @ApiOperation({
    summary: 'PF Electronic Challan cum Return for a payroll run',
    description:
      "EPFO ECR text format, #~# delimited, one line per member. Members without a UAN are left out and listed in the warnings. Check the layout against your establishment's current ECR template before uploading; the EPFO has revised it more than once.",
  })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'ECR text file, or JSON when download=false' })
  @ApiResponse({ status: 400, description: 'Payroll run is not yet computed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  async pfEcr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payrollRunId') payrollRunId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    const file = await this.returnsService.pfEcr(user.tenantId, payrollRunId);
    return this.deliver(file, res, download);
  }

  @Get(':payrollRunId/esi')
  @ApiOperation({
    summary: 'ESI monthly contribution return for a payroll run',
    description:
      'CSV of employees the payroll treated as covered. Employees without an ESI number are left out and listed in the warnings. The column list is for reconciliation; check it against the ESIC portal template before uploading.',
  })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'CSV file, or JSON when download=false' })
  @ApiResponse({ status: 400, description: 'Payroll run is not yet computed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  async esiReturn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payrollRunId') payrollRunId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    const file = await this.returnsService.esiReturn(user.tenantId, payrollRunId);
    return this.deliver(file, res, download);
  }

  @Get(':payrollRunId/professional-tax')
  @ApiOperation({
    summary: 'Professional tax challan summary for a payroll run',
    description:
      'Per-state head count and total deducted, since professional tax is remitted state by state. The enrolment number for each state is not held by this system and must be added to the challan itself.',
  })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'CSV file, or JSON when download=false' })
  @ApiResponse({ status: 400, description: 'Payroll run is not yet computed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  async professionalTaxChallan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payrollRunId') payrollRunId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    const file = await this.returnsService.professionalTaxChallan(
      user.tenantId,
      payrollRunId,
    );
    return this.deliver(file, res, download);
  }

  @Get(':payrollRunId/form-24q')
  @ApiOperation({
    summary: 'Form 24Q annexure data for the quarter a payroll run falls in',
    description:
      'Per-employee PAN, gross salary paid and tax deducted for the whole quarter, against section code 92B. This is the data behind the annexure, not a fileable return: the FVU file is produced by the NSDL utility and needs challan and deductor particulars this system does not hold.',
  })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'CSV file, or JSON when download=false' })
  @ApiResponse({ status: 400, description: 'Payroll run is not yet computed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  async form24Q(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payrollRunId') payrollRunId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    const file = await this.returnsService.form24Q(user.tenantId, payrollRunId);
    return this.deliver(file, res, download);
  }

  @Get(':payrollRunId/bank-transfer')
  @ApiOperation({
    summary: 'NEFT-style bank transfer file for a payroll run',
    description:
      'Beneficiary name, account number, IFSC, net pay and a reference. Employees missing bank details, or with a net pay of zero or less, are left out and listed in the warnings. Banks each publish their own bulk upload layout, so map this onto yours rather than uploading it unchanged.',
  })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'CSV file, or JSON when download=false' })
  @ApiResponse({ status: 400, description: 'Payroll run is not yet computed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  async bankTransferFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payrollRunId') payrollRunId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    const file = await this.returnsService.bankTransferFile(user.tenantId, payrollRunId);
    return this.deliver(file, res, download);
  }

  /**
   * Streams the file, or hands back the whole object when the caller asked for
   * JSON. The warning count also rides on a header of the download response so
   * that a client which only ever downloads still has a way to notice that
   * somebody was left out.
   */
  private deliver(
    file: GeneratedReturnFile,
    res: Response,
    download?: string,
  ): GeneratedReturnFile | string {
    if (download === 'false') return file;

    res.setHeader('Content-Type', `${file.contentType}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('X-Return-Warning-Count', String(file.warnings.length));
    return file.content;
  }
}
