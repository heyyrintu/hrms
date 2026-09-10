import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { SlabsService } from './slabs.service';
import {
  IncomeTaxConfigDto,
  IncomeTaxConfigQueryDto,
  ProfessionalTaxSlabDto,
  ProfessionalTaxSlabQueryDto,
} from './dto/slabs.dto';

/**
 * Editing the statutory slab tables.
 *
 * Every route is restricted to the same two roles: rate revisions are a
 * payroll-administration act, not something a manager or employee needs, let
 * alone triggers accidentally.
 */
const SLAB_EDITORS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN];

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/slabs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SlabsController {
  constructor(private slabsService: SlabsService) {}

  // -------------------------------------------------------------------------
  // Professional tax
  // -------------------------------------------------------------------------

  @Get('professional-tax')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'List professional tax bands',
    description: 'Every band in the tenant, or only those for one state.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async listProfessionalTax(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProfessionalTaxSlabQueryDto,
  ) {
    return this.slabsService.listProfessionalTax(user.tenantId, query.state);
  }

  @Post('professional-tax')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'Add a professional tax band',
    description:
      'Refused if it overlaps an existing band for the same state and an overlapping ' +
      'set of genders: two bands that can both match one income mean the first one ' +
      'returned wins arbitrarily.',
  })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid range, or overlaps an existing band' })
  async createProfessionalTax(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProfessionalTaxSlabDto,
  ) {
    return this.slabsService.createProfessionalTax(user.tenantId, dto);
  }

  @Put('professional-tax/:id')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'Replace a professional tax band',
    description: 'Replaces the whole row; there is no partial patch.',
  })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Invalid range, or overlaps an existing band' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateProfessionalTax(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProfessionalTaxSlabDto,
  ) {
    return this.slabsService.updateProfessionalTax(user.tenantId, id, dto);
  }

  @Delete('professional-tax/:id')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'Delete a professional tax band',
    description:
      'Payslips already processed keep the figures they were computed with; only ' +
      'payroll runs from now on stop applying this band.',
  })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteProfessionalTax(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.slabsService.deleteProfessionalTax(user.tenantId, id);
  }

  // -------------------------------------------------------------------------
  // Income tax
  // -------------------------------------------------------------------------

  @Get('income-tax')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'List income tax configurations with their slabs',
    description: 'Every configuration in the tenant, or only those for one financial year.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async listIncomeTax(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IncomeTaxConfigQueryDto,
  ) {
    return this.slabsService.listIncomeTaxConfigs(user.tenantId, query.financialYear);
  }

  @Put('income-tax')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'Create or replace the configuration for a year, regime and age band',
    description:
      'Replaces the whole slab ladder as one unit of work. The ladder must start at 0, ' +
      'must not overlap or leave a gap, and exactly one band may be open-ended at the top.',
  })
  @ApiResponse({ status: 200, description: 'Created or replaced' })
  @ApiResponse({ status: 400, description: 'The ladder is not valid' })
  async replaceIncomeTax(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IncomeTaxConfigDto,
  ) {
    return this.slabsService.replaceIncomeTaxConfig(user.tenantId, dto);
  }

  @Delete('income-tax/:id')
  @Roles(...SLAB_EDITORS)
  @ApiOperation({
    summary: 'Delete an income tax configuration',
    description:
      'Payslips already computed keep the tax they were charged; any payroll run for ' +
      'this year, regime and age band that has not been processed yet will find no ' +
      'configuration until a new one is created.',
  })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteIncomeTax(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.slabsService.deleteIncomeTaxConfig(user.tenantId, id);
  }
}
