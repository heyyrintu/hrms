import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { SlabsService } from './slabs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

function ptDto(overrides: Record<string, unknown> = {}) {
  return {
    state: 'Karnataka',
    fromAmount: 0,
    toAmount: 25000,
    amount: 200,
    ...overrides,
  } as never;
}

function ptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pt-1',
    tenantId: TENANT,
    state: 'Karnataka',
    fromAmount: new Decimal('0'),
    toAmount: new Decimal('25000'),
    amount: new Decimal('200'),
    februaryAmount: null,
    gender: null,
    ...overrides,
  };
}

function slabRow(from: number, to: number | null, rate: number) {
  return { fromAmount: from, toAmount: to, rate };
}

function validLadder() {
  return [
    slabRow(0, 300000, 0),
    slabRow(300000, 600000, 5),
    slabRow(600000, null, 10),
  ];
}

function incomeTaxDto(overrides: Record<string, unknown> = {}) {
  return {
    financialYear: 2026,
    regime: 'NEW',
    ageBand: 'GENERAL',
    slabs: validLadder(),
    ...overrides,
  } as never;
}

describe('SlabsService', () => {
  let service: SlabsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SlabsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SlabsService);
  });

  // -------------------------------------------------------------------------
  // Professional tax: reading
  // -------------------------------------------------------------------------

  describe('listProfessionalTax', () => {
    it('scopes the list to the caller tenant', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProfessionalTax(TENANT);

      expect(prisma.professionalTaxSlab.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT } }),
      );
    });

    it('narrows to one state when asked', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProfessionalTax(TENANT, 'Karnataka');

      expect(prisma.professionalTaxSlab.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, state: 'Karnataka' } }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Professional tax: create
  // -------------------------------------------------------------------------

  describe('createProfessionalTax', () => {
    it('creates a row scoped to the caller tenant, as Decimal', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.professionalTaxSlab.create as jest.Mock).mockResolvedValue(ptRow());

      await service.createProfessionalTax(TENANT, ptDto());

      const arg = (prisma.professionalTaxSlab.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.tenantId).toBe(TENANT);
      expect(arg.data.fromAmount).toBeInstanceOf(Decimal);
      expect(arg.data.fromAmount.toFixed(2)).toBe('0.00');
      expect(arg.data.amount).toBeInstanceOf(Decimal);
      expect(arg.data.amount.toFixed(2)).toBe('200.00');
    });

    it('refuses an upper bound below the lower bound', async () => {
      await expect(
        service.createProfessionalTax(
          TENANT,
          ptDto({ fromAmount: 25000, toAmount: 10000 }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.professionalTaxSlab.create).not.toHaveBeenCalled();
    });

    // -- The core rule: overlapping bands mean the first match wins arbitrarily --

    it('refuses a row overlapping another for the same state, naming the row it collides with', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([
        ptRow({ id: 'pt-existing', fromAmount: new Decimal('0'), toAmount: new Decimal('25000') }),
      ]);

      await expect(
        service.createProfessionalTax(
          TENANT,
          ptDto({ fromAmount: 20000, toAmount: 40000 }),
        ),
      ).rejects.toThrow(BadRequestException);

      let message = '';
      try {
        await service.createProfessionalTax(
          TENANT,
          ptDto({ fromAmount: 20000, toAmount: 40000 }),
        );
      } catch (err) {
        message = (err as BadRequestException).message;
      }
      expect(message).toContain('pt-existing');
      expect(prisma.professionalTaxSlab.create).not.toHaveBeenCalled();
    });

    it('refuses an open-ended row that overlaps an existing band', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([
        ptRow({ id: 'pt-top', fromAmount: new Decimal('25000'), toAmount: null }),
      ]);

      await expect(
        service.createProfessionalTax(
          TENANT,
          ptDto({ fromAmount: 0, toAmount: null }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a row for a different state to overlap freely', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.professionalTaxSlab.create as jest.Mock).mockResolvedValue(
        ptRow({ state: 'Maharashtra' }),
      );

      await service.createProfessionalTax(
        TENANT,
        ptDto({ state: 'Maharashtra', fromAmount: 0, toAmount: 25000 }),
      );

      // The overlap check only ever looked at Maharashtra rows.
      expect(prisma.professionalTaxSlab.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: 'Maharashtra' }),
        }),
      );
      expect(prisma.professionalTaxSlab.create).toHaveBeenCalled();
    });

    it('allows two rows with the same range when they are restricted to different genders', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([
        ptRow({ id: 'pt-male', fromAmount: new Decimal('0'), toAmount: new Decimal('25000'), gender: 'male' }),
      ]);
      (prisma.professionalTaxSlab.create as jest.Mock).mockResolvedValue(ptRow({ gender: 'female' }));

      await service.createProfessionalTax(
        TENANT,
        ptDto({ fromAmount: 0, toAmount: 25000, gender: 'female' }),
      );

      expect(prisma.professionalTaxSlab.create).toHaveBeenCalled();
    });

    it('checks for overlap only within the caller own tenant', async () => {
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.professionalTaxSlab.create as jest.Mock).mockResolvedValue(ptRow());

      await service.createProfessionalTax(TENANT, ptDto());

      expect(prisma.professionalTaxSlab.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT }) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Professional tax: update
  // -------------------------------------------------------------------------

  describe('updateProfessionalTax', () => {
    it('reports a row from another tenant as not found', async () => {
      (prisma.professionalTaxSlab.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateProfessionalTax(OTHER_TENANT, 'pt-1', ptDto()),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.professionalTaxSlab.update).not.toHaveBeenCalled();
    });

    it('excludes the row itself from the overlap check', async () => {
      (prisma.professionalTaxSlab.findFirst as jest.Mock).mockResolvedValue({ id: 'pt-1' });
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.professionalTaxSlab.update as jest.Mock).mockResolvedValue(ptRow());

      await service.updateProfessionalTax(TENANT, 'pt-1', ptDto());

      expect(prisma.professionalTaxSlab.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'pt-1' } }),
        }),
      );
      expect(prisma.professionalTaxSlab.update).toHaveBeenCalled();
    });

    it('still refuses an overlap against a different row', async () => {
      (prisma.professionalTaxSlab.findFirst as jest.Mock).mockResolvedValue({ id: 'pt-1' });
      (prisma.professionalTaxSlab.findMany as jest.Mock).mockResolvedValue([
        ptRow({ id: 'pt-2', fromAmount: new Decimal('0'), toAmount: new Decimal('25000') }),
      ]);

      await expect(
        service.updateProfessionalTax(TENANT, 'pt-1', ptDto({ fromAmount: 10000, toAmount: 30000 })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.professionalTaxSlab.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Professional tax: delete
  // -------------------------------------------------------------------------

  describe('deleteProfessionalTax', () => {
    it('reports a row from another tenant as not found, and deletes nothing', async () => {
      (prisma.professionalTaxSlab.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteProfessionalTax(OTHER_TENANT, 'pt-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.professionalTaxSlab.delete).not.toHaveBeenCalled();
    });

    it('deletes a row that belongs to the caller tenant', async () => {
      (prisma.professionalTaxSlab.findFirst as jest.Mock).mockResolvedValue({ id: 'pt-1' });
      (prisma.professionalTaxSlab.delete as jest.Mock).mockResolvedValue(ptRow());

      await service.deleteProfessionalTax(TENANT, 'pt-1');

      expect(prisma.professionalTaxSlab.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'pt-1', tenantId: TENANT }) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Income tax: reading
  // -------------------------------------------------------------------------

  describe('listIncomeTaxConfigs', () => {
    it('scopes the list to the caller tenant and includes the slabs', async () => {
      (prisma.incomeTaxConfig.findMany as jest.Mock).mockResolvedValue([]);

      await service.listIncomeTaxConfigs(TENANT);

      expect(prisma.incomeTaxConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT },
          include: expect.objectContaining({ slabs: expect.anything() }),
        }),
      );
    });

    it('narrows to one financial year when asked', async () => {
      (prisma.incomeTaxConfig.findMany as jest.Mock).mockResolvedValue([]);

      await service.listIncomeTaxConfigs(TENANT, 2026);

      expect(prisma.incomeTaxConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, financialYear: 2026 } }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Income tax: ladder validation
  // -------------------------------------------------------------------------

  describe('replaceIncomeTaxConfig — ladder validation', () => {
    it('refuses a ladder that does not start at zero', async () => {
      await expect(
        service.replaceIncomeTaxConfig(
          TENANT,
          incomeTaxDto({ slabs: [slabRow(1, 300000, 0), slabRow(300000, null, 10)] }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.incomeTaxConfig.findFirst).not.toHaveBeenCalled();
    });

    it('refuses a ladder with a gap, and names the gap', async () => {
      const promise = service.replaceIncomeTaxConfig(
        TENANT,
        incomeTaxDto({
          slabs: [slabRow(0, 300000, 0), slabRow(350000, null, 10)],
        }),
      );

      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(/300000/);
      await expect(promise).rejects.toThrow(/350000/);
    });

    it('refuses a ladder whose bands overlap', async () => {
      await expect(
        service.replaceIncomeTaxConfig(
          TENANT,
          incomeTaxDto({
            slabs: [slabRow(0, 300000, 0), slabRow(250000, null, 10)],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a ladder with no open-ended band at the top', async () => {
      await expect(
        service.replaceIncomeTaxConfig(
          TENANT,
          incomeTaxDto({ slabs: [slabRow(0, 300000, 0), slabRow(300000, 600000, 10)] }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a ladder with more than one open-ended band', async () => {
      await expect(
        service.replaceIncomeTaxConfig(
          TENANT,
          incomeTaxDto({
            slabs: [slabRow(0, null, 0), slabRow(300000, null, 10)],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an open-ended band that is not the top band', async () => {
      await expect(
        service.replaceIncomeTaxConfig(
          TENANT,
          incomeTaxDto({
            slabs: [slabRow(0, null, 0), slabRow(300000, 600000, 10)],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid ladder given out of order', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.incomeTaxConfig.create as jest.Mock).mockResolvedValue({ id: 'itc-1' });

      await service.replaceIncomeTaxConfig(
        TENANT,
        incomeTaxDto({
          slabs: [slabRow(300000, 600000, 5), slabRow(0, 300000, 0), slabRow(600000, null, 10)],
        }),
      );

      expect(prisma.incomeTaxConfig.create).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Income tax: replace, atomically
  // -------------------------------------------------------------------------

  describe('replaceIncomeTaxConfig — create or replace', () => {
    it('creates a new configuration, scoped to the caller tenant, with Decimal slabs', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.incomeTaxConfig.create as jest.Mock).mockResolvedValue({ id: 'itc-1' });

      await service.replaceIncomeTaxConfig(TENANT, incomeTaxDto());

      expect(prisma.$transaction).toHaveBeenCalled();
      const arg = (prisma.incomeTaxConfig.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.tenantId).toBe(TENANT);
      expect(arg.data.financialYear).toBe(2026);
      expect(arg.data.regime).toBe('NEW');
      expect(arg.data.ageBand).toBe('GENERAL');
      expect(arg.data.slabs.create).toHaveLength(3);
      expect(arg.data.slabs.create[0].fromAmount).toBeInstanceOf(Decimal);
      expect(arg.data.slabs.create[0].rate.toFixed(2)).toBe('0.00');
    });

    it('finds the existing configuration scoped by tenant, financial year, regime and age band', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.incomeTaxConfig.create as jest.Mock).mockResolvedValue({ id: 'itc-1' });

      await service.replaceIncomeTaxConfig(TENANT, incomeTaxDto());

      expect(prisma.incomeTaxConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            financialYear: 2026,
            regime: 'NEW',
            ageBand: 'GENERAL',
          },
        }),
      );
    });

    it('replaces the previous ladder wholesale, as one unit of work, when a configuration already exists', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'itc-existing' });
      (prisma.incomeTaxConfig.update as jest.Mock).mockResolvedValue({ id: 'itc-existing' });

      await service.replaceIncomeTaxConfig(TENANT, incomeTaxDto());

      // The whole operation ran inside a transaction: the read that decided
      // create-versus-update and the write are one unit of work.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.incomeTaxConfig.create).not.toHaveBeenCalled();

      const arg = (prisma.incomeTaxConfig.update as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'itc-existing' });
      // Old slabs are cleared and the new ladder created in the same nested
      // write, so a failure partway through cannot leave half a ladder.
      expect(arg.data.slabs.deleteMany).toEqual({});
      expect(arg.data.slabs.create).toHaveLength(3);
    });

    it('never touches a configuration belonging to another tenant', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.incomeTaxConfig.create as jest.Mock).mockResolvedValue({ id: 'itc-1' });

      await service.replaceIncomeTaxConfig(OTHER_TENANT, incomeTaxDto());

      expect(prisma.incomeTaxConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: OTHER_TENANT }) }),
      );
      const arg = (prisma.incomeTaxConfig.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.tenantId).toBe(OTHER_TENANT);
    });
  });

  // -------------------------------------------------------------------------
  // Income tax: delete
  // -------------------------------------------------------------------------

  describe('deleteIncomeTaxConfig', () => {
    it('reports a configuration from another tenant as not found, and deletes nothing', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteIncomeTaxConfig(OTHER_TENANT, 'itc-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.incomeTaxConfig.delete).not.toHaveBeenCalled();
    });

    it('deletes a configuration that belongs to the caller tenant', async () => {
      (prisma.incomeTaxConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'itc-1' });
      (prisma.incomeTaxConfig.delete as jest.Mock).mockResolvedValue({ id: 'itc-1' });

      const result = await service.deleteIncomeTaxConfig(TENANT, 'itc-1');

      expect(prisma.incomeTaxConfig.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'itc-1', tenantId: TENANT }) }),
      );
      // The response is honest about what deleting means: this cannot check
      // whether payroll has already used the configuration, so it says so
      // rather than pretending the deletion is risk-free.
      expect(result.message).toMatch(/payroll/i);
    });
  });
});
