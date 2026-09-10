import { Test, TestingModule } from '@nestjs/testing';
import { SlabsController } from './slabs.controller';
import { SlabsService } from './slabs.service';
import { mockHrAdmin } from '../../../test/helpers';

describe('SlabsController', () => {
  let controller: SlabsController;
  let service: jest.Mocked<SlabsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlabsController],
      providers: [
        {
          provide: SlabsService,
          useValue: {
            listProfessionalTax: jest.fn().mockResolvedValue([]),
            createProfessionalTax: jest.fn().mockResolvedValue({ id: 'pt-1' }),
            updateProfessionalTax: jest.fn().mockResolvedValue({ id: 'pt-1' }),
            deleteProfessionalTax: jest.fn().mockResolvedValue({ message: 'deleted' }),
            listIncomeTaxConfigs: jest.fn().mockResolvedValue([]),
            replaceIncomeTaxConfig: jest.fn().mockResolvedValue({ id: 'itc-1' }),
            deleteIncomeTaxConfig: jest.fn().mockResolvedValue({ message: 'deleted' }),
          },
        },
      ],
    }).compile();

    controller = module.get(SlabsController);
    service = module.get(SlabsService);
  });

  describe('professional tax', () => {
    it('lists, scoped to the caller tenant and the state given', async () => {
      await controller.listProfessionalTax(mockHrAdmin, { state: 'Karnataka' });

      expect(service.listProfessionalTax).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'Karnataka',
      );
    });

    it('creates, scoped to the caller tenant', async () => {
      const dto = { state: 'Karnataka', fromAmount: 0, toAmount: 25000, amount: 200 } as never;

      await controller.createProfessionalTax(mockHrAdmin, dto);

      expect(service.createProfessionalTax).toHaveBeenCalledWith(mockHrAdmin.tenantId, dto);
    });

    it('updates the row named in the path, scoped to the caller tenant', async () => {
      const dto = { state: 'Karnataka', fromAmount: 0, toAmount: 25000, amount: 200 } as never;

      await controller.updateProfessionalTax(mockHrAdmin, 'pt-1', dto);

      expect(service.updateProfessionalTax).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'pt-1',
        dto,
      );
    });

    it('deletes the row named in the path, scoped to the caller tenant', async () => {
      await controller.deleteProfessionalTax(mockHrAdmin, 'pt-1');

      expect(service.deleteProfessionalTax).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'pt-1');
    });
  });

  describe('income tax', () => {
    it('lists, scoped to the caller tenant and the financial year given', async () => {
      await controller.listIncomeTax(mockHrAdmin, { financialYear: 2026 });

      expect(service.listIncomeTaxConfigs).toHaveBeenCalledWith(mockHrAdmin.tenantId, 2026);
    });

    it('replaces the configuration, scoped to the caller tenant', async () => {
      const dto = {
        financialYear: 2026,
        regime: 'NEW',
        ageBand: 'GENERAL',
        slabs: [{ fromAmount: 0, toAmount: null, rate: 0 }],
      } as never;

      await controller.replaceIncomeTax(mockHrAdmin, dto);

      expect(service.replaceIncomeTaxConfig).toHaveBeenCalledWith(mockHrAdmin.tenantId, dto);
    });

    it('deletes the configuration named in the path, scoped to the caller tenant', async () => {
      await controller.deleteIncomeTax(mockHrAdmin, 'itc-1');

      expect(service.deleteIncomeTaxConfig).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'itc-1');
    });
  });
});
