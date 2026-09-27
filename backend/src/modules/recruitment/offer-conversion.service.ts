import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JobApplicationStatus, JobOfferStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ApplicationsService } from './applications.service';
import { RequisitionsService } from './requisitions.service';
import { OfferConversionResult } from './recruitment.types';
import { ConvertOfferDto } from './dto/offer.dto';

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Accepted offer → Employee (Keka wave D2).
 *
 * 1. EmployeesService.create — the one employee-creation path (validation,
 *    optional login, `employee.created` webhook, welcome e-mail). It commits
 *    on its own.
 * 2 + 4. In one transaction: the offer is linked (guarded on `employeeId:
 *    null`, so converting twice cannot link twice), the EmployeeSalary is
 *    created when the offer carries a structure and base pay, the application
 *    moves to HIRED and the requisition records the hire.
 * 3. The onboarding process, after that.
 *
 * Retry safety: an employee of the tenant with the candidate's email created
 * at or after the acceptance is taken to be this conversion's step 1, so a
 * failure after step 1 can be retried without a 409 from EmployeesService.
 */
@Injectable()
export class OfferConversionService {
  private readonly logger = new Logger(OfferConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingService,
    private readonly applications: ApplicationsService,
    private readonly requisitions: RequisitionsService,
  ) {}

  async convert(
    actor: AuthenticatedUser,
    offerId: string,
    input: ConvertOfferDto,
  ): Promise<OfferConversionResult> {
    const { tenantId } = actor;
    const offer = await this.prisma.jobOffer.findFirst({
      where: { id: offerId, tenantId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        respondedAt: true,
        joiningDate: true,
        designationId: true,
        departmentId: true,
        branchId: true,
        reportingManagerId: true,
        employmentType: true,
        monthlyBasePay: true,
        salaryStructureId: true,
        applicationId: true,
        candidate: { select: { firstName: true, lastName: true, email: true, phone: true } },
        application: {
          select: { id: true, status: true, jobOpening: { select: { requisitionId: true } } },
        },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.employeeId) throw new ConflictException('This offer has already been converted');
    if (offer.status !== JobOfferStatus.ACCEPTED) {
      throw new BadRequestException('Only an accepted offer can be converted');
    }
    // The candidate accepted, but HR has since rejected or withdrawn the
    // application: hiring them now would contradict the pipeline.
    if (
      offer.application.status === JobApplicationStatus.REJECTED ||
      offer.application.status === JobApplicationStatus.WITHDRAWN
    ) {
      throw new ConflictException(
        `The application was ${offer.application.status.toLowerCase()}; this offer can no longer be converted`,
      );
    }
    const employeeCode = input.employeeCode?.trim();
    if (!employeeCode) throw new BadRequestException('employeeCode is required');
    if (input.createUser && !input.userPassword) {
      throw new BadRequestException('A password is required to create a login');
    }
    // Validate up front: step 3 runs after the employee exists.
    if (input.onboardingTemplateId) {
      const template = await this.prisma.onboardingTemplate.findFirst({
        where: { id: input.onboardingTemplateId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!template) throw new BadRequestException('Onboarding template not found or inactive');
    }

    const { candidate } = offer;

    // ---- Step 1 (or resume) ----------------------------------------------------
    const resumed = offer.respondedAt
      ? await this.prisma.employee.findFirst({
          where: { tenantId, email: candidate.email, createdAt: { gte: offer.respondedAt } },
          select: { id: true },
        })
      : null;
    let employeeId: string;
    if (resumed) {
      employeeId = resumed.id;
    } else {
      const created = await this.employees.create(tenantId, {
        employeeCode,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        personalEmail: candidate.email,
        phone: candidate.phone ?? undefined,
        departmentId: offer.departmentId ?? undefined,
        designationId: offer.designationId ?? undefined,
        branchId: offer.branchId ?? undefined,
        managerId: offer.reportingManagerId ?? undefined,
        employmentType: offer.employmentType,
        joinDate: ymd(offer.joiningDate),
        createUser: input.createUser === true,
        ...(input.createUser
          ? {
              userEmail: (input.userEmail ?? candidate.email).trim().toLowerCase(),
              userPassword: input.userPassword,
              userRole: UserRole.EMPLOYEE,
            }
          : {}),
      });
      employeeId = created.id;
    }

    // ---- Steps 2 + 4 -----------------------------------------------------------
    let employeeSalaryId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const linked = await tx.jobOffer.updateMany({
        where: { id: offer.id, tenantId, status: JobOfferStatus.ACCEPTED, employeeId: null },
        data: { employeeId, convertedAt: new Date() },
      });
      if (linked.count === 0) {
        throw new ConflictException('This offer has already been converted');
      }

      if (offer.salaryStructureId && offer.monthlyBasePay !== null) {
        const salary = await tx.employeeSalary.create({
          data: {
            tenantId,
            employeeId,
            salaryStructureId: offer.salaryStructureId,
            basePay: offer.monthlyBasePay,
            effectiveFrom: offer.joiningDate,
            isActive: true,
          },
          select: { id: true },
        });
        employeeSalaryId = salary.id;
      }

      if (offer.application.status === JobApplicationStatus.ACTIVE) {
        await this.applications.moveToStage({
          tenantId,
          applicationId: offer.applicationId,
          toCategory: 'HIRED',
          actorUserId: actor.userId,
          note: 'Offer accepted; converted to an employee',
          tx,
        });
      }

      const requisitionId = offer.application.jobOpening.requisitionId;
      if (requisitionId) {
        await this.requisitions.recordHire(tenantId, requisitionId, tx);
      }
    });

    // ---- Step 3 ----------------------------------------------------------------
    let onboardingProcessId: string | null = null;
    if (input.onboardingTemplateId) {
      try {
        const process = await this.onboarding.createProcess(tenantId, {
          employeeId,
          templateId: input.onboardingTemplateId,
          startDate: ymd(offer.joiningDate),
        });
        onboardingProcessId = process?.id ?? null;
      } catch (error) {
        // The hire is recorded; HR can start onboarding from the onboarding page.
        this.logger.warn(
          `Offer ${offer.id} converted, but onboarding could not start: ${(error as Error).message}`,
        );
      }
    }

    return { employeeId, onboardingProcessId, employeeSalaryId };
  }
}
