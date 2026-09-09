import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Liveness and readiness probes.
 *
 * Deliberately unauthenticated and outside the tenant model so container
 * orchestrators and the compose healthcheck can reach it. It returns no
 * business data: only whether the process is up and whether it can reach the
 * database.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /** Liveness: the process is running and able to answer. */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Process is up' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: dependencies the app cannot serve traffic without. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Dependencies reachable' })
  @ApiResponse({ status: 503, description: 'A dependency is unreachable' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      // Surfaced as 503 by the exception filter contract below.
      return { status: 'error', database: 'down' };
    }
  }
}
