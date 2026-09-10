import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IncomeTaxConfigDto,
  IncomeTaxSlabRowDto,
  ProfessionalTaxSlabDto,
} from './dto/slabs.dto';

/**
 * Editing the professional tax and income tax slab tables.
 *
 * Both were seed-only until now: an ordinary rate revision meant running a
 * script against the database. That made a routine change an engineering
 * task, and it meant nothing stopped a badly-typed script from leaving a slab
 * table broken.
 *
 * **A slab table is only meaningful as a complete ladder.** An income tax
 * configuration is therefore replaced whole — `replaceIncomeTaxConfig` throws
 * out the old slabs and writes the new ones as one unit of work — rather than
 * edited slab by slab, which is how a ladder ends up with a gap nobody meant
 * to leave. The ladder is validated before anything is written: it must start
 * at zero, must not overlap or leave a gap, and exactly one band may be
 * open-ended at the top.
 *
 * **Professional tax rows are validated against their siblings.** Two bands
 * for the same state that both match the same income mean the first one
 * returned wins arbitrarily — see `calculateProfessionalTax` in
 * `statutory.calculators.ts`, which does exactly that with `Array#find`. A
 * new or updated row is checked against every other row for that state and
 * refused if it overlaps one, naming the row it collides with. Rows
 * restricted to different genders are allowed to overlap, because a
 * gender-restricted row and an all-genders row already coexist in the seed
 * data and never compete for the same employee; two rows are only genuinely
 * in conflict when a single employee could match both.
 *
 * **Every query and write here is scoped by `tenantId`.** A slab belonging to
 * another tenant reads as absent — `NotFoundException`, not `Forbidden` — so
 * an id from another tenant cannot be used to probe what exists there.
 *
 * **Deleting is not guarded against prior use.** Nothing here can tell
 * whether a payroll run has already read a given configuration or slab —
 * `Payslip` stores the figures it computed with as plain columns, not a
 * reference back to the row that produced them, so a completed payslip is
 * unaffected by a later deletion regardless. What deletion actually changes
 * is future payroll runs, which will find nothing configured. The delete
 * responses say this plainly rather than implying a safety check that was
 * never made.
 */
@Injectable()
export class SlabsService {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Professional tax
  // -------------------------------------------------------------------------

  async listProfessionalTax(tenantId: string, state?: string) {
    return this.prisma.professionalTaxSlab.findMany({
      where: { tenantId, ...(state ? { state } : {}) },
      orderBy: [{ state: 'asc' }, { fromAmount: 'asc' }],
    });
  }

  async createProfessionalTax(tenantId: string, dto: ProfessionalTaxSlabDto) {
    this.validatePtRange(dto);
    await this.assertNoPtOverlap(tenantId, dto);

    return this.prisma.professionalTaxSlab.create({
      data: this.ptData(tenantId, dto),
    });
  }

  /** An update replaces the whole row: there is no partial patch. */
  async updateProfessionalTax(tenantId: string, id: string, dto: ProfessionalTaxSlabDto) {
    const existing = await this.prisma.professionalTaxSlab.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Professional tax slab not found');

    this.validatePtRange(dto);
    await this.assertNoPtOverlap(tenantId, dto, id);

    return this.prisma.professionalTaxSlab.update({
      where: { id, tenantId },
      data: this.ptData(tenantId, dto),
    });
  }

  async deleteProfessionalTax(tenantId: string, id: string) {
    const existing = await this.prisma.professionalTaxSlab.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Professional tax slab not found');

    await this.prisma.professionalTaxSlab.delete({ where: { id, tenantId } });

    return {
      message:
        'Professional tax slab deleted. Payslips already processed keep the figures ' +
        'they were computed with; only payroll runs from now on stop applying this band.',
    };
  }

  private ptData(tenantId: string, dto: ProfessionalTaxSlabDto) {
    return {
      tenantId,
      state: dto.state,
      fromAmount: new Decimal(dto.fromAmount),
      toAmount: dto.toAmount == null ? null : new Decimal(dto.toAmount),
      amount: new Decimal(dto.amount),
      februaryAmount: dto.februaryAmount == null ? null : new Decimal(dto.februaryAmount),
      gender: dto.gender ?? null,
    };
  }

  private validatePtRange(dto: ProfessionalTaxSlabDto): void {
    const from = new Decimal(dto.fromAmount);
    const to = dto.toAmount == null ? null : new Decimal(dto.toAmount);
    if (to !== null && to.lt(from)) {
      throw new BadRequestException(
        `toAmount (${to.toFixed(2)}) cannot be less than fromAmount (${from.toFixed(2)})`,
      );
    }
  }

  /**
   * Refuse a row that would overlap another row for the same state and an
   * overlapping set of genders. `excludeId` leaves the row itself out of the
   * check on an update, so a row is never compared against its own prior
   * values.
   */
  private async assertNoPtOverlap(
    tenantId: string,
    dto: ProfessionalTaxSlabDto,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.prisma.professionalTaxSlab.findMany({
      where: {
        tenantId,
        state: dto.state,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    const from = new Decimal(dto.fromAmount);
    const to = dto.toAmount == null ? null : new Decimal(dto.toAmount);
    const gender = dto.gender ?? null;

    for (const row of siblings) {
      // A row restricted to one gender never matches an employee of another
      // gender, so two rows only genuinely compete when at least one of them
      // applies to everyone (gender === null) or they name the same gender.
      const genderCompatible =
        gender === null || row.gender === null || row.gender === gender;
      if (!genderCompatible) continue;

      const rowFrom = new Decimal(row.fromAmount);
      const rowTo = row.toAmount === null ? null : new Decimal(row.toAmount);

      if (rangesOverlap(from, to, rowFrom, rowTo)) {
        const rowRange = rowTo === null ? `${rowFrom.toFixed(2)} and above` : `${rowFrom.toFixed(2)}–${rowTo.toFixed(2)}`;
        throw new BadRequestException(
          `This band overlaps the existing ${dto.state} band ${rowRange} (id ${row.id}); ` +
            'two bands that can both match the same income mean the first one returned ' +
            'wins arbitrarily.',
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Income tax
  // -------------------------------------------------------------------------

  async listIncomeTaxConfigs(tenantId: string, financialYear?: number) {
    return this.prisma.incomeTaxConfig.findMany({
      where: { tenantId, ...(financialYear !== undefined ? { financialYear } : {}) },
      include: { slabs: { orderBy: { fromAmount: 'asc' } } },
      orderBy: [{ financialYear: 'desc' }, { regime: 'asc' }, { ageBand: 'asc' }],
    });
  }

  /**
   * Create the configuration for a year, regime and age band, or replace it
   * whole if one already exists — the ladder included.
   *
   * The find that decides create-versus-update and the write itself run
   * inside one `$transaction`, and the write replaces every slab in a single
   * nested `deleteMany` + `create`, so a failure partway through cannot leave
   * a configuration with half an old ladder and half a new one.
   */
  async replaceIncomeTaxConfig(tenantId: string, dto: IncomeTaxConfigDto) {
    this.validateLadder(dto.slabs);

    const slabsData = dto.slabs.map((s) => ({
      fromAmount: new Decimal(s.fromAmount),
      toAmount: s.toAmount == null ? null : new Decimal(s.toAmount),
      rate: new Decimal(s.rate),
    }));
    const scalarData = this.incomeTaxScalarData(dto);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.incomeTaxConfig.findFirst({
        where: {
          tenantId,
          financialYear: dto.financialYear,
          regime: dto.regime,
          ageBand: dto.ageBand,
        },
        select: { id: true },
      });

      if (existing) {
        return tx.incomeTaxConfig.update({
          where: { id: existing.id },
          data: {
            ...scalarData,
            slabs: {
              deleteMany: {},
              create: slabsData,
            },
          },
          include: { slabs: { orderBy: { fromAmount: 'asc' } } },
        });
      }

      return tx.incomeTaxConfig.create({
        data: {
          tenantId,
          financialYear: dto.financialYear,
          regime: dto.regime,
          ageBand: dto.ageBand,
          ...scalarData,
          surchargeSlabs: [] as unknown as Prisma.InputJsonValue,
          slabs: { create: slabsData },
        },
        include: { slabs: { orderBy: { fromAmount: 'asc' } } },
      });
    });
  }

  async deleteIncomeTaxConfig(tenantId: string, id: string) {
    const existing = await this.prisma.incomeTaxConfig.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Income tax configuration not found');

    // The cascade on IncomeTaxSlab.config removes the slabs with it.
    await this.prisma.incomeTaxConfig.delete({ where: { id, tenantId } });

    return {
      message:
        'Income tax configuration and its slabs deleted. Payslips already computed keep ' +
        'the tax they were charged; any payroll run for this year, regime and age band ' +
        'that has not been processed yet will find no configuration until a new one is created.',
    };
  }

  private incomeTaxScalarData(dto: IncomeTaxConfigDto) {
    return {
      standardDeduction: new Decimal(dto.standardDeduction ?? 0),
      rebateIncomeLimit: new Decimal(dto.rebateIncomeLimit ?? 0),
      rebateMaxAmount: new Decimal(dto.rebateMaxAmount ?? 0),
      cessRate: new Decimal(dto.cessRate ?? 4),
      section80CLimit: new Decimal(dto.section80CLimit ?? 150000),
      section80DLimit: new Decimal(dto.section80DLimit ?? 25000),
      section80CCD1BLimit: new Decimal(dto.section80CCD1BLimit ?? 50000),
      childrenEducationMonthlyLimit: new Decimal(dto.childrenEducationMonthlyLimit ?? 100),
      hostelAllowanceMonthlyLimit: new Decimal(dto.hostelAllowanceMonthlyLimit ?? 300),
      childrenAllowanceMaxChildren: dto.childrenAllowanceMaxChildren ?? 2,
      marginalReliefEnabled: dto.marginalReliefEnabled ?? true,
    };
  }

  /**
   * A ladder is a set of marginal tax bands: `calculateIncomeTax` taxes the
   * portion of income between each band's `fromAmount` and `toAmount`, so a
   * band's `toAmount` must equal the next band's `fromAmount` exactly. A gap
   * between them — `toAmount` less than the next `fromAmount` — is income
   * that belongs to no band and is silently taxed at nothing; bands that
   * overlap instead mean the same rupee is taxed by two bands at once.
   *
   * The ladder must start at zero, because income below the first band would
   * otherwise be taxed at nothing the same way a gap is. Exactly one band may
   * be open-ended (`toAmount` null), and it must be the top band: with none,
   * income above the last band's ceiling goes untaxed; with more than one,
   * it is ambiguous which open-ended rate applies.
   */
  private validateLadder(slabs: IncomeTaxSlabRowDto[]): void {
    const sorted = [...slabs].sort(
      (a, b) => new Decimal(a.fromAmount).cmp(new Decimal(b.fromAmount)),
    );

    const first = sorted[0];
    if (!new Decimal(first.fromAmount).eq(0)) {
      throw new BadRequestException(
        `The ladder must start at 0; its lowest band starts at ${new Decimal(first.fromAmount).toFixed(2)}`,
      );
    }

    const openEnded = sorted.filter((s) => s.toAmount === null || s.toAmount === undefined);
    if (openEnded.length === 0) {
      throw new BadRequestException(
        'Exactly one band must be open-ended at the top so income above the highest ' +
          'bound is still taxed; none of the bands given is',
      );
    }
    if (openEnded.length > 1) {
      throw new BadRequestException(
        `Exactly one band may be open-ended at the top; ${openEnded.length} are`,
      );
    }

    const last = sorted[sorted.length - 1];
    if (last.toAmount !== null && last.toAmount !== undefined) {
      throw new BadRequestException(
        'The open-ended band must be the top band, ordered by its lower bound',
      );
    }

    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const from = new Decimal(cur.fromAmount);
      const to = cur.toAmount === null || cur.toAmount === undefined ? null : new Decimal(cur.toAmount);
      if (to !== null && to.lte(from)) {
        throw new BadRequestException(
          `The band starting at ${from.toFixed(2)} has an upper bound of ${to.toFixed(2)}, ` +
            'which is not greater than its lower bound',
        );
      }

      if (i === 0) continue;

      const prev = sorted[i - 1];
      // Only the last band may be open-ended, and it is never checked as
      // "prev" here because the loop ends one iteration before it would be.
      const prevTo = new Decimal(prev.toAmount as number);

      if (from.eq(prevTo)) continue;

      if (from.gt(prevTo)) {
        throw new BadRequestException(
          // Named the way every other refusal names a band, by the amount it
          // starts at, so the page can put the message against that row
          // instead of floating it above the whole ladder.
          `The band starting at ${from.toFixed(2)} leaves a gap after ` +
            `${prevTo.toFixed(2)}: income in that range would be taxed at nothing`,
        );
      }

      throw new BadRequestException(
        `The band starting at ${from.toFixed(2)} overlaps the band ending at ${prevTo.toFixed(2)}`,
      );
    }
  }
}

/**
 * Whether two inclusive ranges share a value. A `null` upper bound reaches
 * to infinity.
 */
function rangesOverlap(
  fromA: Decimal,
  toA: Decimal | null,
  fromB: Decimal,
  toB: Decimal | null,
): boolean {
  const aStartsWithinB = toB === null ? true : fromA.lte(toB);
  const bStartsWithinA = toA === null ? true : fromB.lte(toA);
  return aStartsWithinB && bStartsWithinA;
}
