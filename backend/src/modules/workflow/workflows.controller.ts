import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole, WorkflowEntityType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { UpsertWorkflowDto } from './dto/upsert-workflow.dto';

/** Admin builder for approval chains. */
@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class WorkflowsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  /**
   * Every request type's chain (the built-in default when not customised)
   * GET /api/workflows
   */
  @Get()
  @ApiOperation({ summary: 'List approval workflows for all request types' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.definitions.list(user.tenantId);
  }

  /**
   * GET /api/workflows/:entityType
   */
  @Get(':entityType')
  @ApiOperation({ summary: 'Get the approval workflow of one request type' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Unknown request type' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
  ) {
    return this.definitions.get(user.tenantId, entityType);
  }

  /**
   * Replace the chain. Affects requests that enter approval afterwards.
   * PUT /api/workflows/:entityType
   */
  @Put(':entityType')
  @ApiOperation({ summary: 'Save the approval workflow of one request type' })
  @ApiResponse({ status: 200, description: 'Saved' })
  @ApiResponse({ status: 400, description: 'Invalid workflow' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
    @Body() dto: UpsertWorkflowDto,
  ) {
    return this.definitions.upsert(user.tenantId, entityType, dto);
  }

  /**
   * Back to the built-in default.
   * DELETE /api/workflows/:entityType
   */
  @Delete(':entityType')
  @ApiOperation({ summary: 'Reset a request type to the built-in approval workflow' })
  @ApiResponse({ status: 200, description: 'Reset; returns the default workflow' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType', new ParseEnumPipe(WorkflowEntityType)) entityType: WorkflowEntityType,
  ) {
    return this.definitions.reset(user.tenantId, entityType);
  }
}
