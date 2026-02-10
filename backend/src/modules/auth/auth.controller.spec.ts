import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  getProfile: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;
  let service: typeof mockAuthService;

  beforeEach(async () => {
    Object.values(mockAuthService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call authService.register with the dto and return result', async () => {
      const dto = {
        email: 'new@test.com',
        password: 'password123',
        tenantId: 'tenant-1',
        role: UserRole.EMPLOYEE,
      };
      const mockResult = { id: 'user-1', email: dto.email };
      service.register.mockResolvedValue(mockResult);

      const result = await controller.register(dto as any);

      expect(service.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });

    it('should propagate errors from the service', async () => {
      const dto = { email: 'bad@test.com', password: 'pw' };
      service.register.mockRejectedValue(new Error('Registration failed'));

      await expect(controller.register(dto as any)).rejects.toThrow(
        'Registration failed',
      );
    });
  });

  describe('login', () => {
    it('should call authService.login with the dto and return result', async () => {
      const dto = {
        email: 'user@test.com',
        password: 'password123',
        tenantId: 'tenant-1',
      };
      const mockResult = { access_token: 'jwt-token-123' };
      service.login.mockResolvedValue(mockResult);

      const result = await controller.login(dto as any);

      expect(service.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });

    it('should propagate errors from the service', async () => {
      const dto = { email: 'bad@test.com', password: 'wrong' };
      service.login.mockRejectedValue(new Error('Invalid credentials'));

      await expect(controller.login(dto as any)).rejects.toThrow(
        'Invalid credentials',
      );
    });
  });

  describe('getProfile', () => {
    it('should call authService.getProfile with user.userId and return result', async () => {
      const user: AuthenticatedUser = {
        userId: 'user-1',
        email: 'user@test.com',
        tenantId: 'tenant-1',
        role: UserRole.HR_ADMIN,
        employeeId: 'emp-1',
      };
      const mockResult = {
        id: user.userId,
        email: user.email,
        role: user.role,
      };
      service.getProfile.mockResolvedValue(mockResult);

      const result = await controller.getProfile(user);

      expect(service.getProfile).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(mockResult);
    });

    it('should propagate errors from the service', async () => {
      const user: AuthenticatedUser = {
        userId: 'nonexistent',
        email: 'x@test.com',
        tenantId: 'tenant-1',
        role: UserRole.EMPLOYEE,
      };
      service.getProfile.mockRejectedValue(new Error('User not found'));

      await expect(controller.getProfile(user)).rejects.toThrow(
        'User not found',
      );
    });
  });
});
