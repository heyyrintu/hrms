import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { Form16Service, financialYearLabel } from './form16.service';
import { Form16PdfService } from './form16-pdf.service';

/**
 * Form 16 Part B and the quarterly deduction working.
 *
 * No route here is decorated with `@Roles`, and that is deliberate: an employee
 * must be able to fetch their own certificate, so the guard cannot simply be
 * restricted to HR. Authorisation is instead enforced inside `Form16Service`,
 * before any query runs — admins may read anyone in their tenant, everybody
 * else only themselves. Putting it in the service rather than the controller
 * means the rule holds however the service is called, and cannot be sidestepped
 * by a client that talks to the API directly.
 *
 * Every description below repeats the same caveat as the service: Part A comes
 * from TRACES, and nothing served from here substitutes for it.
 */

const NOT_TRACES =
  'IMPORTANT: this is NOT the Form 16 certificate. Form 16 Part A — the certificate of tax ' +
  'deducted, carrying the challan and quarterly receipt numbers — is generated and digitally ' +
  'signed by the Income Tax Department on TRACES once the employer has filed its quarterly Form ' +
  '24Q returns, and cannot be produced by an employer system. What this endpoint returns is the ' +
  'Part B annexure prepared from this system\'s own payroll records, to be attached to the ' +
  'TRACES-issued Part A. Have it verified by a payroll professional before it is issued.';

@ApiTags('form16')
@ApiBearerAuth()
@Controller('payroll/form16')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Form16Controller {
  constructor(
    private form16Service: Form16Service,
    private form16PdfService: Form16PdfService,
  ) {}

  @Get('my/:financialYear')
  @ApiOperation({
    summary: 'Read your own Form 16 Part B working for a financial year',
    description:
      `FY 2025-26 is 2025. ${NOT_TRACES}`,
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getMyPartB(
    @CurrentUser() user: AuthenticatedUser,
    @Param('financialYear') financialYear: string,
  ) {
    return this.form16Service.computePartB(
      user.tenantId,
      user.employeeId ?? '',
      parseInt(financialYear, 10),
      user,
    );
  }

  @Get('my/:financialYear/quarters')
  @ApiOperation({
    summary: 'Read your own quarterly TDS working for a financial year',
    description:
      'The tax this employer deducted in each quarter of the year. The TRACES receipt numbers ' +
      'that normally accompany these figures in Part A are returned as null, because only TRACES ' +
      `issues them. ${NOT_TRACES}`,
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getMyQuarters(
    @CurrentUser() user: AuthenticatedUser,
    @Param('financialYear') financialYear: string,
  ) {
    return this.form16Service.getQuarterlyTdsSummary(
      user.tenantId,
      user.employeeId ?? '',
      parseInt(financialYear, 10),
      user,
    );
  }

  @Get('my/:financialYear/pdf')
  @ApiOperation({
    summary: 'Download your own Form 16 Part B annexure as a PDF',
    description:
      'The PDF is an unsigned Part B annexure and says so on its face. ' + NOT_TRACES,
  })
  @ApiResponse({ status: 200, description: 'PDF file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async downloadMyPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('financialYear') financialYear: string,
    @Res() res: Response,
  ) {
    await this.streamPartBPdf(
      res,
      user,
      user.employeeId ?? '',
      parseInt(financialYear, 10),
    );
  }

  @Get(':employeeId/:financialYear')
  @ApiOperation({
    summary: "Read an employee's Form 16 Part B working for a financial year",
    description:
      'Administrators may read any employee in their own tenant; anyone else is refused unless ' +
      `the employee is themselves. ${NOT_TRACES}`,
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getPartB(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('financialYear') financialYear: string,
  ) {
    return this.form16Service.computePartB(
      user.tenantId,
      employeeId,
      parseInt(financialYear, 10),
      user,
    );
  }

  @Get(':employeeId/:financialYear/quarters')
  @ApiOperation({
    summary: "Read an employee's quarterly TDS working for a financial year",
    description:
      'What this employer deducted in each quarter. Receipt numbers are null; only TRACES ' +
      `issues them. ${NOT_TRACES}`,
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getQuarters(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('financialYear') financialYear: string,
  ) {
    return this.form16Service.getQuarterlyTdsSummary(
      user.tenantId,
      employeeId,
      parseInt(financialYear, 10),
      user,
    );
  }

  @Get(':employeeId/:financialYear/pdf')
  @ApiOperation({
    summary: "Download an employee's Form 16 Part B annexure as a PDF",
    description:
      'The PDF is an unsigned Part B annexure and says so on its face. ' + NOT_TRACES,
  })
  @ApiResponse({ status: 200, description: 'PDF file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('financialYear') financialYear: string,
    @Res() res: Response,
  ) {
    await this.streamPartBPdf(res, user, employeeId, parseInt(financialYear, 10));
  }

  /**
   * Shared by the two PDF routes. The filename says "part-b" so the file is not
   * mistaken for the certificate once it has left the browser.
   */
  private async streamPartBPdf(
    res: Response,
    user: AuthenticatedUser,
    employeeId: string,
    financialYear: number,
  ): Promise<void> {
    const partB = await this.form16Service.computePartB(
      user.tenantId,
      employeeId,
      financialYear,
      user,
    );

    const buffer = await this.form16PdfService.generatePartBPdf(partB);
    const filename = `form16-part-b-${partB.employee.employeeCode}-${financialYearLabel(financialYear)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
