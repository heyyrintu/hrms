import { Controller, Get, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lightweight endpoint any authenticated user can call to get their own
 * tenant's basic branding info (name, logoUrl). Used by the sidebar.
 */
@ApiTags('tenant-info')
@ApiBearerAuth()
@Controller('tenant-info')
@UseGuards(JwtAuthGuard)
export class TenantInfoController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get current tenant basic info (logo, name)' })
  @ApiResponse({ status: 200, description: 'Returns id, name, code, logoUrl' })
  async getMyTenantInfo(@CurrentUser() user: AuthenticatedUser) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { id: true, name: true, code: true, logoUrl: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}
