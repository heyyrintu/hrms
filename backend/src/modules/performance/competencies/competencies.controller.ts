import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CompetenciesService } from './competencies.service';

/** Competency framework (spec F3). Shell from the Keka wave F scaffold; routes are added per workstream. */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompetenciesController {
  constructor(private competenciesService: CompetenciesService) {}
}
