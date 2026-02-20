import { Test, TestingModule } from '@nestjs/testing';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockLettersService = {
  createTemplate: jest.fn(),
  getTemplates: jest.fn(),
  getTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
  generateLetter: jest.fn(),
  getGeneratedLetters: jest.fn(),
  getMyLetters: jest.fn(),
  getGeneratedLetter: jest.fn(),
  generatePdf: jest.fn(),
};

describe('LettersController', () => {
  let controller: LettersController;
  let service: typeof mockLettersService;

  const hrUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  const empUser: AuthenticatedUser = {
    userId: 'user-emp',
    email: 'emp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockLettersService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LettersController],
      providers: [{ provide: LettersService, useValue: mockLettersService }],
    }).compile();

    controller = module.get<LettersController>(LettersController);
    service = module.get(LettersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createTemplate', () => {
    it('should call service.createTemplate with tenantId and dto', async () => {
      const dto = { name: 'Offer', type: 'OFFER_LETTER', content: '<p>test</p>' };
      service.createTemplate.mockResolvedValue({ id: 'tpl-1', ...dto });

      const result = await controller.createTemplate(hrUser, dto as any);

      expect(service.createTemplate).toHaveBeenCalledWith('tenant-1', dto);
      expect(result.id).toBe('tpl-1');
    });
  });

  describe('getTemplates', () => {
    it('should call service.getTemplates with tenantId and query', async () => {
      service.getTemplates.mockResolvedValue([]);

      await controller.getTemplates(hrUser, {});

      expect(service.getTemplates).toHaveBeenCalledWith('tenant-1', {});
    });
  });

  describe('getTemplate', () => {
    it('should call service.getTemplate with tenantId and id', async () => {
      const tpl = { id: 'tpl-1', name: 'Test' };
      service.getTemplate.mockResolvedValue(tpl);

      const result = await controller.getTemplate(hrUser, 'tpl-1');

      expect(service.getTemplate).toHaveBeenCalledWith('tenant-1', 'tpl-1');
      expect(result).toEqual(tpl);
    });
  });

  describe('updateTemplate', () => {
    it('should call service.updateTemplate', async () => {
      const dto = { name: 'Updated' };
      service.updateTemplate.mockResolvedValue({ id: 'tpl-1', ...dto });

      await controller.updateTemplate(hrUser, 'tpl-1', dto as any);

      expect(service.updateTemplate).toHaveBeenCalledWith('tenant-1', 'tpl-1', dto);
    });
  });

  describe('deleteTemplate', () => {
    it('should call service.deleteTemplate', async () => {
      service.deleteTemplate.mockResolvedValue({ message: 'Template deleted' });

      const result = await controller.deleteTemplate(hrUser, 'tpl-1');

      expect(service.deleteTemplate).toHaveBeenCalledWith('tenant-1', 'tpl-1');
      expect(result).toEqual({ message: 'Template deleted' });
    });
  });

  describe('generateLetter', () => {
    it('should call service.generateLetter with tenantId, userId, dto', async () => {
      const dto = { templateId: 'tpl-1', employeeId: 'emp-1' };
      service.generateLetter.mockResolvedValue({ id: 'gen-1' });

      await controller.generateLetter(hrUser, dto as any);

      expect(service.generateLetter).toHaveBeenCalledWith('tenant-1', 'user-hr', dto);
    });
  });

  describe('getGeneratedLetters', () => {
    it('should call service.getGeneratedLetters', async () => {
      service.getGeneratedLetters.mockResolvedValue([]);

      await controller.getGeneratedLetters(hrUser);

      expect(service.getGeneratedLetters).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('getMyLetters', () => {
    it('should call service.getMyLetters with employeeId', async () => {
      service.getMyLetters.mockResolvedValue([]);

      await controller.getMyLetters(empUser);

      expect(service.getMyLetters).toHaveBeenCalledWith('tenant-1', 'emp-1');
    });

    it('should pass empty string when employeeId is undefined', async () => {
      const userNoEmp: AuthenticatedUser = {
        ...hrUser,
        employeeId: undefined,
      };
      service.getMyLetters.mockResolvedValue([]);

      await controller.getMyLetters(userNoEmp);

      expect(service.getMyLetters).toHaveBeenCalledWith('tenant-1', '');
    });
  });

  describe('getGeneratedLetter', () => {
    it('should call service.getGeneratedLetter', async () => {
      service.getGeneratedLetter.mockResolvedValue({ id: 'gen-1' });

      await controller.getGeneratedLetter(hrUser, 'gen-1');

      expect(service.getGeneratedLetter).toHaveBeenCalledWith('tenant-1', 'gen-1');
    });
  });

  describe('downloadPdf', () => {
    it('should set response headers and send buffer', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-content');
      service.generatePdf.mockResolvedValue(pdfBuffer);

      const mockRes = {
        set: jest.fn(),
        end: jest.fn(),
      };

      await controller.downloadPdf(hrUser, 'gen-1', mockRes as any);

      expect(service.generatePdf).toHaveBeenCalledWith('tenant-1', 'gen-1');
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="letter-gen-1.pdf"',
        'Content-Length': pdfBuffer.length,
      });
      expect(mockRes.end).toHaveBeenCalledWith(pdfBuffer);
    });
  });
});
