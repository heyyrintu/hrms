import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectTasksService } from './project-tasks.service';

/** Keka wave G: projects, members and tasks. PrismaModule is global. */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectMembersService, ProjectTasksService],
  exports: [ProjectsService, ProjectMembersService, ProjectTasksService],
})
export class ProjectsModule {}
