import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  PreOnboardingInviteCreated,
  PreOnboardingInviteView,
  PreOnboardingPersonalDetails,
  PublicPreOnboardingView,
} from './recruitment.types';

/**
 * Pre-onboarding invites (HR side) and the public token portal.
 * Scaffold stub (Keka wave D) — implemented by WS-D3.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class PreOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  create(actor: AuthenticatedUser, input: Record<string, unknown>): Promise<PreOnboardingInviteCreated> {
    void actor;
    void input;
    throw new NotImplementedException();
  }

  list(tenantId: string, status?: string): Promise<PreOnboardingInviteView[]> {
    void tenantId;
    void status;
    throw new NotImplementedException();
  }

  get(tenantId: string, id: string): Promise<PreOnboardingInviteView> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }

  revoke(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  resend(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteCreated> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  complete(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  getPublic(rawToken: string): Promise<PublicPreOnboardingView> {
    void rawToken;
    throw new NotImplementedException();
  }

  saveDetailsPublic(rawToken: string, details: PreOnboardingPersonalDetails): Promise<PublicPreOnboardingView> {
    void rawToken;
    void details;
    throw new NotImplementedException();
  }

  uploadDocumentPublic(rawToken: string, documentKey: string, file: Express.Multer.File): Promise<PublicPreOnboardingView> {
    void rawToken;
    void documentKey;
    void file;
    throw new NotImplementedException();
  }

  submitPublic(rawToken: string): Promise<PublicPreOnboardingView> {
    void rawToken;
    throw new NotImplementedException();
  }
}
