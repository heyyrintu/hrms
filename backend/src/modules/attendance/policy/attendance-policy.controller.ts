import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AttendancePolicyService } from './attendance-policy.service';
import { UpdateAttendancePolicyDto } from '../dto/update-attendance-policy.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

/**
 * Deliberately its own top-level prefix rather than `attendance/policy`:
 * `AttendanceController` owns `GET /attendance/:employeeId`, so a nested path
 * would only resolve while this controller happened to be registered first.
 */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance-policy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class AttendancePolicyController {
  constructor(private policyService: AttendancePolicyService) {}

  /**
   * Read the tenant's attendance policy, creating defaults on first read.
   * GET /api/attendance-policy
   */
  @Get()
  @ApiOperation({ summary: 'Get the tenant attendance policy' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.policyService.getOrCreate(user.tenantId);
  }

  /**
   * Update the tenant's attendance policy.
   * PUT /api/attendance-policy
   */
  @Put()
  @ApiOperation({ summary: 'Update the tenant attendance policy' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAttendancePolicyDto,
  ) {
    return this.policyService.update(user.tenantId, dto);
  }
}
