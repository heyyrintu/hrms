import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { OFFERS_LINK, OffersService } from './offers.service';

/**
 * OFFER approvals through the Wave B engine (Keka wave D2). The requester is
 * the HR user who submitted the offer (maker-checker); approve / reject delegate to
 * OffersService, the single approval code path (engine.act with onFinal).
 */
@Injectable()
export class OfferWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'OFFER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly offers: OffersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.offers.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const offers = await this.prisma.jobOffer.findMany({
      where: { tenantId, id: { in: entityIds } },
      select: {
        id: true,
        annualCtc: true,
        createdById: true,
        submittedById: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        candidate: { select: { firstName: true, lastName: true } },
        application: { select: { jobOpening: { select: { title: true } } } },
      },
    });

    // The requester is whoever submitted it (maker-checker), not the creator.
    const requesterOf = (o: { submittedById: string | null; createdById: string }) =>
      o.submittedById ?? o.createdById;
    const requesterIds = [...new Set(offers.map(requesterOf))];
    const requesters = requesterIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: requesterIds } },
          select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const requesterName = new Map(
      requesters.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );

    return offers.map((offer) => ({
      entityId: offer.id,
      title: `Offer · ${offer.candidate.firstName} ${offer.candidate.lastName} · ${offer.application.jobOpening.title}`,
      subtitle: `₹${Number(offer.annualCtc).toLocaleString('en-IN')} annual CTC`,
      requesterName: requesterName.get(requesterOf(offer)) ?? null,
      link: OFFERS_LINK,
      // Submitting is the last write before approval, so updatedAt is when it was raised.
      submittedAt: (offer.status === 'PENDING_APPROVAL' ? offer.updatedAt : offer.createdAt).toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.offers.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.offers.reject(actor, entityId, note);
  }
}
