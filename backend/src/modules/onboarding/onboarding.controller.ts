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
import { OnboardingService } from './onboarding.service';
import {
  CreateOnboardingTemplateDto,
  UpdateOnboardingTemplateDto,
  CreateOnboardingProcessDto,
  UpdateOnboardingTaskDto,
  OnboardingQueryDto,
} from './dto/onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  // ============================================
  // Templates (Admin)
  // ============================================

  @Get('templates')
  @ApiOperation({ summary: 'Get all onboarding templates' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.getTemplates(user.tenantId);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get onboarding template by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.onboardingService.getTemplate(user.tenantId, id);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create onboarding template' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnboardingTemplateDto,
  ) {
    return this.onboardingService.createTemplate(user.tenantId, dto);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Update onboarding template' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingTemplateDto,
  ) {
    return this.onboardingService.updateTemplate(user.tenantId, id, dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete onboarding template' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.onboardingService.deleteTemplate(user.tenantId, id);
    return { message: 'Template deleted' };
  }

  // ============================================
  // Processes (Admin)
  // ============================================

  @Get('processes')
  @ApiOperation({ summary: 'Get all onboarding processes' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getProcesses(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OnboardingQueryDto,
  ) {
    return this.onboardingService.getProcesses(user.tenantId, query);
  }

  @Get('processes/:id')
  @ApiOperation({ summary: 'Get onboarding process by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getProcess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.onboardingService.getProcess(user.tenantId, id);
  }

  @Post('processes')
  @ApiOperation({ summary: 'Create onboarding process' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createProcess(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnboardingProcessDto,
  ) {
    return this.onboardingService.createProcess(user.tenantId, dto);
  }

  @Post('processes/:id/cancel')
  @ApiOperation({ summary: 'Cancel onboarding process' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async cancelProcess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.onboardingService.cancelProcess(user.tenantId, id);
  }

  @Delete('processes/:id')
  @ApiOperation({ summary: 'Delete onboarding process' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteProcess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.onboardingService.deleteProcess(user.tenantId, id);
    return { message: 'Process deleted' };
  }

  // ============================================
  // Tasks
  // ============================================

  @Get('my-tasks')
  @ApiOperation({ summary: 'Get my onboarding tasks' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyTasks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OnboardingQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.onboardingService.getMyTasks(
      user.tenantId,
      user.employeeId,
      query,
    );
  }

  @Put('tasks/:id')
  @ApiOperation({ summary: 'Update onboarding task' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingTaskDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.onboardingService.updateTask(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete onboarding task' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async completeTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.onboardingService.completeTask(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
    );
  }
}
