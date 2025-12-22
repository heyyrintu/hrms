import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from '../../common/types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Register a new user (dev mode or tenant bootstrap)
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const tenantId = dto.tenantId || this.configService.get<string>('DEFAULT_TENANT_ID');

    if (!tenantId) {
      throw new ConflictException('Tenant ID is required');
    }

    // Check if tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new ConflictException('Tenant not found');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: dto.email,
        },
      },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash,
        role: dto.role || 'EMPLOYEE',
      },
    });

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        employeeId: user.employeeId || undefined,
      },
    };
  }

  /**
   * Login with email and password
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // Find user by email (need to check across tenants in dev mode)
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        employeeId: user.employeeId || undefined,
      },
    };
  }

  /**
   * Get current user profile
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      employee: user.employee,
    };
  }

  /**
   * Validate user from JWT payload
   */
  async validateUser(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
    };
  }
}
