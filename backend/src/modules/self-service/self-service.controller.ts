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
import { UserRole } from '@prisma/client';
import { SelfServiceService } from './self-service.service';
import {
  CreateChangeRequestDto,
  BatchChangeRequestDto,
  ReviewChangeRequestDto,
  ChangeRequestQueryDto,
} from './dto/change-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('self-service')
@ApiBearerAuth()
@Controller('self-service')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SelfServiceController {
  constructor(private selfServiceService: SelfServiceService) {}

  private assertEmployeeLinked(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return user.employeeId;
  }

  // ---- Employee Self-Service ----

  @Get('profile')
  @ApiOperation({ summary: 'Get my profile' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    const employeeId = this.assertEmployeeLinked(user);
    return this.selfServiceService.getMyProfile(user.tenantId, employeeId);
  }

  @Post('change-requests')
  @ApiOperation({ summary: 'Create change request' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChangeRequestDto,
  ) {
    const employeeId = this.assertEmployeeLinked(user);
    return this.selfServiceService.createChangeRequest(
      user.tenantId,
      employeeId,
      dto,
    );
  }

  @Post('change-requests/batch')
  @ApiOperation({ summary: 'Create batch change requests for profile edit' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createBatchChangeRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BatchChangeRequestDto,
  ) {
    const employeeId = this.assertEmployeeLinked(user);
    return this.selfServiceService.createBatchChangeRequests(
      user.tenantId,
      employeeId,
      dto.changes,
    );
  }

  @Get('change-requests')
  @ApiOperation({ summary: 'Get my change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyChangeRequests(@CurrentUser() user: AuthenticatedUser) {
    const employeeId = this.assertEmployeeLinked(user);
    return this.selfServiceService.getMyChangeRequests(
      user.tenantId,
      employeeId,
    );
  }

  // ---- HR Admin Review ----

  @Get('admin/change-requests/pending')
  @ApiOperation({ summary: 'Get pending change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getPendingReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.selfServiceService.getPendingReviews(user.tenantId);
  }

  @Get('admin/change-requests')
  @ApiOperation({ summary: 'Get all change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAllChangeRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChangeRequestQueryDto,
  ) {
    return this.selfServiceService.getAllChangeRequests(
      user.tenantId,
      query.status,
    );
  }

  @Post('admin/change-requests/:id/review')
  @ApiOperation({ summary: 'Review change request' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async reviewChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewChangeRequestDto,
  ) {
    const reviewerId = this.assertEmployeeLinked(user);
    return this.selfServiceService.reviewChangeRequest(
      user.tenantId,
      id,
      reviewerId,
      dto,
    );
  }
}
