import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { OfferConversionResult } from './recruitment.types';

/**
 * Accepted offer → Employee (EmployeesService.create), EmployeeSalary, OnboardingProcess.
 * Scaffold stub (Keka wave D) — implemented by WS-D2.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class OfferConversionService {
  constructor(private readonly prisma: PrismaService) {}

  convert(actor: AuthenticatedUser, offerId: string, input: Record<string, unknown>): Promise<OfferConversionResult> {
    void actor;
    void offerId;
    void input;
    throw new NotImplementedException();
  }
}
