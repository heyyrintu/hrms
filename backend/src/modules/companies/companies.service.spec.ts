import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { StorageService } from '../../common/storage/storage.service';
import { CreateCompanyDto, UpdateCompanyDto, CompanyQueryDto } from './dto/company.dto';
import { UserRole } from '@prisma/client';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: StorageService, useValue: { upload: jest.fn(), delete: jest.fn(), getFilePath: jest.fn() } },
      ],
    }).compile();

    service = module.get<CompaniesService>(CompaniesService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    const dto: CreateCompanyDto = {
      name: 'Acme Corp',
      code: 'ACME',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Secret123',
      adminFirstName: 'John',
      adminLastName: 'Doe',
    };

    it('should create a company with admin user and defaults', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      // $transaction receives a callback; mock PrismaService's proxy already
      // passes itself as tx, so the inner calls hit the same mocks.
      const mockCompany = { id: 'tenant-1', name: dto.name, code: dto.code };
      const mockEmployee = { id: 'emp-1' };
      const mockUser = { id: 'user-1', email: dto.adminEmail, role: UserRole.HR_ADMIN };

      prisma.tenant.create.mockResolvedValue(mockCompany);
      prisma.employee.create.mockResolvedValue(mockEmployee);
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.leaveType.createMany.mockResolvedValue({ count: 3 });
      prisma.otRule.create.mockResolvedValue({ id: 'ot-1' });

      const result = await service.create(dto);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { code: dto.code } });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: dto.adminEmail } });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        company: mockCompany,
        admin: { id: mockUser.id, email: mockUser.email, role: mockUser.role },
      });
    });

    it('should throw ConflictException when company code already exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'existing', code: dto.code });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('Company code already exists');
    });

    it('should throw ConflictException when admin email already exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user', email: dto.adminEmail });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('Admin email already exists in the system');
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('should return all companies mapped with flat counts', async () => {
      const raw = [
        {
          id: 't1',
          name: 'A',
          _count: { employees: 10, users: 3, departments: 2 },
        },
      ];
      prisma.tenant.findMany.mockResolvedValue(raw);

      const result = await service.findAll({} as CompanyQueryDto);

      expect(prisma.tenant.findMany).toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({
          id: 't1',
          employeeCount: 10,
          userCount: 3,
          departmentCount: 2,
          _count: undefined,
        }),
      ]);
    });

    it('should apply search filter', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);

      await service.findAll({ search: 'acme' } as CompanyQueryDto);

      const callArg = prisma.tenant.findMany.mock.calls[0][0];
      expect(callArg.where).toHaveProperty('OR');
      expect(callArg.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: { contains: 'acme', mode: 'insensitive' } }),
          expect.objectContaining({ code: { contains: 'acme', mode: 'insensitive' } }),
        ]),
      );
    });

    it('should apply isActive filter', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);

      await service.findAll({ isActive: true } as CompanyQueryDto);

      const callArg = prisma.tenant.findMany.mock.calls[0][0];
      expect(callArg.where).toHaveProperty('isActive', true);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    const companyId = 'tenant-1';
    const mockCompany = {
      id: companyId,
      name: 'Acme',
      isActive: true,
      _count: { employees: 5, users: 2, departments: 1, leaveTypes: 3, otRules: 1 },
    };

    it('should return a company with flat counts and activeEmployeeCount', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockCompany);
      prisma.employee.count.mockResolvedValue(4);

      const result = await service.findOne(companyId);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: companyId } }),
      );
      expect(prisma.employee.count).toHaveBeenCalledWith({
        where: { tenantId: companyId, status: 'ACTIVE' },
      });
      expect(result).toEqual(
        expect.objectContaining({
          employeeCount: 5,
          activeEmployeeCount: 4,
          userCount: 2,
          departmentCount: 1,
          leaveTypeCount: 3,
          otRuleCount: 1,
          _count: undefined,
        }),
      );
    });

    it('should throw NotFoundException when company does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent')).rejects.toThrow('Company not found');
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    const companyId = 'tenant-1';
    const dto: UpdateCompanyDto = { name: 'Updated Corp' };

    it('should update and return enriched company data', async () => {
      // findOne is called twice: once as guard, once to return enriched result
      const companyData = {
        id: companyId,
        name: 'Updated Corp',
        isActive: true,
        _count: { employees: 0, users: 0, departments: 0, leaveTypes: 0, otRules: 0 },
      };
      prisma.tenant.findUnique.mockResolvedValue(companyData);
      prisma.employee.count.mockResolvedValue(0);
      prisma.tenant.update.mockResolvedValue({ id: companyId, name: 'Updated Corp' });

      const result = await service.update(companyId, dto);

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: companyId },
        data: dto,
      });
      // Returns enriched data from findOne (with stats), not raw update result
      expect(result).toMatchObject({
        id: companyId,
        employeeCount: 0,
        activeEmployeeCount: 0,
        userCount: 0,
        departmentCount: 0,
      });
    });

    it('should throw NotFoundException if company does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // toggleStatus
  // ---------------------------------------------------------------------------
  describe('toggleStatus', () => {
    it('should toggle isActive from true to false', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        isActive: true,
        _count: { employees: 0, users: 0, departments: 0, leaveTypes: 0, otRules: 0 },
      });
      prisma.employee.count.mockResolvedValue(0);

      const toggled = { id: 't1', isActive: false };
      prisma.tenant.update.mockResolvedValue(toggled);

      const result = await service.toggleStatus('t1');

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: false },
      });
      expect(result).toEqual(toggled);
    });

    it('should toggle isActive from false to true', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        isActive: false,
        _count: { employees: 0, users: 0, departments: 0, leaveTypes: 0, otRules: 0 },
      });
      prisma.employee.count.mockResolvedValue(0);

      const toggled = { id: 't1', isActive: true };
      prisma.tenant.update.mockResolvedValue(toggled);

      const result = await service.toggleStatus('t1');

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: true },
      });
      expect(result).toEqual(toggled);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should delete a company with no employees', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        _count: { employees: 0 },
      });
      // $transaction delegates are the same proxy
      prisma.otRule.deleteMany.mockResolvedValue({ count: 0 });
      prisma.leaveType.deleteMany.mockResolvedValue({ count: 0 });
      prisma.user.deleteMany.mockResolvedValue({ count: 0 });
      prisma.department.deleteMany.mockResolvedValue({ count: 0 });
      prisma.tenant.delete.mockResolvedValue({ id: 't1' });

      const result = await service.remove('t1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Company deleted successfully' });
    });

    it('should throw NotFoundException if company does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if company has employees', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        _count: { employees: 5 },
      });

      await expect(service.remove('t1')).rejects.toThrow(ForbiddenException);
      await expect(service.remove('t1')).rejects.toThrow(
        'Cannot delete company with existing employees',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getStatsSummary
  // ---------------------------------------------------------------------------
  describe('getStatsSummary', () => {
    it('should return aggregated stats', async () => {
      prisma.tenant.count
        .mockResolvedValueOnce(10)  // totalCompanies
        .mockResolvedValueOnce(8);  // activeCompanies
      prisma.employee.count.mockResolvedValue(50);
      prisma.user.count.mockResolvedValue(20);

      const result = await service.getStatsSummary();

      expect(result).toEqual({
        totalCompanies: 10,
        activeCompanies: 8,
        inactiveCompanies: 2,
        totalEmployees: 50,
        totalUsers: 20,
      });
    });
  });
});
