import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/permissions/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ProjectsService } from './projects.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectTasksService } from './project-tasks.service';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectTaskDto,
  LoggableQueryDto,
  ProjectListQueryDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectTaskDto,
} from './dto/project.dto';

/** Projects, members and tasks (Keka wave G, WS-P). */
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly members: ProjectMembersService,
    private readonly tasks: ProjectTasksService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List projects visible to the caller' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ProjectListQueryDto) {
    return this.projects.list(user, query);
  }

  // Declared before `:id` so "loggable" is not captured as an id.
  @Get('loggable')
  @ApiOperation({ summary: 'Active projects the caller can log hours on for a week' })
  loggable(@CurrentUser() user: AuthenticatedUser, @Query() query: LoggableQueryDto) {
    return this.projects.loggable(user, query.weekStart);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('projects.manage')
  @ApiOperation({ summary: 'Create a project' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a visible project' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.projects.get(user, id);
  }

  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('projects.manage')
  @ApiOperation({ summary: 'Update a project' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List project members' })
  listMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.members.list(user, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a project member (admin or project manager)' })
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.members.add(user, id, dto);
  }

  @Put(':id/members/:memberId')
  @ApiOperation({ summary: 'Update a project member (admin or project manager)' })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.members.update(user, id, memberId, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({
    summary: 'Remove a member; ends the membership instead when hours were logged',
  })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.members.remove(user, id, memberId);
  }

  @Get(':id/tasks')
  @ApiOperation({ summary: 'List project tasks' })
  listTasks(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tasks.list(user, id);
  }

  @Post(':id/tasks')
  @ApiOperation({ summary: 'Create a task (admin or project manager)' })
  createTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateProjectTaskDto,
  ) {
    return this.tasks.create(user, id, dto);
  }

  @Put(':id/tasks/:taskId')
  @ApiOperation({ summary: 'Update or close a task (admin or project manager)' })
  updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateProjectTaskDto,
  ) {
    return this.tasks.update(user, id, taskId, dto);
  }

  @Delete(':id/tasks/:taskId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a task without logged hours (admin or project manager)' })
  async deleteTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    await this.tasks.remove(user, id, taskId);
  }
}
