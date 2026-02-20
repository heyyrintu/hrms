import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LettersService } from './letters.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { createMockPrismaService, createMockEmailService } from '../../test/helpers';

describe('LettersService', () => {
  let service: LettersService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LettersService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EmailService, useValue: createMockEmailService() },
      ],
    }).compile();

    service = module.get<LettersService>(LettersService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Template CRUD ─────────────────────────────────────────

  describe('createTemplate', () => {
    it('should create a letter template', async () => {
      const dto = { name: 'Offer Letter', type: 'OFFER_LETTER' as any, content: '<p>Hello {{employeeName}}</p>' };
      const created = { id: 'tpl-1', tenantId: 'tenant-1', ...dto };
      prisma.letterTemplate.create.mockResolvedValue(created);

      const result = await service.createTemplate('tenant-1', dto);

      expect(prisma.letterTemplate.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', ...dto },
      });
      expect(result).toEqual(created);
    });
  });

  describe('getTemplates', () => {
    it('should return all templates for a tenant', async () => {
      const templates = [{ id: 'tpl-1' }, { id: 'tpl-2' }];
      prisma.letterTemplate.findMany.mockResolvedValue(templates);

      const result = await service.getTemplates('tenant-1', {});

      expect(prisma.letterTemplate.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(templates);
    });

    it('should filter by type', async () => {
      prisma.letterTemplate.findMany.mockResolvedValue([]);

      await service.getTemplates('tenant-1', { type: 'OFFER_LETTER' as any });

      expect(prisma.letterTemplate.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', type: 'OFFER_LETTER' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by search term', async () => {
      prisma.letterTemplate.findMany.mockResolvedValue([]);

      await service.getTemplates('tenant-1', { search: 'offer' });

      expect(prisma.letterTemplate.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          name: { contains: 'offer', mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getTemplate', () => {
    it('should return a template by id', async () => {
      const template = { id: 'tpl-1', name: 'Offer Letter' };
      prisma.letterTemplate.findFirst.mockResolvedValue(template);

      const result = await service.getTemplate('tenant-1', 'tpl-1');

      expect(result).toEqual(template);
    });

    it('should throw NotFoundException when template not found', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTemplate('tenant-1', 'none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTemplate', () => {
    it('should update an existing template', async () => {
      const existing = { id: 'tpl-1', tenantId: 'tenant-1' };
      prisma.letterTemplate.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, name: 'Updated' };
      prisma.letterTemplate.update.mockResolvedValue(updated);

      const result = await service.updateTemplate('tenant-1', 'tpl-1', { name: 'Updated' });

      expect(prisma.letterTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: { name: 'Updated' },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException if template does not exist', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTemplate('tenant-1', 'none', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTemplate', () => {
    it('should delete an existing template', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
      prisma.letterTemplate.delete.mockResolvedValue({ id: 'tpl-1' });

      const result = await service.deleteTemplate('tenant-1', 'tpl-1');

      expect(prisma.letterTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
      expect(result).toEqual({ message: 'Template deleted' });
    });

    it('should throw NotFoundException if template does not exist', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue(null);

      await expect(service.deleteTemplate('tenant-1', 'none')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Letter Generation ─────────────────────────────────────

  describe('generateLetter', () => {
    const dto = { templateId: 'tpl-1', employeeId: 'emp-1' };

    it('should throw NotFoundException when template not found', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.generateLetter('tenant-1', 'user-1', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue({
        id: 'tpl-1',
        content: 'Hello {{employeeName}}',
        isActive: true,
      });
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.generateLetter('tenant-1', 'user-1', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should generate a letter with variable substitution', async () => {
      const template = {
        id: 'tpl-1',
        content: 'Dear {{employeeName}}, Welcome to {{companyName}}!',
        type: 'OFFER_LETTER',
        isActive: true,
      };
      const employee = {
        id: 'emp-1',
        firstName: 'John',
        lastName: 'Doe',
        employeeCode: 'EMP001',
        email: 'john@test.com',
        joinDate: new Date('2024-01-15T12:00:00Z'),
        exitDate: null,
        designation: { name: 'Developer' },
        department: { name: 'Engineering' },
        branch: { name: 'HQ' },
        manager: null,
        tenant: { name: 'Acme Corp', addressLine1: '123 St', city: 'Mumbai', state: 'MH', pinCode: '400001' },
      };
      prisma.letterTemplate.findFirst.mockResolvedValue(template);
      prisma.employee.findFirst.mockResolvedValue(employee);

      const generated = {
        id: 'gen-1',
        content: 'Dear John Doe, Welcome to Acme Corp!',
        template: { name: 'Offer Letter', type: 'OFFER_LETTER' },
        employee: { firstName: 'John', lastName: 'Doe', employeeCode: 'EMP001', department: { name: 'Engineering' } },
      };
      prisma.letterGenerated.create.mockResolvedValue(generated);

      const result = await service.generateLetter('tenant-1', 'user-1', dto);

      expect(prisma.letterGenerated.create).toHaveBeenCalled();
      expect(result).toEqual(generated);
    });
  });

  // ── Generated Letters ─────────────────────────────────────

  describe('getGeneratedLetters', () => {
    it('should return all generated letters for tenant', async () => {
      const letters = [{ id: 'gen-1' }];
      prisma.letterGenerated.findMany.mockResolvedValue(letters);

      const result = await service.getGeneratedLetters('tenant-1');

      expect(result).toEqual(letters);
    });
  });

  describe('getMyLetters', () => {
    it('should return letters for a specific employee', async () => {
      const letters = [{ id: 'gen-1' }];
      prisma.letterGenerated.findMany.mockResolvedValue(letters);

      const result = await service.getMyLetters('tenant-1', 'emp-1');

      expect(prisma.letterGenerated.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: { template: { select: { name: true, type: true } } },
        orderBy: { generatedAt: 'desc' },
      });
      expect(result).toEqual(letters);
    });
  });

  describe('getGeneratedLetter', () => {
    it('should return a generated letter by id', async () => {
      const letter = { id: 'gen-1', content: 'Hello' };
      prisma.letterGenerated.findFirst.mockResolvedValue(letter);

      const result = await service.getGeneratedLetter('tenant-1', 'gen-1');

      expect(result).toEqual(letter);
    });

    it('should throw NotFoundException when letter not found', async () => {
      prisma.letterGenerated.findFirst.mockResolvedValue(null);

      await expect(service.getGeneratedLetter('tenant-1', 'none')).rejects.toThrow(NotFoundException);
    });
  });
});
