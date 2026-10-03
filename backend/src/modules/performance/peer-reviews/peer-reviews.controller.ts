import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PeerReviewsService } from './peer-reviews.service';

/** 360 peer feedback (spec F5). Shell from the Keka wave F scaffold; routes are added per workstream. */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeerReviewsController {
  constructor(private peerReviewsService: PeerReviewsService) {}
}
