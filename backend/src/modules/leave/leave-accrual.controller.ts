import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { LeaveAccrualService } from './leave-accrual.service';
import {
  CreateAccrualRuleDto,
  UpdateAccrualRuleDto,
  TriggerAccrualDto,
  AccrualRunQueryDto,
} from './dto/accrual.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole, AccrualTriggerType } from '@prisma/client';

@ApiTags('leave-accrual')
@ApiBearerAuth()
@Controller('leave/admin/accrual')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class LeaveAccrualController {
  constructor(private accrualService: LeaveAccrualService) {}

  @Post('rules')
  @ApiOperation({ summary: 'Create leave accrual rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  @ApiResponse({ status: 409, description: 'Rule already exists' })
  async createRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccrualRuleDto,
  ) {
    return this.accrualService.createAccrualRule(user.tenantId, dto);
  }

  @Get('rules')
  @ApiOperation({ summary: 'Get all accrual rules' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getRules(@CurrentUser() user: AuthenticatedUser) {
    return this.accrualService.getAccrualRules(user.tenantId);
  }

  @Get('rules/:id')
  @ApiOperation({ summary: 'Get accrual rule by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRuleById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.accrualService.getAccrualRuleById(user.tenantId, id);
  }

  @Put('rules/:id')
  @ApiOperation({ summary: 'Update accrual rule' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccrualRuleDto,
  ) {
    return this.accrualService.updateAccrualRule(user.tenantId, id, dto);
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'Delete accrual rule' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.accrualService.deleteAccrualRule(user.tenantId, id);
  }

  @Post('calculate')
  @ApiOperation({ summary: 'Trigger manual accrual calculation' })
  @ApiResponse({ status: 201, description: 'Accrual triggered' })
  @ApiResponse({
    status: 409,
    description: 'Already completed for this period',
  })
  async triggerAccrual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TriggerAccrualDto,
  ) {
    return this.accrualService.triggerAccrual(
      user.tenantId,
      dto,
      AccrualTriggerType.MANUAL_ADMIN,
      user.userId,
    );
  }

  @Get('runs')
  @ApiOperation({ summary: 'Get accrual run history' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AccrualRunQueryDto,
  ) {
    return this.accrualService.getAccrualRuns(user.tenantId, query);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get accrual run details' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRunById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.accrualService.getAccrualRunById(user.tenantId, id);
  }

  @Get('runs/:id/entries')
  @ApiOperation({ summary: 'Get accrual run entries' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRunEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accrualService.getAccrualRunEntries(
      user.tenantId,
      id,
      page,
      limit,
    );
  }
}
