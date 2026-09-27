import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CandidateDetailView, CandidateView, CareersCandidateInput } from './recruitment.types';

/**
 * Candidates, deduplicated by email per tenant.
 * Scaffold stub (Keka wave D) — implemented by WS-D1.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthenticatedUser, query: { search?: string }): Promise<CandidateView[]> {
    void actor;
    void query;
    throw new NotImplementedException();
  }

  get(actor: AuthenticatedUser, id: string): Promise<CandidateDetailView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  create(actor: AuthenticatedUser, input: Record<string, unknown>): Promise<CandidateView> {
    void actor;
    void input;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, id: string, input: Record<string, unknown>): Promise<CandidateView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  /**
   * Consumed by WS-D3 (public apply): reuse by email, fill only empty fields.
   */
  findOrCreateForCareers(input: CareersCandidateInput): Promise<{ candidateId: string; created: boolean }> {
    void input;
    throw new NotImplementedException();
  }
}
