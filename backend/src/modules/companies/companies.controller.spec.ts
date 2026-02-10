import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

const mockCompaniesService = {
  create: jest.fn(),
  findAll: jest.fn(),
  getStatsSummary: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  toggleStatus: jest.fn(),
  remove: jest.fn(),
};

describe('CompaniesController', () => {
  let controller: CompaniesController;
  let service: typeof mockCompaniesService;

  beforeEach(async () => {
    Object.values(mockCompaniesService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: mockCompaniesService },
      ],
    }).compile();

    controller = module.get<CompaniesController>(CompaniesController);
    service = module.get(CompaniesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call companiesService.create with dto and return result', async () => {
      const dto = { name: 'Acme Corp', domain: 'acme.com' };
      const mockResult = { id: 'company-1', ...dto };
      service.create.mockResolvedValue(mockResult);

      const result = await controller.create(dto as any);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findAll', () => {
    it('should call companiesService.findAll with query and return result', async () => {
      const query = { page: 1, limit: 10 };
      const mockResult = { data: [], total: 0 };
      service.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getStats', () => {
    it('should call companiesService.getStatsSummary and return result', async () => {
      const mockResult = { totalCompanies: 5, activeCompanies: 3 };
      service.getStatsSummary.mockResolvedValue(mockResult);

      const result = await controller.getStats();

      expect(service.getStatsSummary).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('findOne', () => {
    it('should call companiesService.findOne with id and return result', async () => {
      const mockResult = { id: 'company-1', name: 'Acme Corp' };
      service.findOne.mockResolvedValue(mockResult);

      const result = await controller.findOne('company-1');

      expect(service.findOne).toHaveBeenCalledWith('company-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should call companiesService.update with id and dto', async () => {
      const dto = { name: 'Updated Corp' };
      const mockResult = { id: 'company-1', name: 'Updated Corp' };
      service.update.mockResolvedValue(mockResult);

      const result = await controller.update('company-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('company-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('toggleStatus', () => {
    it('should call companiesService.toggleStatus with id and return result', async () => {
      const mockResult = { id: 'company-1', isActive: false };
      service.toggleStatus.mockResolvedValue(mockResult);

      const result = await controller.toggleStatus('company-1');

      expect(service.toggleStatus).toHaveBeenCalledWith('company-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('remove', () => {
    it('should call companiesService.remove with id and return result', async () => {
      const mockResult = { id: 'company-1', deletedAt: new Date() };
      service.remove.mockResolvedValue(mockResult);

      const result = await controller.remove('company-1');

      expect(service.remove).toHaveBeenCalledWith('company-1');
      expect(result).toEqual(mockResult);
    });
  });
});
