import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EnrolStepPayload, MfaStepPayload, StepTokenType } from '../auth.types';

/**
 * Signs and verifies the short-lived `typ`-tagged tokens used between the
 * password step and a full session. Owned by WS-2 (plan Task 2.2).
 */
@Injectable()
export class StepTokenService {
  constructor(private readonly jwtService: JwtService) {}

  signMfa(payload: Omit<MfaStepPayload, 'typ'>): string {
    return this.jwtService.sign(
      { ...payload, typ: 'mfa' as const },
      { expiresIn: '5m' },
    );
  }

  signEnrol(payload: Omit<EnrolStepPayload, 'typ'>): string {
    return this.jwtService.sign(
      { ...payload, typ: 'enrol' as const },
      { expiresIn: '15m' },
    );
  }

  verify(token: string, typ: 'mfa'): MfaStepPayload;
  verify(token: string, typ: 'enrol'): EnrolStepPayload;
  verify(token: string, typ: StepTokenType): MfaStepPayload | EnrolStepPayload {
    let decoded: (MfaStepPayload | EnrolStepPayload) & { typ?: unknown };
    try {
      decoded = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (decoded.typ !== typ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return decoded as MfaStepPayload | EnrolStepPayload;
  }
}
