import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UtilisationService } from './utilisation.service';

/** Utilisation report (Keka wave G, WS-T). Scaffold shell. */
@ApiTags('utilisation')
@ApiBearerAuth()
@Controller('utilisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UtilisationController {
  constructor(
    private readonly utilisation: UtilisationService,
  ) {}
}
