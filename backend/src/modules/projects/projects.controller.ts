import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ProjectsService } from './projects.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectTasksService } from './project-tasks.service';

/** Projects, members and tasks (Keka wave G, WS-P). Scaffold shell. */
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
}
