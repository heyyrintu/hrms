import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkflowEntityType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from './approval-engine.service';
import { WorkflowRegistry } from './workflow-registry.service';
import { DelegationsService } from './delegations.service';
import { ApprovalNoteDto } from './dto/approval-note.dto';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { ListDelegationsDto } from './dto/list-delegations.dto';
import { SearchUsersDto } from './dto/search-users.dto';

/**
 * Unified approvals for every role: the cross-type inbox, approval trails,
 * approve / reject (routed to the owning domain's handler) and delegations.
 * Static routes are declared before the `:entityType/...` ones.
 */
@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalsController {
  constructor(
    private readonly engine: ApprovalEngineService,
    private readonly registry: WorkflowRegistry,
    private readonly delegations: DelegationsService,
  ) {}

  /**
   * GET /api/approvals/inbox
   */
  @Get('inbox')
  @ApiOperation({ summary: 'Requests waiting for my approval, across every type' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async inbox(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.engine.getInbox(user) };
  }

  /**
   * GET /api/approvals/delegations
   */
  @Get('delegations')
  @ApiOperation({ summary: 'Delegations I gave and received (HR: ?all=true for the tenant)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listDelegations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDelegationsDto,
  ) {
    return this.delegations.list(user, query.all === true);
  }

  /**
   * POST /api/approvals/delegations
   */
  @Post('delegations')
  @ApiOperation({ summary: 'Hand my approvals to someone else for a date range' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid delegation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createDelegation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDelegationDto,
  ) {
    return this.delegations.create(user, dto);
  }

  /**
   * DELETE /api/approvals/delegations/:id
   */
  @Delete('delegations/:id')
  @ApiOperation({ summary: 'Cancel a delegation (delegator or HR)' })
  @ApiResponse({ status: 200, description: 'Cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async cancelDelegation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.delegations.cancel(user, id);
  }

  /**
   * GET /api/approvals/users?search=
   */
  @Get('users')
  @ApiOperation({ summary: 'Search active users (approver and delegate pickers)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchUsers(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchUsersDto) {
    return this.delegations.searchUsers(user.tenantId, query.search);
  }

  /**
   * GET /api/approvals/:entityType/:entityId/trail
   */
  @Get(':entityType/:entityId/trail')
  @ApiOperation({ summary: 'Approval trail of one request (current round)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'No approval for this request' })
  async trail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.engine.getTrail(user, entityType, entityId);
  }

  /**
   * POST /api/approvals/:entityType/:entityId/approve
   */
  @Post(':entityType/:entityId/approve')
  @ApiOperation({ summary: 'Approve the current step of a request' })
  @ApiResponse({ status: 201, description: 'Approved (or advanced to the next step)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not an approver of the current step' })
  @ApiResponse({ status: 404, description: 'Not found or not awaiting approval' })
  @ApiResponse({ status: 409, description: 'Already actioned' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
    @Param('entityId') entityId: string,
    @Body() dto: ApprovalNoteDto,
  ) {
    return this.registry.get(entityType).approve(user, entityId, dto?.note ?? null);
  }

  /**
   * POST /api/approvals/:entityType/:entityId/reject
   */
  @Post(':entityType/:entityId/reject')
  @ApiOperation({ summary: 'Reject a request at its current step' })
  @ApiResponse({ status: 201, description: 'Rejected' })
  @ApiResponse({ status: 400, description: 'This request type cannot be rejected' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not an approver of the current step' })
  @ApiResponse({ status: 404, description: 'Not found or not awaiting approval' })
  @ApiResponse({ status: 409, description: 'Already actioned' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
    @Param('entityId') entityId: string,
    @Body() dto: ApprovalNoteDto,
  ) {
    return this.registry.get(entityType).reject(user, entityId, dto?.note ?? null);
  }
}
