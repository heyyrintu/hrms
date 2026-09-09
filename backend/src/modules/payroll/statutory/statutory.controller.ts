import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { StatutoryService } from './statutory.service';
import { UpdateStatutoryConfigDto, UpsertTaxDeclarationDto } from './dto/statutory.dto';

@ApiTags('statutory')
@ApiBearerAuth()
@Controller('payroll/statutory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StatutoryController {
  constructor(private statutoryService: StatutoryService) {}

  @Get('config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({
    summary: 'Read the statutory payroll configuration',
    description:
      'Returns null when the tenant has not configured statutory payroll, in which case no statutory deduction is made.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async getConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.statutoryService.getConfig(user.tenantId);
  }

  @Put('config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({
    summary: 'Create or patch the statutory payroll configuration',
    description:
      'Only the fields supplied are changed. Rates take effect from the next payroll run; runs already computed are not recalculated.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStatutoryConfigDto,
  ) {
    return this.statutoryService.upsertConfig(user.tenantId, dto);
  }

  @Get('professional-tax-slabs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'List the professional tax slabs held for a state' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getPtSlabs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('state') state?: string,
  ) {
    return this.statutoryService.listPtSlabs(user.tenantId, state);
  }

  @Get('income-tax-config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Read the income tax slabs held for a financial year' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getIncomeTaxConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Query('financialYear') financialYear?: string,
  ) {
    return this.statutoryService.listIncomeTaxConfigs(
      user.tenantId,
      financialYear ? parseInt(financialYear, 10) : undefined,
    );
  }

  @Get('my-declaration')
  @ApiOperation({
    summary: 'Read your own tax declaration for a financial year',
    description: 'FY 2025-26 is 2025. Defaults to the financial year in progress.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async getMyDeclaration(
    @CurrentUser() user: AuthenticatedUser,
    @Query('financialYear') financialYear?: string,
  ) {
    return this.statutoryService.getDeclaration(
      user.tenantId,
      user.employeeId ?? '',
      financialYear ? parseInt(financialYear, 10) : undefined,
    );
  }

  @Put('my-declaration')
  @ApiOperation({
    summary: 'Record your own tax declaration',
    description:
      'Declared figures only; no proof is collected or verified, so the resulting TDS is an estimate until proofs are checked.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async upsertMyDeclaration(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertTaxDeclarationDto,
  ) {
    return this.statutoryService.upsertDeclaration(
      user.tenantId,
      user.employeeId ?? '',
      dto,
    );
  }

  @Get('declarations/:employeeId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: "Read an employee's tax declaration" })
  @ApiResponse({ status: 200, description: 'Success' })
  async getDeclarationFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query('financialYear') financialYear?: string,
  ) {
    return this.statutoryService.getDeclaration(
      user.tenantId,
      employeeId,
      financialYear ? parseInt(financialYear, 10) : undefined,
    );
  }
}
