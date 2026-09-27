import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AccountingConfigView } from './accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7): export settings. A tenant with no row reads
 * the schema defaults. Scaffold stub.
 */
@Injectable()
export class AccountingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  get(tenantId: string): Promise<AccountingConfigView> {
    void tenantId;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, input: Partial<AccountingConfigView>): Promise<AccountingConfigView> {
    void actor;
    void input;
    throw new NotImplementedException();
  }
}
