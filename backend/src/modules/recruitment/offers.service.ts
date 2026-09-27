import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowEntityContext } from '../workflow/workflow.types';
import { OfferView, PublicOfferView } from './recruitment.types';

/**
 * Offers rendered from OFFER_LETTER templates, approved through the engine (OFFER), answered via a public token.
 * Scaffold stub (Keka wave D) — implemented by WS-D2.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthenticatedUser, query: { status?: string }): Promise<OfferView[]> {
    void actor;
    void query;
    throw new NotImplementedException();
  }

  get(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  create(actor: AuthenticatedUser, applicationId: string, input: Record<string, unknown>): Promise<OfferView> {
    void actor;
    void applicationId;
    void input;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, id: string, input: Record<string, unknown>): Promise<OfferView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  submit(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  approve(actor: AuthenticatedUser, id: string, note?: string | null): Promise<OfferView> {
    void actor;
    void id;
    void note;
    throw new NotImplementedException();
  }

  reject(actor: AuthenticatedUser, id: string, note?: string | null): Promise<OfferView> {
    void actor;
    void id;
    void note;
    throw new NotImplementedException();
  }

  send(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  withdraw(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  /** Null unless PENDING_APPROVAL. */
  getWorkflowContext(tenantId: string, id: string): Promise<WorkflowEntityContext | null> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }

  getPublic(rawToken: string): Promise<PublicOfferView> {
    void rawToken;
    throw new NotImplementedException();
  }

  acceptPublic(rawToken: string, input: { acceptedName: string }, meta: { ip: string | null; userAgent: string | null }): Promise<PublicOfferView> {
    void rawToken;
    void input;
    void meta;
    throw new NotImplementedException();
  }

  declinePublic(rawToken: string, input: { reason?: string | null }, meta: { ip: string | null; userAgent: string | null }): Promise<PublicOfferView> {
    void rawToken;
    void input;
    void meta;
    throw new NotImplementedException();
  }
}
