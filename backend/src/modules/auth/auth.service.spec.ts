import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

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
      tenantId: 'test-tenant',
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

    it('should register a new user successfully', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockCreatedUser);

      const result = await service.register(registerDto);

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

    it('should use DEFAULT_TENANT_ID when tenantId is not provided', async () => {
      const dtoWithoutTenant = { email: 'new@test.com', password: 'password123' };
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockCreatedUser);

      await service.register(dtoWithoutTenant);

      expect(configService.get).toHaveBeenCalledWith('DEFAULT_TENANT_ID');
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'default-tenant-id' },
      });
    });

    it('should throw ConflictException when tenantId is not resolved', async () => {
      configService.get.mockReturnValue(undefined);
      const dtoWithoutTenant = { email: 'new@test.com', password: 'password123' };

      await expect(service.register(dtoWithoutTenant)).rejects.toThrow(ConflictException);
      await expect(service.register(dtoWithoutTenant)).rejects.toThrow('Tenant ID is required');
    });

    it('should throw ConflictException when tenant does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow('Tenant not found');
    });

    it('should throw ConflictException when user already exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(mockCreatedUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow(
        'User with this email already exists',
      );
    });

    it('should assign the provided role when specified', async () => {
      const dtoWithRole = { ...registerDto, role: 'HR_ADMIN' as any };
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.user.findUnique.mockResolvedValue(null);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({ ...mockCreatedUser, role: 'HR_ADMIN' });

      await service.register(dtoWithRole);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'HR_ADMIN' }),
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
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
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
});
