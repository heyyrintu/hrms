import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';
import { FeedService } from './feed.service';
import { istDateParts, istStartOfDay } from '../engagement-time';
import { FEED_SOURCE } from './feed.types';

export interface RunForTenantResult {
  created: number;
}

export interface RunForAllTenantsResult {
  tenants: number;
  created: number;
  failed: number;
}

interface CelebrationEmployee {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  joinDate: Date;
}

/**
 * Month/day match with the Feb-29 rule: a person born (or hired) on 29 Feb is
 * celebrated on 28 Feb in a year that has no 29 Feb, and never twice.
 *
 * `m`, `d` are the employee's own month (1-12) and day; `today` is the IST
 * calendar date being checked.
 */
export function matchesToday(
  m: number,
  d: number,
  today: { year: number; month: number; day: number },
): boolean {
  if (m === today.month && d === today.day) return true;
  const leap =
    (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0;
  return !leap && m === 2 && d === 29 && today.month === 2 && today.day === 28;
}

/** Birthday and work-anniversary feed items, one tenant at a time. */
@Injectable()
export class FeedCelebrationsService {
  private readonly logger = new Logger(FeedCelebrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: EngagementSettingsService,
    private readonly feed: FeedService,
  ) {}

  async runForTenant(tenantId: string, now: Date): Promise<RunForTenantResult> {
    const settings = await this.settings.get(tenantId);
    const today = istDateParts(now);
    const occurredAt = istStartOfDay(now);

    const employees = (await this.prisma.employee.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, joinDate: true },
    })) as CelebrationEmployee[];

    let created = 0;

    for (const employee of employees) {
      if (settings.showBirthdays && employee.dateOfBirth) {
        const dob = employee.dateOfBirth;
        const month = dob.getUTCMonth() + 1;
        const day = dob.getUTCDate();
        if (matchesToday(month, day, today)) {
          await this.feed.post({
            tenantId,
            type: 'BIRTHDAY',
            sourceType: FEED_SOURCE.EMPLOYEE,
            sourceId: employee.id,
            subjectEmployeeId: employee.id,
            title: `Happy birthday, ${employee.firstName}!`,
            payload: {},
            dedupeKey: `birthday:${employee.id}:${today.year}`,
            occurredAt,
          });
          created += 1;
        }
      }

      if (settings.showAnniversaries) {
        const joined = istDateParts(employee.joinDate);
        if (matchesToday(joined.month, joined.day, today)) {
          const years = today.year - joined.year;
          if (years >= 1) {
            await this.feed.post({
              tenantId,
              type: 'WORK_ANNIVERSARY',
              sourceType: FEED_SOURCE.EMPLOYEE,
              sourceId: employee.id,
              subjectEmployeeId: employee.id,
              title: `${employee.firstName} ${employee.lastName} completes ${years} ${years === 1 ? 'year' : 'years'} with us`,
              payload: { years },
              dedupeKey: `anniversary:${employee.id}:${today.year}`,
              occurredAt,
            });
            created += 1;
          }
        }
      }
    }

    return { created };
  }

  async runForAllTenants(now: Date): Promise<RunForAllTenantsResult> {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let created = 0;
    let failed = 0;

    for (const { id: tenantId } of tenants) {
      try {
        const result = await this.runForTenant(tenantId, now);
        created += result.created;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Feed celebrations failed for tenant ${tenantId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    return { tenants: tenants.length, created, failed };
  }
}
