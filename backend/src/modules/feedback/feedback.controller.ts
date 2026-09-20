import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, FeedbackQueryDto } from './dto/feedback.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) {}

  /**
   * Give feedback to a colleague
   * POST /api/feedback
   */
  @Post()
  @ApiOperation({ summary: 'Give feedback to a colleague' })
  @ApiResponse({ status: 201, description: 'Feedback recorded' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Receiver not found' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFeedbackDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.feedbackService.create(user.tenantId, user.employeeId, dto);
  }

  /**
   * Feedback written about me
   * GET /api/feedback/received
   */
  @Get('received')
  @ApiOperation({ summary: 'Get feedback received' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findReceived(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FeedbackQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.feedbackService.findReceived(
      user.tenantId,
      user.employeeId,
      query,
    );
  }

  /**
   * Feedback I wrote about others
   * GET /api/feedback/sent
   */
  @Get('sent')
  @ApiOperation({ summary: 'Get feedback sent' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findSent(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FeedbackQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.feedbackService.findSent(user.tenantId, user.employeeId, query);
  }

  /**
   * Feedback on my direct reports, where its visibility allows it.
   * GET /api/feedback/team
   */
  @Get('team')
  @ApiOperation({ summary: 'Get feedback on my team (non-private only)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async findTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FeedbackQueryDto,
  ) {
    return this.feedbackService.findTeam(
      user.tenantId,
      user.employeeId,
      user.role,
      query,
    );
  }

  /**
   * GET /api/feedback/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get feedback by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.feedbackService.findById(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
    );
  }

  /**
   * DELETE /api/feedback/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete feedback' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.feedbackService.delete(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
    );
  }
}
