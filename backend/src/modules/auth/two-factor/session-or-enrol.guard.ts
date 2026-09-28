import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { StepTokenService } from './step-token.service';

/**
 * Decode (without verifying) the `typ` claim of a bearer JWT, so this guard
 * can branch before deciding which verification path applies. The token's
 * signature and expiry are still checked afterwards: by the JWT strategy for
 * a normal session, or by StepTokenService.verify for an enrol token.
 */
function peekTyp(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.typ === 'string' ? payload.typ : undefined;
  } catch {
    return undefined;
  }
}

function bearerToken(request: { headers?: Record<string, unknown> }): string | undefined {
  const header = request.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

/**
 * Accepts either a normal session (via the JWT strategy) or a valid `enrol`
 * step token whose tokenVersion matches and whose user has not enabled 2FA
 * yet. Used by /auth/2fa/setup and /auth/2fa/enable, which run either while
 * signed in (adding 2FA voluntarily) or mid-login (forced enrolment).
 * Owned by WS-2 (plan Task 2.2).
 */
@Injectable()
export class SessionOrEnrolGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly stepTokenService: StepTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = bearerToken(request);
    const typ = peekTyp(token);

    if (typ === undefined) {
      return this.jwtAuthGuard.canActivate(context) as Promise<boolean>;
    }

    if (typ !== 'enrol') {
      throw new UnauthorizedException('Invalid token');
    }

    const payload = this.stepTokenService.verify(token as string, 'enrol');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (
      !user ||
      !user.isActive ||
      user.tokenVersion !== payload.tokenVersion ||
      user.totpEnabledAt !== null
    ) {
      throw new UnauthorizedException('Invalid token');
    }

    request.user = {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
      permissions: [],
      enrolOnly: true,
    };

    return true;
  }
}
