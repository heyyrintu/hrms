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

  // ---- Employee Self-Service ----

  @Get('profile')
  @ApiOperation({ summary: 'Get my profile' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.selfServiceService.getMyProfile(user.tenantId, user.employeeId);
  }

  @Post('change-requests')
  @ApiOperation({ summary: 'Create change request' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChangeRequestDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.selfServiceService.createChangeRequest(
      user.tenantId,
      user.employeeId,
      dto,
    );
  }

  @Get('change-requests')
  @ApiOperation({ summary: 'Get my change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyChangeRequests(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.selfServiceService.getMyChangeRequests(
      user.tenantId,
      user.employeeId,
    );
  }

  // ---- HR Admin Review ----

  @Get('admin/change-requests/pending')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Get pending change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getPendingReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.selfServiceService.getPendingReviews(user.tenantId);
  }

  @Get('admin/change-requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Get all change requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Review change request' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async reviewChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewChangeRequestDto,
  ) {
    return this.selfServiceService.reviewChangeRequest(
      user.tenantId,
      id,
      user.employeeId || user.userId,
      dto,
    );
  }
}
