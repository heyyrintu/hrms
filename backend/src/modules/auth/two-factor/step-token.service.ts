import { Injectable, NotImplementedException } from '@nestjs/common';
import { EnrolStepPayload, MfaStepPayload, StepTokenType } from '../auth.types';

/**
 * Signs and verifies the short-lived `typ`-tagged tokens used between the
 * password step and a full session. Owned by WS-2 (plan Task 2.2).
 */
@Injectable()
export class StepTokenService {
  signMfa(_payload: Omit<MfaStepPayload, 'typ'>): string {
    throw new NotImplementedException();
  }

  signEnrol(_payload: Omit<EnrolStepPayload, 'typ'>): string {
    throw new NotImplementedException();
  }

  verify(_token: string, _typ: 'mfa'): MfaStepPayload;
  verify(_token: string, _typ: 'enrol'): EnrolStepPayload;
  verify(_token: string, _typ: StepTokenType): MfaStepPayload | EnrolStepPayload {
    throw new NotImplementedException();
  }
}
