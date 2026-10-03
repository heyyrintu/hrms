import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  NotificationType,
  PerformanceReviewStatus,
  Prisma,
  ReviewCycleStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  Band,
  finalRatingOf,
  isAdminRole,
  performanceBand,
  potentialBand,
} from '../performance-rating';
import { CalibrateDto, CalibrationQueryDto, NineBoxQueryDto } from './dto/calibration.dto';

const NO_EMPLOYEE = 'No employee profile linked to your account';
const NO_DEPARTMENT = 'No department';

export type Distribution = {
  '1': number;
  '2': number;
  '3': number;
  '4': number;
  '5': number;
  unrated: number;
  total: number;
};

const emptyDistribution = (): Distribution => ({
  '1': 0,
  '2': 0,
  '3': 0,
  '4': 0,
  '5': 0,
  unrated: 0,
  total: 0,
});

function addToDistribution(dist: Distribution, finalRating: number | null): void {
  dist.total += 1;
  if (finalRating === null || finalRating < 1 || finalRating > 5) {
    dist.unrated += 1;
    return;
  }
  dist[String(finalRating) as '1' | '2' | '3' | '4' | '5'] += 1;
}

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** Calibration and 9-box (spec F6, F7). */
@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Calibrate
  // ============================================

  /**
   * Admin override of a completed review's final rating. `rating: null`
   * reverts it. Set, revise and revert each write an audit row in the same
   * transaction as the change.
   */
  async calibrate(user: AuthenticatedUser, reviewId: string, dto: CalibrateDto) {
    if (!isAdminRole(user.role)) {
      throw new ForbiddenException('Only HR admins can calibrate ratings');
    }
    const tenantId = user.tenantId;

    // Read, check and write inside one transaction so oldValues in the audit
    // row is the value this write replaced, even under concurrent calibrations.
    const { review, updated } = await this.prisma.$transaction(async (tx) => {
      const review = await tx.performanceReview.findFirst({
        where: { id: reviewId, tenantId },
        include: {
          cycle: { select: { status: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!review) throw new NotFoundException('Review not found');

      // An admin never sets their own final rating.
      if (user.employeeId && review.employeeId === user.employeeId) {
        throw new ForbiddenException('You cannot calibrate your own review');
      }
      if (review.status !== PerformanceReviewStatus.COMPLETED) {
        throw new BadRequestException('Only completed reviews can be calibrated');
      }
      if (review.cycle.status !== ReviewCycleStatus.ACTIVE) {
        throw new BadRequestException('Ratings can only be calibrated while the cycle is active');
      }

      const row = await tx.performanceReview.update({
        where: { id: reviewId },
        data: {
          calibratedRating: dto.rating,
          calibrationReason: dto.reason,
          calibratedById: user.userId,
          calibratedAt: new Date(),
        },
      });
      await this.auditService.log(
        {
          tenantId,
          userId: user.userId,
          action: 'UPDATE',
          entityType: 'PerformanceReviewCalibration',
          entityId: reviewId,
          oldValues: {
            calibratedRating: review.calibratedRating,
            calibrationReason: review.calibrationReason,
          },
          newValues: { calibratedRating: dto.rating, calibrationReason: dto.reason },
        },
        tx,
      );
      return { review, updated: row };
    });

    const who = review.employee ? fullName(review.employee) : 'a team member';
    this.notificationsService
      .notifyEmployee(
        tenantId,
        review.reviewerId,
        NotificationType.REVIEW_CALIBRATED,
        'Review rating calibrated',
        dto.rating === null
          ? `HR reverted the calibrated rating on ${who}'s review.`
          : `HR calibrated the final rating on ${who}'s review.`,
        '/performance/team',
      )
      .catch((e) => this.logger.warn(`Calibration notification failed: ${e?.message ?? e}`));

    return {
      id: updated.id,
      calibratedRating: updated.calibratedRating,
      calibrationReason: updated.calibrationReason,
      calibratedAt: updated.calibratedAt,
      finalRating: finalRatingOf(updated),
    };
  }

  // ============================================
  // Scoping shared by calibration and 9-box
  // ============================================

  /** Admins: any scope. Managers: reviews they are the reviewer of. Everyone else: 403. */
  private scopeReviewer(user: AuthenticatedUser): string | null {
    if (isAdminRole(user.role)) return null;
    if (user.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only managers and admins can view calibration');
    }
    // undefined in a Prisma `where` would match every review
    if (!user.employeeId) throw new BadRequestException(NO_EMPLOYEE);
    return user.employeeId;
  }

  private async loadCycle(tenantId: string, cycleId: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id: cycleId, tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    return cycle;
  }

  // ============================================
  // Calibration view
  // ============================================

  async getCalibration(user: AuthenticatedUser, query: CalibrationQueryDto) {
    const managerScope = this.scopeReviewer(user);
    const cycle = await this.loadCycle(user.tenantId, query.cycleId);

    const where: Prisma.PerformanceReviewWhereInput = { tenantId: user.tenantId, cycleId: cycle.id };
    // Self-view wins: nobody sees their own ratings or potential here.
    if (user.employeeId) where.employeeId = { not: user.employeeId };
    if (query.departmentId) where.employee = { departmentId: query.departmentId };
    if (managerScope) {
      where.reviewerId = managerScope;
    } else if (query.managerId) {
      where.reviewerId = query.managerId;
    }
    // A manager filtering on somebody else's reviewees can only get nothing.
    const nothing = !!managerScope && !!query.managerId && query.managerId !== managerScope;

    const reviews = nothing
      ? []
      : await this.prisma.performanceReview.findMany({
          where,
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                departmentId: true,
                department: { select: { id: true, name: true } },
              },
            },
            reviewer: { select: { id: true, firstName: true, lastName: true } },
          },
        });

    const overall = emptyDistribution();
    const byDepartment = new Map<string, { departmentId: string | null; departmentName: string; distribution: Distribution }>();
    const byManager = new Map<string, { reviewerId: string; reviewerName: string; distribution: Distribution }>();

    const rows = reviews.map((r) => {
      const finalRating = finalRatingOf(r);
      const departmentName = r.employee.department?.name ?? NO_DEPARTMENT;
      const reviewerName = fullName(r.reviewer);

      addToDistribution(overall, finalRating);

      const deptKey = r.employee.department?.id ?? '';
      if (!byDepartment.has(deptKey)) {
        byDepartment.set(deptKey, {
          departmentId: r.employee.department?.id ?? null,
          departmentName,
          distribution: emptyDistribution(),
        });
      }
      addToDistribution(byDepartment.get(deptKey)!.distribution, finalRating);

      if (!byManager.has(r.reviewerId)) {
        byManager.set(r.reviewerId, {
          reviewerId: r.reviewerId,
          reviewerName,
          distribution: emptyDistribution(),
        });
      }
      addToDistribution(byManager.get(r.reviewerId)!.distribution, finalRating);

      return {
        reviewId: r.id,
        employeeId: r.employeeId,
        employeeName: fullName(r.employee),
        employeeCode: r.employee.employeeCode,
        departmentName,
        reviewerName,
        status: r.status,
        managerRating: r.managerRating,
        overallRating: r.overallRating,
        calibratedRating: r.calibratedRating,
        calibrationReason: r.calibrationReason,
        finalRating,
        potentialRating: r.potentialRating,
      };
    });

    return {
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
      overall,
      byDepartment: [...byDepartment.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName)),
      byManager: [...byManager.values()].sort((a, b) => a.reviewerName.localeCompare(b.reviewerName)),
      reviews: rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    };
  }

  // ============================================
  // 9-box
  // ============================================

  async getNineBox(user: AuthenticatedUser, query: NineBoxQueryDto) {
    const managerScope = this.scopeReviewer(user);
    const cycle = await this.loadCycle(user.tenantId, query.cycleId);

    const where: Prisma.PerformanceReviewWhereInput = { tenantId: user.tenantId, cycleId: cycle.id };
    // Self-view wins: nobody sees their own ratings or potential here.
    if (user.employeeId) where.employeeId = { not: user.employeeId };
    if (managerScope) where.reviewerId = managerScope;
    if (query.departmentId) where.employee = { departmentId: query.departmentId };

    const reviews = await this.prisma.performanceReview.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            departmentId: true,
            department: { select: { id: true, name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    type Person = {
      reviewId: string;
      employeeId: string;
      name: string;
      designation: string | null;
      departmentName: string | null;
      finalRating: number;
      potentialRating: number;
    };

    const potentials: Band[] = ['HIGH', 'MEDIUM', 'LOW'];
    const performances: Band[] = ['LOW', 'MEDIUM', 'HIGH'];
    const cells = potentials.flatMap((potential) =>
      performances.map((performance) => ({
        performance,
        potential,
        employees: [] as Person[],
      })),
    );
    const missing: Array<{
      reviewId: string;
      employeeId: string;
      name: string;
      missingRating: boolean;
      missingPotential: boolean;
    }> = [];

    const sorted = [...reviews].sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)));
    for (const r of sorted) {
      const finalRating = finalRatingOf(r);
      const potentialRating = r.potentialRating;
      const name = fullName(r.employee);

      if (finalRating === null || potentialRating === null) {
        missing.push({
          reviewId: r.id,
          employeeId: r.employeeId,
          name,
          missingRating: finalRating === null,
          missingPotential: potentialRating === null,
        });
        continue;
      }
      const performance = performanceBand(finalRating);
      const potential = potentialBand(potentialRating);
      cells
        .find((c) => c.performance === performance && c.potential === potential)!
        .employees.push({
          reviewId: r.id,
          employeeId: r.employeeId,
          name,
          designation: r.employee.designation?.name ?? null,
          departmentName: r.employee.department?.name ?? null,
          finalRating,
          potentialRating,
        });
    }

    return { cells, missing };
  }
}
