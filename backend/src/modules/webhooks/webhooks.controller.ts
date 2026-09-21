import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookLogQueryDto,
} from './dto/webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

/**
 * A webhook forwards HR data — names, salaries, leave reasons — to a third
 * party the company chose. Reading the list tells you where that data goes;
 * creating one decides where it goes next. Both are administration, so every
 * route here is SUPER_ADMIN and HR_ADMIN only, with no read-only tier.
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  // Declared before `:id` — otherwise Nest matches "events" as a webhook id.
  @Get('events')
  @ApiOperation({ summary: 'List the event names a webhook may subscribe to' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getEvents() {
    return this.webhooksService.getEvents();
  }

  @Get()
  @ApiOperation({ summary: 'Get all webhooks for the tenant' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.findAll(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a webhook by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.webhooksService.findById(user.tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a webhook' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid URL or event name' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooksService.create(user.tenantId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Invalid URL or event name' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook and its delivery history' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.webhooksService.delete(user.tenantId, id);
  }

  @Post(':id/test')
  @ApiOperation({
    summary: 'Send a signed test delivery and return the resulting log row',
  })
  @ApiResponse({ status: 201, description: 'Delivery attempted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.webhooksService.sendTest(user.tenantId, id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get the delivery log for a webhook, newest first' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: WebhookLogQueryDto,
  ) {
    return this.webhooksService.getLogs(user.tenantId, id, query);
  }
}
