import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SecurityUsersService } from './security-users.service';

/**
 * /security/users and role assignment. Routes added by WS-1 (plan Tasks 1.2–1.3).
 * Security administration stays with the fixed admin roles; it is not a
 * grantable permission (spec P8).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('security/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class SecurityUsersController {
  constructor(private readonly service: SecurityUsersService) {}
}
