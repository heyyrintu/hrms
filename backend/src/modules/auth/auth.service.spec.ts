import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';

jest.mock('bcrypt');

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('default-tenant-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);

    // Wave H1: no custom roles and no security settings unless a test says so.
    prisma.userCustomRole.findMany.mockResolvedValue([]);
    prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);

    // Reset bcrypt mocks
    (mockBcrypt.hash as jest.Mock).mockReset();
    (mockBcrypt.compare as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto = {
      email: 'new@test.com',
      password: 'password123',
    };

    const mockTenant = { id: 'test-tenant', name: 'Test Tenant' };

    const mockCreatedUser = {
      id: 'user-1',
      email: 'new@test.com',
      passwordHash: 'hashed-password',
      role: 'EMPLOYEE',
      tenantId: 'test-tenant',
      employeeId: null,
      isActive: true,
    };

    it('should create the user in the caller tenant, ignoring any tenantId in the body', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockCreatedUser);

      await service.register(
        { ...registerDto, tenantId: 'victim-tenant' } as any,
        mockHrAdmin,
      );

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: mockHrAdmin.tenantId },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: mockHrAdmin.tenantId }),
      });
    });

    it('should forbid HR_ADMIN from creating a SUPER_ADMIN', async () => {
      await expect(
        service.register({ ...registerDto, role: 'SUPER_ADMIN' as any }, mockHrAdmin),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should register a new user successfully', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockCreatedUser);

      const result = await service.register(registerDto, mockHrAdmin);

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: {
          id: 'user-1',
          email: 'new@test.com',
          role: 'EMPLOYEE',
          tenantId: 'test-tenant',
          employeeId: undefined,
        },
      });

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-tenant' },
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_email: {
            tenantId: 'test-tenant',
            email: 'new@test.com',
          },
        },
      });
      expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'test-tenant',
          email: 'new@test.com',
          passwordHash: 'hashed-password',
          role: 'EMPLOYEE',
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'new@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: undefined,
      });
    });

    it('should throw ConflictException when tenant does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto, mockHrAdmin)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto, mockHrAdmin)).rejects.toThrow('Tenant not found');
    });

    it('should throw ConflictException when user already exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(mockCreatedUser);

      await expect(service.register(registerDto, mockHrAdmin)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto, mockHrAdmin)).rejects.toThrow(
        'User with this email already exists',
      );
    });

    it('should assign the provided role when specified', async () => {
      const dtoWithRole = { ...registerDto, role: 'HR_ADMIN' as any };
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({ ...mockCreatedUser, role: 'HR_ADMIN' });

      await service.register(dtoWithRole, mockHrAdmin);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'HR_ADMIN' }),
      });
    });
  });

  describe('validateUser token revocation', () => {
    const payload = {
      sub: 'user-1',
      email: 'user@test.com',
      tenantId: 'test-tenant',
      role: 'EMPLOYEE' as any,
      tokenVersion: 3,
    };

    it('should accept a token whose version matches the user record', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        isActive: true,
        tokenVersion: 3,
      });

      await expect(service.validateUser(payload)).resolves.toMatchObject({
        userId: 'user-1',
      });
    });

    it('should reject a token issued before the password was changed', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        isActive: true,
        tokenVersion: 4, // bumped by a password change since this token was issued
      });

      await expect(service.validateUser(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('changePassword', () => {
    const existing = {
      id: 'user-1',
      email: 'user@test.com',
      passwordHash: 'old-hash',
      tenantId: 'test-tenant',
      isActive: true,
      tokenVersion: 1,
    };

    it('should reject a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue(existing);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', { currentPassword: 'nope', newPassword: 'newpass123' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should store the new hash, clear the forced-change flag and invalidate old tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(existing);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({ ...existing, tokenVersion: 2 });

      await service.changePassword('user-1', {
        currentPassword: 'old',
        newPassword: 'newpass123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hash',
          mustChangePassword: false,
          // Bumping the version logs out every other session holding an old token.
          tokenVersion: { increment: 1 },
        },
      });
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'user@test.com',
      password: 'password123',
      tenantId: 'test-tenant',
    };

    const mockUser = {
      id: 'user-1',
      email: 'user@test.com',
      passwordHash: 'hashed-password',
      role: 'EMPLOYEE',
      tenantId: 'test-tenant',
      employeeId: 'emp-1',
      isActive: true,
    };

    it('should login successfully with valid credentials', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: {
          id: 'user-1',
          email: 'user@test.com',
          role: 'EMPLOYEE',
          tenantId: 'test-tenant',
          employeeId: 'emp-1',
          permissions: [],
        },
      });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: 'user@test.com',
          tenantId: 'test-tenant',
          isActive: true,
        },
      });
      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
      });
    });

    it('should use DEFAULT_TENANT_ID when tenantId is not provided', async () => {
      const dtoWithoutTenant = { email: 'user@test.com', password: 'password123' };
      prisma.user.findFirst.mockResolvedValue(mockUser);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(mockUser);

      await service.login(dtoWithoutTenant);

      expect(configService.get).toHaveBeenCalledWith('DEFAULT_TENANT_ID');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: 'user@test.com',
          tenantId: 'default-tenant-id',
          isActive: true,
        },
      });
    });

    it('should throw UnauthorizedException when tenantId is not resolved', async () => {
      configService.get.mockReturnValue(undefined);
      const dtoWithoutTenant = { email: 'user@test.com', password: 'password123' };

      await expect(service.login(dtoWithoutTenant)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(dtoWithoutTenant)).rejects.toThrow('Tenant ID is required');
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });
  });

  describe('getProfile', () => {
    const mockUserWithEmployee = {
      id: 'user-1',
      email: 'user@test.com',
      role: 'EMPLOYEE',
      tenantId: 'test-tenant',
      employee: {
        id: 'emp-1',
        firstName: 'John',
        lastName: 'Doe',
        department: { id: 'dept-1', name: 'Engineering' },
        manager: { id: 'mgr-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
      },
    };

    it('should return user profile with employee data', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserWithEmployee);

      const result = await service.getProfile('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@test.com',
        role: 'EMPLOYEE',
        tenantId: 'test-tenant',
        employee: mockUserWithEmployee.employee,
        permissions: [],
        customRoles: [],
        twoFactorEnabled: false,
        twoFactorRequired: false,
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: {
          employee: {
            include: {
              department: true,
              manager: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          customRoles: {
            select: { customRole: { select: { id: true, name: true, permissions: true } } },
          },
        },
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('non-existent')).rejects.toThrow(UnauthorizedException);
      await expect(service.getProfile('non-existent')).rejects.toThrow('User not found');
    });
  });

  describe('validateUser', () => {
    const payload = {
      sub: 'user-1',
      email: 'user@test.com',
      tenantId: 'test-tenant',
      role: 'EMPLOYEE' as any,
    };

    const mockActiveUser = {
      id: 'user-1',
      email: 'user@test.com',
      tenantId: 'test-tenant',
      role: 'EMPLOYEE',
      employeeId: 'emp-1',
      isActive: true,
    };

    it('should validate and return user data for active user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      const result = await service.validateUser(payload);

      expect(result).toEqual({
        userId: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        permissions: [],
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: {
          customRoles: { select: { customRole: { select: { permissions: true } } } },
        },
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser(payload)).rejects.toThrow(UnauthorizedException);
      await expect(service.validateUser(payload)).rejects.toThrow(
        'User not found or inactive',
      );
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockActiveUser, isActive: false });

      await expect(service.validateUser(payload)).rejects.toThrow(UnauthorizedException);
      await expect(service.validateUser(payload)).rejects.toThrow(
        'User not found or inactive',
      );
    });

    it('should return undefined employeeId when employee is not linked', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockActiveUser, employeeId: null });

      const result = await service.validateUser(payload);

      expect(result.employeeId).toBeUndefined();
    });
  });
  describe('wave H1 session helpers', () => {
    const baseUser = {
      id: 'user-1',
      email: 'user@test.com',
      passwordHash: 'hashed-password',
      role: 'EMPLOYEE',
      tenantId: 'test-tenant',
      employeeId: 'emp-1',
      isActive: true,
      mustChangePassword: false,
      tokenVersion: 3,
      totpEnabledAt: null,
    } as any;

    it('validateUser returns the deduplicated union of custom-role permissions, dropping unknown keys', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        customRoles: [
          { customRole: { permissions: ['org.manage', 'audit.view'] } },
          { customRole: { permissions: ['audit.view', 'retired.permission'] } },
        ],
      });

      const result = await service.validateUser({
        sub: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE' as any,
        tokenVersion: 3,
      });

      expect(result.permissions).toEqual(['audit.view', 'org.manage']);
    });

    it('issueSession signs the same payload login always signed and returns permissions', async () => {
      prisma.user.update.mockResolvedValue(baseUser);
      prisma.userCustomRole.findMany.mockResolvedValue([
        { customRole: { permissions: ['exit.manage'] } },
      ]);

      const result = await service.issueSession(baseUser);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'user@test.com',
        tenantId: 'test-tenant',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        tokenVersion: 3,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(prisma.userCustomRole.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { customRole: { select: { permissions: true } } },
      });
      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: {
          id: 'user-1',
          email: 'user@test.com',
          role: 'EMPLOYEE',
          tenantId: 'test-tenant',
          employeeId: 'emp-1',
          mustChangePassword: false,
          permissions: ['exit.manage'],
        },
      });
    });

    it('resolveTenantId falls back to DEFAULT_TENANT_ID without a code', async () => {
      await expect(service.resolveTenantId(undefined)).resolves.toBe('default-tenant-id');
      await expect(service.resolveTenantId('   ')).resolves.toBe('default-tenant-id');
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });

    it('resolveTenantId maps an active tenant code to its id', async () => {
      prisma.tenant.findFirst.mockResolvedValue({ id: 'acme-id' });

      await expect(service.resolveTenantId('acme')).resolves.toBe('acme-id');
      expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { code: 'acme', isActive: true },
        select: { id: true },
      });
    });

    it('resolveTenantId refuses an unknown or inactive code', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.resolveTenantId('ghost')).rejects.toThrow('Tenant not found');
    });

    it('resolveTenantId refuses when no code and no default tenant is configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(service.resolveTenantId()).rejects.toThrow('Tenant ID is required');
    });

    it('getProfile reports custom roles, permissions and 2FA state', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'MANAGER',
        totpEnabledAt: new Date('2026-09-01T12:00:00Z'),
        employee: null,
        customRoles: [
          { customRole: { id: 'r1', name: 'Payroll Viewer', permissions: ['payroll.reports.view'] } },
        ],
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({
        twoFactorRequiredRoles: ['MANAGER', 'HR_ADMIN'],
      });

      const result = await service.getProfile('user-1');

      expect(result).toMatchObject({
        permissions: ['payroll.reports.view'],
        customRoles: [{ id: 'r1', name: 'Payroll Viewer' }],
        twoFactorEnabled: true,
        twoFactorRequired: true,
      });
      expect(result).not.toHaveProperty('totpSecretEnc');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
