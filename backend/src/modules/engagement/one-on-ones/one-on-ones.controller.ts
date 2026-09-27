import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { OneOnOnesService } from './one-on-ones.service';
import {
  AddActionItemDto,
  CreateOneOnOneDto,
  ListOneOnOnesDto,
  OpenItemsQueryDto,
  UpdateActionItemDto,
  UpdateOneOnOneDto,
  UpsertPrivateNoteDto,
} from './dto/one-on-one.dto';

/**
 * One-on-one meetings between a manager and a report. Every route is open to
 * all roles: access is decided per-record by whether the caller is one of
 * the meeting's two stored participants, not by role.
 */
@ApiTags('engagement-one-on-ones')
@ApiBearerAuth()
@Controller('engagement/one-on-ones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OneOnOnesController {
  constructor(private readonly oneOnOnesService: OneOnOnesService) {}

  private requireEmployeeId(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return user.employeeId;
  }

  @Get()
  @ApiOperation({ summary: 'List my one-on-ones' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOneOnOnesDto) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.list(user.tenantId, employeeId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a one-on-one with my manager or a direct report' })
  @ApiResponse({ status: 201, description: 'Scheduled' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOneOnOneDto) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.create(user.tenantId, employeeId, dto);
  }

  /**
   * Declared before `:id` so "open-items" is not swallowed as a meeting id.
   */
  @Get('open-items')
  @ApiOperation({ summary: 'Undone action items shared with a counterpart' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async openItems(@CurrentUser() user: AuthenticatedUser, @Query() query: OpenItemsQueryDto) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.openItems(user.tenantId, employeeId, query.counterpartId);
  }

  /**
   * Declared before `:id` so "counterparts" is not swallowed as a meeting id.
   */
  @Get('counterparts')
  @ApiOperation({ summary: 'My manager and active direct reports, for the schedule picker' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async counterparts(@CurrentUser() user: AuthenticatedUser) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.counterparts(user.tenantId, employeeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a one-on-one' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.get(user.tenantId, employeeId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a one-on-one (reschedule, notes, status)' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOneOnOneDto,
  ) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.update(user.tenantId, employeeId, id, dto);
  }

  @Post(':id/action-items')
  @ApiOperation({ summary: 'Add an action item' })
  @ApiResponse({ status: 201, description: 'Added' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddActionItemDto,
  ) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.addItem(user.tenantId, employeeId, id, dto);
  }

  @Patch(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Update an action item' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateActionItemDto,
  ) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.updateItem(user.tenantId, employeeId, id, itemId, dto);
  }

  @Delete(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Remove an action item' })
  @ApiResponse({ status: 200, description: 'Removed' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.removeItem(user.tenantId, employeeId, id, itemId);
  }

  @Put(':id/private-note')
  @ApiOperation({ summary: 'Save my private note. Only I can ever read it.' })
  @ApiResponse({ status: 200, description: 'Saved' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async savePrivateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertPrivateNoteDto,
  ) {
    const employeeId = this.requireEmployeeId(user);
    return this.oneOnOnesService.upsertPrivateNote(user.tenantId, employeeId, id, dto);
  }
}
