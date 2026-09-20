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
import { PipService } from './pip.service';
import {
  CreateImprovementPlanDto,
  UpdateImprovementPlanDto,
  AddImprovementPlanGoalDto,
  UpdateImprovementPlanGoalDto,
  ImprovementPlanQueryDto,
} from './dto/pip.dto';

@ApiTags('improvement-plans')
@ApiBearerAuth()
@Controller('improvement-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PipController {
  constructor(private pipService: PipService) {}

  @Post()
  @ApiOperation({ summary: 'Create a performance improvement plan' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImprovementPlanDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.pipService.create(user.tenantId, user.employeeId, user.role, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all improvement plans (HR)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ImprovementPlanQueryDto,
  ) {
    return this.pipService.findAll(user.tenantId, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get improvement plans raised against me' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ImprovementPlanQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.pipService.findMine(user.tenantId, user.employeeId, query);
  }

  @Get('team')
  @ApiOperation({ summary: 'Get improvement plans I own as the manager' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ImprovementPlanQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to your account');
    }
    return this.pipService.findTeam(user.tenantId, user.employeeId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get improvement plan by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.pipService.findById(user.tenantId, id, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an improvement plan' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateImprovementPlanDto,
  ) {
    return this.pipService.update(user.tenantId, id, user, dto);
  }

  @Post(':id/goals')
  @ApiOperation({ summary: 'Add a goal to an improvement plan' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async addGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddImprovementPlanGoalDto,
  ) {
    return this.pipService.addGoal(user.tenantId, id, user, dto);
  }

  // Not role-restricted: the plan's employee ticks off their own goals here.
  @Put(':id/goals/:goalId')
  @ApiOperation({ summary: 'Update a goal on an improvement plan' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateImprovementPlanGoalDto,
  ) {
    return this.pipService.updateGoal(user.tenantId, id, goalId, user, dto);
  }

  @Delete(':id/goals/:goalId')
  @ApiOperation({ summary: 'Delete a goal from an improvement plan' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  async deleteGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('goalId') goalId: string,
  ) {
    return this.pipService.deleteGoal(user.tenantId, id, goalId, user);
  }
}
