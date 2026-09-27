import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto, MoveApplicationDto, RejectApplicationDto } from './dto/application.dto';

/**
 * Applications. MANAGER: applications of openings they manage.
 *   POST /recruitment/applications (HR)
 *   GET /recruitment/applications/:id
 *   POST /recruitment/applications/:id/move | /reject | /withdraw (withdraw HR)
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApplicationDto) {
    return this.service.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post(':id/move')
  move(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: MoveApplicationDto) {
    return this.service.move(user, id, dto);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.service.reject(user, id, dto.reason);
  }

  @Post(':id/withdraw')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.withdraw(user, id);
  }
}
