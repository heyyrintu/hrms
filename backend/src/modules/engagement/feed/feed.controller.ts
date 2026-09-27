import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
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
import { FeedQueryService } from './feed-query.service';
import { ReactToFeedItemDto } from './dto/react-to-feed-item.dto';

/** Social feed read side: listing, reactions, hiding. Writes come from FeedService producers. */
@ApiTags('engagement-feed')
@ApiBearerAuth()
@Controller('engagement/feed')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedController {
  constructor(private readonly feedQuery: FeedQueryService) {}

  @Get()
  @ApiOperation({ summary: 'List the social feed, newest first' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    const clampedLimit = Math.min(50, Math.max(1, limit));
    return this.feedQuery.list(user.tenantId, user.employeeId, { cursor, limit: clampedLimit });
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'Toggle a reaction on a feed item' })
  @ApiResponse({ status: 201, description: 'Toggled' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async react(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReactToFeedItemDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return this.feedQuery.toggleReaction(user.tenantId, user.employeeId, id, dto.kind);
  }

  @Post(':id/hide')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Hide a feed item for the whole tenant' })
  @ApiResponse({ status: 201, description: 'Hidden' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async hide(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.feedQuery.hide(user.tenantId, id);
    return { success: true };
  }
}
