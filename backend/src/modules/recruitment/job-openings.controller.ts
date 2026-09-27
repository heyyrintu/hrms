import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { JobOpeningsService } from './job-openings.service';
import { CreateJobOpeningDto, UpdateJobOpeningDto } from './dto/job-opening.dto';

/**
 * Job openings. MANAGER: openings they manage (read); HR/SUPER: all.
 *   GET|POST /recruitment/openings
 *   GET|PATCH /recruitment/openings/:id
 *   POST /recruitment/openings/:id/publish | /hold | /close
 *   GET /recruitment/openings/:id/applications
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/openings')
export class JobOpeningsController {
  constructor(private readonly service: JobOpeningsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.service.list(user, { status });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateJobOpeningDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobOpeningDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/publish')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.publish(user, id);
  }

  @Post(':id/hold')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  hold(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.hold(user, id);
  }

  @Post(':id/close')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.close(user, id);
  }

  @Get(':id/applications')
  listApplications(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listApplications(user, id);
  }
}
