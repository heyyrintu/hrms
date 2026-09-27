import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { FunnelReport, FunnelStageRow } from './recruitment.types';

interface StageEventRow {
  applicationId: string;
  toStageId: string;
  toStage: { sortOrder: number; category: string };
  createdAt: Date;
}

/**
 * Hiring funnel report: reach/conversion per active pipeline stage, plus
 * headline totals and source breakdown, for applications created in a
 * window (optionally scoped to one opening).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D3.
 */
@Injectable()
export class RecruitmentReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async funnel(
    actor: AuthenticatedUser,
    query: { jobOpeningId?: string; from?: string; to?: string },
  ): Promise<FunnelReport> {
    if (actor.role === 'MANAGER') {
      if (!query.jobOpeningId) {
        throw new BadRequestException('jobOpeningId is required for a manager');
      }
      const opening = await this.prisma.jobOpening.findFirst({
        where: { id: query.jobOpeningId, tenantId: actor.tenantId },
      });
      if (!opening) throw new NotFoundException('Job opening not found');
      if (opening.hiringManagerId !== actor.employeeId) {
        throw new ForbiddenException('You are not the hiring manager for this opening');
      }
    } else if (query.jobOpeningId) {
      const opening = await this.prisma.jobOpening.findFirst({
        where: { id: query.jobOpeningId, tenantId: actor.tenantId },
      });
      if (!opening) throw new NotFoundException('Job opening not found');
    }

    const appliedAtFilter: { gte?: Date; lte?: Date } = {};
    if (query.from) appliedAtFilter.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) appliedAtFilter.lte = new Date(`${query.to}T23:59:59.999Z`);

    const applications = await this.prisma.jobApplication.findMany({
      where: {
        tenantId: actor.tenantId,
        ...(query.jobOpeningId ? { jobOpeningId: query.jobOpeningId } : {}),
        ...(query.from || query.to ? { appliedAt: appliedAtFilter } : {}),
      },
      select: { id: true, status: true, source: true, appliedAt: true, hiredAt: true },
    });
    const applicationIds = applications.map((a) => a.id);

    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId: actor.tenantId, isActive: true, category: { not: 'REJECTED' } },
      orderBy: { sortOrder: 'asc' },
    });

    const stageRows = await this.buildStageRows(actor.tenantId, applicationIds, stages);

    const totals = await this.buildTotals(actor.tenantId, applications, applicationIds);
    const bySource = this.groupBySource(applications);

    return {
      jobOpeningId: query.jobOpeningId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      stages: stageRows,
      totals,
      bySource,
    };
  }

  private async buildStageRows(
    tenantId: string,
    applicationIds: string[],
    stages: Array<{ id: string; name: string; sortOrder: number; category: string }>,
  ): Promise<FunnelStageRow[]> {
    if (applicationIds.length === 0 || stages.length === 0) {
      return stages.map((s) => ({
        stageId: s.id,
        name: s.name,
        category: s.category as never,
        reached: 0,
        current: 0,
        conversionFromPrevious: null,
        avgDaysInStage: null,
      }));
    }

    const events = await this.prisma.jobApplicationStageEvent.findMany({
      where: { tenantId, applicationId: { in: applicationIds } },
      include: { toStage: { select: { sortOrder: true, category: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Highest non-rejected sortOrder each application ever reached.
    const maxSortOrderByApplication = new Map<string, number>();
    for (const event of events as unknown as StageEventRow[]) {
      if (event.toStage.category === 'REJECTED') continue;
      const current = maxSortOrderByApplication.get(event.applicationId) ?? -1;
      if (event.toStage.sortOrder > current) maxSortOrderByApplication.set(event.applicationId, event.toStage.sortOrder);
    }

    const currentByStage = await this.prisma.jobApplication.groupBy({
      by: ['stageId'],
      where: { tenantId, id: { in: applicationIds } },
      _count: { _all: true },
    });
    const currentCountByStageId = new Map(currentByStage.map((row) => [row.stageId, row._count._all]));

    // Time spent in a stage: the gap between the event that entered it and
    // the next event on the same application. Still-open sojourns (the
    // application hasn't moved on yet) are left out of the average — we
    // cannot know their eventual length.
    const daysInStageByStageId = new Map<string, number[]>();
    const eventsByApplication = new Map<string, StageEventRow[]>();
    for (const event of events as unknown as StageEventRow[]) {
      const list = eventsByApplication.get(event.applicationId) ?? [];
      list.push(event);
      eventsByApplication.set(event.applicationId, list);
    }
    for (const list of eventsByApplication.values()) {
      for (let i = 0; i < list.length - 1; i++) {
        const span = (list[i + 1].createdAt.getTime() - list[i].createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const bucket = daysInStageByStageId.get(list[i].toStageId) ?? [];
        bucket.push(span);
        daysInStageByStageId.set(list[i].toStageId, bucket);
      }
    }

    let previousReached: number | null = null;
    return stages.map((stage) => {
      const reached = applicationIds.filter((id) => (maxSortOrderByApplication.get(id) ?? -1) >= stage.sortOrder).length;
      const current = currentCountByStageId.get(stage.id) ?? 0;
      const conversionFromPrevious = previousReached === null ? null : previousReached === 0 ? 0 : (reached / previousReached) * 100;
      const durations = daysInStageByStageId.get(stage.id) ?? [];
      const avgDaysInStage = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      previousReached = reached;

      return {
        stageId: stage.id,
        name: stage.name,
        category: stage.category as never,
        reached,
        current,
        conversionFromPrevious,
        avgDaysInStage,
      };
    });
  }

  private async buildTotals(
    tenantId: string,
    applications: Array<{ id: string; status: string; appliedAt: Date; hiredAt: Date | null }>,
    applicationIds: string[],
  ) {
    const applied = applications.length;
    const hired = applications.filter((a) => a.status === 'HIRED').length;
    const rejected = applications.filter((a) => a.status === 'REJECTED').length;
    const withdrawn = applications.filter((a) => a.status === 'WITHDRAWN').length;

    const hiredDurations = applications
      .filter((a) => a.status === 'HIRED' && a.hiredAt)
      .map((a) => (a.hiredAt!.getTime() - a.appliedAt.getTime()) / (1000 * 60 * 60 * 24));
    const avgTimeToHireDays = hiredDurations.length
      ? hiredDurations.reduce((sum, d) => sum + d, 0) / hiredDurations.length
      : null;

    const offers = applicationIds.length
      ? await this.prisma.jobOffer.findMany({
          where: { tenantId, applicationId: { in: applicationIds } },
          select: { status: true },
        })
      : [];
    const offersSent = offers.filter((o) => o.status !== 'DRAFT' && o.status !== 'PENDING_APPROVAL' && o.status !== 'APPROVED' && o.status !== 'REJECTED').length;
    const offersAccepted = offers.filter((o) => o.status === 'ACCEPTED').length;
    const offersDeclined = offers.filter((o) => o.status === 'DECLINED').length;
    const answered = offersAccepted + offersDeclined;
    const offerAcceptanceRate = answered > 0 ? (offersAccepted / answered) * 100 : null;

    return {
      applied,
      hired,
      rejected,
      withdrawn,
      offersSent,
      offersAccepted,
      offersDeclined,
      offerAcceptanceRate,
      avgTimeToHireDays,
    };
  }

  private groupBySource(applications: Array<{ source: string }>) {
    const counts = new Map<string, number>();
    for (const app of applications) {
      counts.set(app.source, (counts.get(app.source) ?? 0) + 1);
    }
    return [...counts.entries()].map(([source, count]) => ({ source: source as never, count }));
  }
}
