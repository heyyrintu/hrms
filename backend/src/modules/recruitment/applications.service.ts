import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  ApplicationDetailView,
  CareersApplicationInput,
  CareersApplicationResult,
  MoveApplicationInput,
} from './recruitment.types';

/**
 * Applications and stage moves (with JobApplicationStageEvent history).
 * Scaffold stub (Keka wave D) — implemented by WS-D1.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(actor: AuthenticatedUser, input: { candidateId: string; jobOpeningId: string; source?: string }): Promise<ApplicationDetailView> {
    void actor;
    void input;
    throw new NotImplementedException();
  }

  get(actor: AuthenticatedUser, id: string): Promise<ApplicationDetailView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  move(actor: AuthenticatedUser, id: string, input: { stageId: string; note?: string | null }): Promise<ApplicationDetailView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  reject(actor: AuthenticatedUser, id: string, reason: string): Promise<ApplicationDetailView> {
    void actor;
    void id;
    void reason;
    throw new NotImplementedException();
  }

  withdraw(actor: AuthenticatedUser, id: string): Promise<ApplicationDetailView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  /** Shared contract, consumed by WS-D2. Accepts a transaction client. */
  moveToStage(input: MoveApplicationInput): Promise<void> {
    void input;
    throw new NotImplementedException();
  }

  /** Consumed by WS-D3 (public apply). Duplicate → { created: false }. */
  createFromCareers(input: CareersApplicationInput): Promise<CareersApplicationResult> {
    void input;
    throw new NotImplementedException();
  }
}
