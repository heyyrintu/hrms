import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto, AuthResponseDto } from './dto/auth.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthenticatedUser, JwtPayload } from '../../common/types/jwt-payload.type';
import { isPermission } from '../../common/permissions/permissions';
import { SessionResponse } from './auth.types';

/** Rows of UserCustomRole with the role's permissions, as loaded for a session. */
type CustomRoleGrant = { customRole: { permissions: string[] } };

/**
 * Union of the permissions granted by a user's custom roles, deduplicated.
 * Keys that are no longer in the catalogue are dropped, so removing a
 * permission from the code revokes it everywhere without a data migration.
 */
function permissionsFrom(grants: CustomRoleGrant[] | undefined | null): string[] {
  const keys = new Set<string>();
  for (const grant of grants ?? []) {
    for (const key of grant.customRole?.permissions ?? []) {
      if (isPermission(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Register a new user inside the caller's tenant.
   * The tenant is always taken from the caller's JWT, never from the body,
   * and an HR_ADMIN may not mint a SUPER_ADMIN.
   */
  async register(
    dto: RegisterDto,
    caller: AuthenticatedUser,
  ): Promise<AuthResponseDto> {
    const tenantId = caller.tenantId;
    const role = dto.role || UserRole.EMPLOYEE;

    if (role === UserRole.SUPER_ADMIN && caller.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a SUPER_ADMIN can create SUPER_ADMIN accounts');
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
        role,
      },
    });

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
      tokenVersion: user.tokenVersion,
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
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /**
   * Login with email and password
   */
  async login(dto: LoginDto): Promise<SessionResponse> {
    // Determine tenant ID - use provided tenantId or default
    const tenantId = dto.tenantId || this.configService.get<string>('DEFAULT_TENANT_ID');

    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID is required');
    }

    // Find user by email and tenantId for proper tenant isolation
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        tenantId: tenantId,
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

    return this.issueSession(user);
  }

  /**
   * Sign a normal session for a user who has fully authenticated (password,
   * password + second factor, or SSO). Records the login time and returns the
   * user's custom-role permissions so the client can shape its navigation.
   */
  async issueSession(user: User): Promise<SessionResponse> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = this.jwtService.sign(payload);
    const permissions = await this.loadPermissions(user.id);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        employeeId: user.employeeId || undefined,
        mustChangePassword: user.mustChangePassword,
        permissions,
      },
    };
  }

  /** Permissions granted to a user by their custom roles. */
  async loadPermissions(userId: string): Promise<string[]> {
    const grants = await this.prisma.userCustomRole.findMany({
      where: { userId },
      select: { customRole: { select: { permissions: true } } },
    });
    return permissionsFrom(grants);
  }

  /**
   * Tenant for an unauthenticated sign-in: the active tenant with this code,
   * or DEFAULT_TENANT_ID when no code is given.
   */
  async resolveTenantId(tenantCode?: string | null): Promise<string> {
    const code = tenantCode?.trim();
    if (code) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { code, isActive: true },
        select: { id: true },
      });
      if (!tenant) {
        throw new UnauthorizedException('Tenant not found');
      }
      return tenant.id;
    }

    const tenantId = this.configService.get<string>('DEFAULT_TENANT_ID');
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID is required');
    }
    return tenantId;
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
        customRoles: {
          select: { customRole: { select: { id: true, name: true, permissions: true } } },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const settings = await this.prisma.tenantSecuritySettings.findUnique({
      where: { tenantId: user.tenantId },
      select: { twoFactorRequiredRoles: true },
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      employee: user.employee,
      permissions: permissionsFrom(user.customRoles),
      customRoles: (user.customRoles ?? []).map((grant) => ({
        id: grant.customRole.id,
        name: grant.customRole.name,
      })),
      twoFactorEnabled: !!user.totpEnabledAt,
      twoFactorRequired: (settings?.twoFactorRequiredRoles ?? []).includes(user.role),
    };
  }

  /**
   * Validate user from JWT payload
   */
  async validateUser(payload: JwtPayload) {
    // Custom-role permissions ride along on the lookup that already runs for
    // every request, so a grant or revocation applies on the next request.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        customRoles: { select: { customRole: { select: { permissions: true } } } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Reject tokens from a superseded session generation. Tokens minted before
    // this field existed carry no version and are accepted until they expire.
    if (
      payload.tokenVersion !== undefined &&
      payload.tokenVersion !== user.tokenVersion
    ) {
      throw new UnauthorizedException('Session has been revoked. Please sign in again.');
    }

    return {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId || undefined,
      permissions: permissionsFrom(user.customRoles),
    };
  }

  /**
   * Change the signed-in user's own password.
   *
   * Bumps tokenVersion, so every other session holding a token minted before
   * the change stops working. Also clears the forced-change flag set on
   * bulk-imported accounts that shared one initial password.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        // Bumping the version logs out every other session holding an old token.
        tokenVersion: { increment: 1 },
      },
    });

    return { message: 'Password changed. Other sessions have been signed out.' };
  }
}
