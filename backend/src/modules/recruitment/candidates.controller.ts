import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CandidatesService } from './candidates.service';
import { CreateCandidateDto, UpdateCandidateDto } from './dto/candidate.dto';

/**
 * Candidates (HR/SUPER).
 *   GET|POST /recruitment/candidates
 *   GET|PATCH /recruitment/candidates/:id
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment/candidates')
export class CandidatesController {
  constructor(private readonly service: CandidatesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string) {
    return this.service.list(user, { search });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCandidateDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCandidateDto) {
    return this.service.update(user, id, dto);
  }
}
