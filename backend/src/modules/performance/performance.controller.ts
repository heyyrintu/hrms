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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PerformanceService } from './performance.service';
import {
  CreateReviewCycleDto,
  UpdateReviewCycleDto,
  ReviewCycleQueryDto,
  SubmitSelfReviewDto,
  SubmitManagerReviewDto,
  ReviewQueryDto,
  SetPotentialDto,
} from './dto/performance.dto';

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceController {
  constructor(private performanceService: PerformanceService) {}

  // ============================================
  // Review Cycles (HR_ADMIN / SUPER_ADMIN)
  // ============================================

  @Get('cycles')
  @ApiOperation({ summary: 'Get all review cycles' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getCycles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReviewCycleQueryDto,
  ) {
    return this.performanceService.getCycles(user.tenantId, query);
  }

  @Get('cycles/:id')
  @ApiOperation({ summary: 'Get review cycle by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.getCycle(user.tenantId, id);
  }

  @Post('cycles')
  @ApiOperation({ summary: 'Create review cycle' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewCycleDto,
  ) {
    return this.performanceService.createCycle(user.tenantId, dto);
  }

  @Put('cycles/:id')
  @ApiOperation({ summary: 'Update review cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReviewCycleDto,
  ) {
    return this.performanceService.updateCycle(user.tenantId, id, dto);
  }

  @Delete('cycles/:id')
  @ApiOperation({ summary: 'Delete review cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.deleteCycle(user.tenantId, id);
  }

  @Post('cycles/:id/launch')
  @ApiOperation({ summary: 'Launch review cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async launchCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.launchCycle(user.tenantId, id);
  }

  @Post('cycles/:id/complete')
  @ApiOperation({ summary: 'Complete review cycle' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async completeCycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.completeCycle(user.tenantId, id);
  }

  // ============================================
  // My Reviews (All authenticated users)
  // ============================================

  @Get('my-reviews')
  @ApiOperation({ summary: 'Get my performance reviews' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyReviews(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReviewQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.performanceService.getMyReviews(user.tenantId, user.employeeId, query);
  }

  @Get('reviews/:id')
  @ApiOperation({ summary: 'Get review by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found (also when the caller may not view it)' })
  async getReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.getReview(user, id);
  }

  @Get('reviews/:id/questions')
  @ApiOperation({ summary: 'Get the cycle questions the caller may see for a review' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found (also when the caller may not view it)' })
  async getReviewQuestions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.performanceService.getReviewQuestions(user, id);
  }

  @Post('reviews/:id/self-review')
  @ApiOperation({ summary: 'Submit self review' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async submitSelfReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitSelfReviewDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.performanceService.submitSelfReview(
      user.tenantId,
      id,
      user.employeeId,
      dto,
    );
  }

  // ============================================
  // Team Reviews (Manager / HR / Super Admin)
  // ============================================

  @Get('team-reviews')
  @ApiOperation({ summary: 'Get team performance reviews' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getTeamReviews(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReviewQueryDto,
  ) {
    return this.performanceService.getTeamReviews(
      user.tenantId,
      user.employeeId,
      user.role,
      query,
    );
  }

  @Post('reviews/:id/manager-review')
  @ApiOperation({ summary: 'Submit manager review' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async submitManagerReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitManagerReviewDto,
  ) {
    return this.performanceService.submitManagerReview(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }

  @Put('reviews/:id/potential')
  @ApiOperation({ summary: 'Set the potential rating (1-3) of a review while the cycle is active' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Cycle is not active' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async setPotential(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetPotentialDto,
  ) {
    return this.performanceService.setPotential(user, id, dto.potentialRating);
  }
}
