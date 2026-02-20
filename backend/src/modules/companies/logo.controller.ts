import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Public logo endpoint – no authentication required.
 * Logos are brand assets that must be loadable inside <img> tags without
 * custom Authorization headers, so auth is intentionally omitted here.
 */
@ApiTags('companies')
@Controller('companies')
export class LogoController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * Serve company logo – public, no auth
   * GET /api/companies/:id/logo
   */
  @Get(':id/logo')
  @ApiOperation({ summary: 'Get company logo (public, no auth required)' })
  @ApiResponse({ status: 200, description: 'Logo image' })
  @ApiResponse({ status: 404, description: 'No logo configured or file not found' })
  async getLogo(@Param('id') id: string, @Res() res: Response) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { logoUrl: true },
    });

    if (!tenant?.logoUrl) {
      return res.status(404).end();
    }

    let filePath: string;
    try {
      filePath = await this.storage.getFilePath(tenant.logoUrl);
    } catch {
      return res.status(404).end();
    }

    const ext = path.extname(tenant.logoUrl).toLowerCase();
    res.set('Content-Type', MIME_MAP[ext] ?? 'image/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  }
}
