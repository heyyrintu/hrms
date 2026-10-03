import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { CalibrationService } from './calibration.service';
import { CalibrateDto, CalibrationQueryDto, NineBoxQueryDto } from './dto/calibration.dto';

/** Calibration and 9-box (spec F6, F7). */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalibrationController {
  constructor(private calibrationService: CalibrationService) {}

  @Post('reviews/:id/calibrate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Override (or revert) the final rating of a completed review' })
  @ApiResponse({ status: 201, description: 'Calibrated' })
  @ApiResponse({ status: 400, description: 'Review not completed or cycle not active' })
  @ApiResponse({ status: 403, description: 'Not an admin, or your own review' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  async calibrate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CalibrateDto,
  ) {
    return this.calibrationService.calibrate(user, id, dto);
  }

  @Get('calibration')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Rating distributions and review table for one cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'No employee profile linked to your account' })
  @ApiResponse({ status: 404, description: 'Cycle not found' })
  async getCalibration(@CurrentUser() user: AuthenticatedUser, @Query() query: CalibrationQueryDto) {
    return this.calibrationService.getCalibration(user, query);
  }

  @Get('nine-box')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: '9-box grid (performance by potential) for one cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'No employee profile linked to your account' })
  @ApiResponse({ status: 404, description: 'Cycle not found' })
  async getNineBox(@CurrentUser() user: AuthenticatedUser, @Query() query: NineBoxQueryDto) {
    return this.calibrationService.getNineBox(user, query);
  }
}
