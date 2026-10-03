import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RotationPatternsService } from './rotation-patterns.service';
import { RosterService } from './roster.service';

/** Shift roster (Keka wave G, WS-R). Scaffold shell: WS-R adds the routes. */
@ApiTags('roster')
@ApiBearerAuth()
@Controller('roster')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RosterController {
  constructor(
    private readonly patterns: RotationPatternsService,
    private readonly roster: RosterService,
  ) {}
}
