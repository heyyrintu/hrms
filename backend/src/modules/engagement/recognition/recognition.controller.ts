import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { RecognitionService } from './recognition.service';
import { BadgesService } from './badges.service';
import { RecognitionLeaderboardService } from './recognition-leaderboard.service';
import {
  BadgesQueryDto,
  CreateBadgeDto,
  GiveRecognitionDto,
  LeaderboardQueryDto,
  UpdateBadgeDto,
  WallQueryDto,
} from './dto/recognition.dto';

const ALL_ROLES = [UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN];
const HR_ROLES = [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN];

function isHr(role: UserRole): boolean {
  return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
}

/** Badges, kudos with optional points, and the leaderboard. */
@ApiTags('engagement-recognition')
@ApiBearerAuth()
@Controller('engagement/recognition')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecognitionController {
  constructor(
    private readonly recognitionService: RecognitionService,
    private readonly badgesService: BadgesService,
    private readonly leaderboardService: RecognitionLeaderboardService,
  ) {}

  /**
   * The recognition wall
   * GET /api/engagement/recognition
   */
  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Recognition wall, newest first' })
  @ApiResponse({ status: 200, description: 'Paginated recognitions' })
  wall(@CurrentUser() user: AuthenticatedUser, @Query() query: WallQueryDto) {
    return this.recognitionService.wall(user.tenantId, query);
  }

  /**
   * Give recognition
   * POST /api/engagement/recognition
   */
  @Post()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Give recognition to one or more employees' })
  @ApiResponse({ status: 201, description: 'Recognition created' })
  @ApiResponse({ status: 400, description: 'Validation or allowance error' })
  async give(@CurrentUser() user: AuthenticatedUser, @Body() dto: GiveRecognitionDto) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return this.recognitionService.give(user.tenantId, user.employeeId, dto);
  }

  /**
   * My own points summary
   * GET /api/engagement/recognition/me
   *
   * Declared before `:id` so "me" is never swallowed as a recognition id.
   */
  @Get('me')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'My recognition and points summary' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return this.recognitionService.me(user.tenantId, user.employeeId);
  }

  /**
   * Leaderboard
   * GET /api/engagement/recognition/leaderboard
   */
  @Get('leaderboard')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Top 20 recognised employees for a period' })
  leaderboard(@CurrentUser() user: AuthenticatedUser, @Query() query: LeaderboardQueryDto) {
    return this.leaderboardService.leaderboard(user.tenantId, query.period ?? 'month');
  }

  /**
   * Badge catalog (seeds five defaults the first time a tenant has none)
   * GET /api/engagement/recognition/badges
   */
  @Get('badges')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'List badges' })
  badges(@CurrentUser() user: AuthenticatedUser, @Query() query: BadgesQueryDto) {
    const includeInactive = isHr(user.role) && !!query.includeInactive;
    return this.badgesService.list(user.tenantId, includeInactive);
  }

  /**
   * Create a badge (HR/SUPER)
   * POST /api/engagement/recognition/badges
   */
  @Post('badges')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Create a badge' })
  @ApiResponse({ status: 201, description: 'Badge created' })
  @ApiResponse({ status: 409, description: 'A badge with this name already exists' })
  createBadge(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBadgeDto) {
    return this.badgesService.create(user.tenantId, dto);
  }

  /**
   * Update a badge (HR/SUPER)
   * PUT /api/engagement/recognition/badges/:id
   */
  @Put('badges/:id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Update a badge' })
  @ApiResponse({ status: 404, description: 'Badge not found' })
  @ApiResponse({ status: 409, description: 'A badge with this name already exists' })
  updateBadge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBadgeDto,
  ) {
    return this.badgesService.update(user.tenantId, id, dto);
  }

  /**
   * Deactivate a badge (HR/SUPER). History keeps referencing it.
   * DELETE /api/engagement/recognition/badges/:id
   */
  @Delete('badges/:id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Deactivate a badge' })
  @ApiResponse({ status: 404, description: 'Badge not found' })
  deactivateBadge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.badgesService.deactivate(user.tenantId, id);
  }

  /**
   * Delete a recognition (HR/SUPER)
   * DELETE /api/engagement/recognition/:id
   */
  @Delete(':id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Delete a recognition' })
  @ApiResponse({ status: 404, description: 'Recognition not found' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recognitionService.remove(user.tenantId, id);
  }
}
