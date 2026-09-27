import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApplicationCardView, JobOpeningView } from './recruitment.types';

/**
 * Job openings (slug per tenant, publish / hold / close).
 * Scaffold stub (Keka wave D) — implemented by WS-D1.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class JobOpeningsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthenticatedUser, query: { status?: string }): Promise<JobOpeningView[]> {
    void actor;
    void query;
    throw new NotImplementedException();
  }

  get(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  create(actor: AuthenticatedUser, input: Record<string, unknown>): Promise<JobOpeningView> {
    void actor;
    void input;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, id: string, input: Record<string, unknown>): Promise<JobOpeningView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  publish(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  hold(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  close(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  listApplications(actor: AuthenticatedUser, id: string): Promise<ApplicationCardView[]> {
    void actor;
    void id;
    throw new NotImplementedException();
  }
}
