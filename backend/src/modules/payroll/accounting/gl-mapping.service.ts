import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { GlMappingView, GlMappingsResponse } from './accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7): per-tenant GL mapping. Scaffold stub.
 */
@Injectable()
export class GlMappingService {
  constructor(private readonly prisma: PrismaService) {}

  getMappings(tenantId: string): Promise<GlMappingsResponse> {
    void tenantId;
    throw new NotImplementedException();
  }

  /** Replaces the tenant's whole mapping set; audit-logged. */
  replaceMappings(actor: AuthenticatedUser, mappings: GlMappingView[]): Promise<GlMappingsResponse> {
    void actor;
    void mappings;
    throw new NotImplementedException();
  }
}
