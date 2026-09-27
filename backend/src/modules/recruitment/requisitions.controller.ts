import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { RequisitionsService } from './requisitions.service';
import { CreateRequisitionDto, UpdateRequisitionDto } from './dto/requisition.dto';

/**
 * Job requisitions. MANAGER: own requisitions; HR/SUPER: all.
 *   GET|POST /recruitment/requisitions
 *   GET|PATCH /recruitment/requisitions/:id
 *   POST /recruitment/requisitions/:id/submit | /cancel
 *   (approve / reject: POST /approvals/JOB_REQUISITION/:id/approve|reject)
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/requisitions')
export class RequisitionsController {
  constructor(private readonly service: RequisitionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.service.list(user, { status });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequisitionDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequisitionDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.submit(user, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }
}
