import { Injectable, NotImplementedException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

/**
 * Two-factor enrolment, verification and admin reset.
 * Owned by WS-2 (plan Tasks 2.4 and 2.5); routes live in TwoFactorController.
 */
@Injectable()
export class TwoFactorService {
  /**
   * Admin reset: clears the user's TOTP secret and recovery codes and signs
   * out their sessions. Used by POST /security/users/:id/2fa/reset.
   */
  resetForUser(
    _tenantId: string,
    _targetUserId: string,
    _actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    throw new NotImplementedException();
  }
}
