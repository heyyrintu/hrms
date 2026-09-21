import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HelpdeskService } from './helpdesk.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const isHr = (role: UserRole) =>
  role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;

@ApiTags('helpdesk')
@ApiBearerAuth()
@Controller('helpdesk')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HelpdeskController {
  constructor(private helpdeskService: HelpdeskService) {}

  // ============================================
  // Categories
  // ============================================

  /**
   * GET /api/helpdesk/categories
   *
   * Readable by everyone because the new-ticket form needs it; only HR can
   * see the retired ones, and only HR can change them.
   */
  @Get('categories')
  @ApiOperation({ summary: 'List helpdesk categories' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const wantsInactive = includeInactive === 'true' && isHr(user.role);
    return this.helpdeskService.listCategories(user.tenantId, wantsInactive);
  }

  /**
   * POST /api/helpdesk/categories
   */
  @Post('categories')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a helpdesk category' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Code already used' })
  async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.helpdeskService.createCategory(user.tenantId, dto);
  }

  /**
   * PUT /api/helpdesk/categories/:id
   */
  @Put('categories/:id')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a helpdesk category' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.helpdeskService.updateCategory(user.tenantId, id, dto);
  }

  // ============================================
  // Stats
  // ============================================

  /**
   * GET /api/helpdesk/stats
   */
  @Get('stats')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Helpdesk queue stats' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getStats(@CurrentUser() user: AuthenticatedUser) {
    return this.helpdeskService.getStats(user.tenantId);
  }

  // ============================================
  // Tickets
  // ============================================

  /**
   * POST /api/helpdesk/tickets
   */
  @Post('tickets')
  @ApiOperation({ summary: 'Raise a helpdesk ticket' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller has no employee record' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTicketDto,
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('User is not linked to an employee');
    }
    return this.helpdeskService.createTicket(user.tenantId, user.employeeId, dto);
  }

  /**
   * GET /api/helpdesk/tickets/my
   *
   * Declared before `tickets/:id` so "my" is not read as an id.
   */
  @Get('tickets/my')
  @ApiOperation({ summary: 'Tickets I raised' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller has no employee record' })
  async findMyTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTicketsDto,
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('User is not linked to an employee');
    }
    return this.helpdeskService.findMyTickets(
      user.tenantId,
      user.employeeId,
      query,
    );
  }

  /**
   * GET /api/helpdesk/tickets
   */
  @Get('tickets')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'The helpdesk queue' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTicketsDto,
  ) {
    return this.helpdeskService.findAll(user.tenantId, query);
  }

  /**
   * GET /api/helpdesk/tickets/:id
   */
  @Get('tickets/:id')
  @ApiOperation({ summary: 'One ticket with its comment thread' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.helpdeskService.findById(user.tenantId, id, user);
  }

  /**
   * POST /api/helpdesk/tickets/:id/assign
   */
  @Post('tickets/:id/assign')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign a ticket to an agent' })
  @ApiResponse({ status: 201, description: 'Assigned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Ticket or assignee not found' })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.helpdeskService.assign(user.tenantId, id, dto);
  }

  /**
   * POST /api/helpdesk/tickets/:id/status
   */
  @Post('tickets/:id/status')
  @ApiOperation({ summary: 'Move a ticket to another status' })
  @ApiResponse({ status: 201, description: 'Status changed' })
  @ApiResponse({ status: 400, description: 'Transition not allowed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.helpdeskService.changeStatus(user.tenantId, id, dto, user);
  }

  /**
   * POST /api/helpdesk/tickets/:id/comments
   */
  @Post('tickets/:id/comments')
  @ApiOperation({ summary: 'Add a comment to a ticket' })
  @ApiResponse({ status: 201, description: 'Comment added' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.helpdeskService.addComment(user.tenantId, id, dto, user);
  }
}
