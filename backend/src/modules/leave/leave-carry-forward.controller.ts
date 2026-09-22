import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { RunCarryForwardDto } from './dto/run-carry-forward.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole, AccrualTriggerType } from '@prisma/client';

@ApiTags('leave-carry-forward')
@ApiBearerAuth()
@Controller('leave/carry-forward')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class LeaveCarryForwardController {
  constructor(private carryForwardService: LeaveCarryForwardService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run the year-end leave carry-forward' })
  @ApiResponse({ status: 201, description: 'Carry-forward executed' })
  async run(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RunCarryForwardDto,
  ) {
    return this.carryForwardService.runCarryForward(
      user.tenantId,
      dto.fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      user.userId,
    );
  }

  @Get('runs')
  @ApiOperation({ summary: 'List carry-forward run history' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getRuns(@CurrentUser() user: AuthenticatedUser) {
    return this.carryForwardService.getRuns(user.tenantId);
  }
}
