import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CompOffService } from './comp-off.service';
import {
  CreateCompOffDto,
  ApproveCompOffDto,
  CompOffQueryDto,
} from './dto/comp-off.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave/comp-off')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompOffController {
  constructor(private compOffService: CompOffService) {}

  /**
   * Create a comp-off request
   * POST /api/leave/comp-off
   */
  @Post()
  @ApiOperation({ summary: 'Create comp-off request' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Duplicate request' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompOffDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.compOffService.create(user.tenantId, user.employeeId, dto);
  }

  /**
   * Get my comp-off requests
   * GET /api/leave/comp-off/me
   */
  @Get('me')
  @ApiOperation({ summary: 'Get my comp-off requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompOffQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.compOffService.getMyRequests(
      user.tenantId,
      user.employeeId,
      query,
    );
  }

  /**
   * Get pending comp-off approvals (Manager/HR/Admin)
   * GET /api/leave/comp-off/pending-approvals
   */
  @Get('pending-approvals')
  @ApiOperation({ summary: 'Get pending comp-off approvals' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPendingApprovals(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.compOffService.getPendingApprovals(
      user.tenantId,
      user.employeeId,
    );
  }

  /**
   * Get all comp-off requests (Admin view)
   * GET /api/leave/comp-off/all
   */
  @Get('all')
  @ApiOperation({ summary: 'Get all comp-off requests (admin)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAllRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompOffQueryDto,
  ) {
    return this.compOffService.getAllRequests(user.tenantId, query);
  }

  /**
   * Approve a comp-off request
   * POST /api/leave/comp-off/:id/approve
   */
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve comp-off request' })
  @ApiResponse({ status: 201, description: 'Approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveCompOffDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.compOffService.approve(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }

  /**
   * Reject a comp-off request
   * POST /api/leave/comp-off/:id/reject
   */
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject comp-off request' })
  @ApiResponse({ status: 201, description: 'Rejected' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveCompOffDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.compOffService.reject(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }
}
