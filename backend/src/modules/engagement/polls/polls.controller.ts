import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { PollsService } from './polls.service';
import { CreatePollDto } from './dto/create-poll.dto';
import { VoteDto } from './dto/vote.dto';
import { ListPollsDto } from './dto/list-polls.dto';

const ADMIN_ROLES: UserRole[] = [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN];

@ApiTags('engagement-polls')
@ApiBearerAuth()
@Controller('engagement/polls')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  /** Declared before `:id`-shaped routes so "active" is never swallowed as a poll id. */
  @Get('active')
  @ApiOperation({ summary: 'Open polls, with results per the visibility rule' })
  @ApiResponse({ status: 200, description: 'Success' })
  async active(@CurrentUser() user: AuthenticatedUser) {
    const isAdmin = ADMIN_ROLES.includes(user.role);
    return this.pollsService.active(user.tenantId, user.employeeId, isAdmin);
  }

  @Get()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'List all polls, any status, paginated' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPollsDto) {
    return this.pollsService.list(user.tenantId, query.page ?? 1, query.limit ?? 20);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a poll' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePollDto) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return this.pollsService.create(user.tenantId, user.employeeId, dto);
  }

  @Post(':id/vote')
  @ApiOperation({ summary: 'Vote on a poll' })
  @ApiResponse({ status: 201, description: 'Voted' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Already voted' })
  async vote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VoteDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return this.pollsService.vote(user.tenantId, id, user.employeeId, dto);
  }

  @Post(':id/close')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Close a poll' })
  @ApiResponse({ status: 201, description: 'Closed' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pollsService.close(user.tenantId, id);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Delete a poll of any status (cascades)' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pollsService.remove(user.tenantId, id);
  }
}
