import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SettlementService } from './settlement.service';
import { ComputeSettlementDto, UpdateSettlementDto } from './dto/settlement.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

/**
 * Full and final settlement endpoints.
 *
 * Restricted to HR administrators: a settlement exposes the leaver's salary,
 * gratuity and tax figures, and approving or paying one commits money.
 */
@ApiTags('exit')
@ApiBearerAuth()
@Controller('exit/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettlementController {
  constructor(private settlementService: SettlementService) {}

  @Post('separations/:separationId/compute')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({
    summary: 'Compute a draft settlement for a separation, replacing any existing draft',
  })
  @ApiResponse({ status: 201, description: 'Draft settlement computed' })
  @ApiResponse({ status: 400, description: 'Missing last working date, salary or statutory config' })
  @ApiResponse({ status: 409, description: 'Settlement is already approved or paid' })
  async compute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('separationId') separationId: string,
    @Body() dto: ComputeSettlementDto,
  ) {
    return this.settlementService.compute(user.tenantId, separationId, dto);
  }

  // Declared before `:id` so the literal segment is not swallowed by it.
  @Get('separations/:separationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: "Get a separation's settlement" })
  @ApiResponse({ status: 200, description: 'Success' })
  async findBySeparation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('separationId') separationId: string,
  ) {
    return this.settlementService.findBySeparation(user.tenantId, separationId);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Get settlement by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.settlementService.findOne(user.tenantId, id);
  }

  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({
    summary: 'Set the manual figures on a draft settlement and re-derive the totals',
  })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 409, description: 'Settlement is no longer a draft' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSettlementDto,
  ) {
    return this.settlementService.update(user.tenantId, id, dto);
  }

  @Post(':id/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Approve a draft settlement' })
  @ApiResponse({ status: 201, description: 'Approved' })
  @ApiResponse({ status: 409, description: 'Settlement is not a draft' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.settlementService.approve(user.tenantId, id, user.userId);
  }

  @Post(':id/pay')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Mark an approved settlement as paid' })
  @ApiResponse({ status: 201, description: 'Marked paid' })
  @ApiResponse({ status: 409, description: 'Settlement has not been approved' })
  async markPaid(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.settlementService.markPaid(user.tenantId, id);
  }
}
