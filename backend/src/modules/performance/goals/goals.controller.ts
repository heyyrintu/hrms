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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';
import { GoalsService } from './goals.service';
import {
  CreateGoalDto,
  GoalQueryDto,
  GoalTreeQueryDto,
  KeyResultDto,
  UpdateGoalDto,
  UpdateKeyResultDto,
} from './dto/goals.dto';

const ALL_ROLES = [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE];

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoalsController {
  constructor(private goalsService: GoalsService) {}

  // ============================================
  // Goals
  // ============================================

  @Get('my-goals')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Get my performance goals' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'No employee profile linked to your account' })
  async getMyGoals(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.goalsService.getMyGoals(user);
  }

  @Get('goals')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'List goals by scope (mine, team, company, department)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'No employee profile linked to your account' })
  @ApiResponse({ status: 403, description: 'Team scope is for managers and admins' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: GoalQueryDto) {
    if (query.scope === 'mine' && !user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.goalsService.list(user, query);
  }

  // Declared before goals/:id so "tree" is not read as an id.
  @Get('goals/tree')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Alignment tree of the goals you may see' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Root goal not found' })
  async tree(@CurrentUser() user: AuthenticatedUser, @Query() query: GoalTreeQueryDto) {
    return this.goalsService.tree(user, query.rootId);
  }

  @Get('goals/:id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Get a goal with key results, parent and children' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getGoal(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goalsService.getGoal(user, id);
  }

  @Post('goals')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Create a goal (admins for company/department goals)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Validation or alignment error' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createGoal(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGoalDto) {
    return this.goalsService.createGoal(user, dto);
  }

  @Put('goals/:id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Update a goal' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Validation, locked or derived-progress error' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goalsService.updateGoal(user, id, dto);
  }

  @Delete('goals/:id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Delete a goal' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Locked, or it still has child goals' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteGoal(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goalsService.deleteGoal(user, id);
  }

  // ============================================
  // Key results
  // ============================================

  @Post('goals/:id/key-results')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Add a key result to a goal' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async addKeyResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: KeyResultDto,
  ) {
    return this.goalsService.addKeyResult(user, id, dto);
  }

  @Put('goals/:id/key-results/:krId')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Update a key result' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateKeyResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Body() dto: UpdateKeyResultDto,
  ) {
    return this.goalsService.updateKeyResult(user, id, krId, dto);
  }

  @Delete('goals/:id/key-results/:krId')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Delete a key result' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async removeKeyResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
  ) {
    return this.goalsService.removeKeyResult(user, id, krId);
  }
}
