import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { PeerReviewsService } from './peer-reviews.service';
import { AddPeerDto, PeerDecisionDto, SubmitPeerFeedbackDto } from './dto/peer-reviews.dto';

const ALL_ROLES = [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE] as const;

/** Peer-side routes act as the caller's own employee; refuse before any query uses the id. */
function requireEmployee(user: AuthenticatedUser): void {
  if (!user.employeeId) {
    throw new BadRequestException('No employee profile linked to your account');
  }
}

/**
 * 360 peer feedback (spec F5). Every role may call these routes; the service
 * decides what the caller's relation to the review allows.
 */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeerReviewsController {
  constructor(private peerReviewsService: PeerReviewsService) {}

  // ---------- Review side: employee, reviewer, admin ----------

  @Get('reviews/:id/peers')
  @ApiOperation({ summary: 'List peers for a review (shaped per viewer)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  listForReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.peerReviewsService.listForReview(user, id);
  }

  @Post('reviews/:id/peers')
  @ApiOperation({ summary: 'Nominate a peer (employee) or add an approved peer (reviewer/admin)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Closed, cap reached or invalid peer' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Peer already added' })
  @Roles(...ALL_ROLES)
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPeerDto,
  ) {
    return this.peerReviewsService.add(user, id, dto);
  }

  @Delete('reviews/:id/peers/:peerReviewId')
  @ApiOperation({ summary: 'Withdraw a pending nomination (employee)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('peerReviewId') peerReviewId: string,
  ) {
    return this.peerReviewsService.withdraw(user, id, peerReviewId);
  }

  @Post('reviews/:id/peers/:peerReviewId/decision')
  @ApiOperation({ summary: 'Approve or reject a nomination (reviewer/admin)' })
  @ApiResponse({ status: 201, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('peerReviewId') peerReviewId: string,
    @Body() dto: PeerDecisionDto,
  ) {
    return this.peerReviewsService.decide(user, id, peerReviewId, dto.approve);
  }

  // ---------- Peer side: the person asked for feedback ----------

  @Get('peer-requests')
  @ApiOperation({ summary: 'My peer feedback requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Roles(...ALL_ROLES)
  myRequests(@CurrentUser() user: AuthenticatedUser) {
    requireEmployee(user);
    return this.peerReviewsService.myRequests(user);
  }

  @Get('peer-requests/:id')
  @ApiOperation({ summary: 'One of my peer feedback requests' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  getRequest(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    requireEmployee(user);
    return this.peerReviewsService.getRequest(user, id);
  }

  @Post('peer-requests/:id/submit')
  @ApiOperation({ summary: 'Submit peer feedback' })
  @ApiResponse({ status: 201, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Closed or invalid answers' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitPeerFeedbackDto,
  ) {
    requireEmployee(user);
    return this.peerReviewsService.submit(user, id, dto);
  }

  @Post('peer-requests/:id/decline')
  @ApiOperation({ summary: 'Decline a peer feedback request' })
  @ApiResponse({ status: 201, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Closed or already answered' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(...ALL_ROLES)
  decline(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    requireEmployee(user);
    return this.peerReviewsService.decline(user, id);
  }
}
