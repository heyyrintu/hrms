import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentProofSection,
  InvestmentProofStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_RECORD_NOT_FOUND,
} from '../../../common/utils/prisma-errors';
import {
  PROOF_SECTION_TO_DECLARATION_FIELD,
  verificationApplies,
} from './proofs.types';
import {
  ApproveProofDto,
  ProofQueueQueryDto,
  RejectProofDto,
  SubmitProofDto,
} from './dto/proofs.dto';

/**
 * Investment proofs: the evidence behind a tax declaration.
 *
 * An employee declares deductions at the start of the year and files documents
 * for them near its end. Payroll checks each document and records what it
 * actually supports, which may be less than was declared and often is. The gap
 * between the two is the point of the whole workflow, so every view here shows
 * declared, claimed and approved together rather than any one of them alone.
 *
 * Two rules shape most of what follows.
 *
 * **Authorization runs before any query.** An employee's methods are scoped to
 * their own employee id in the `where` clause rather than fetched and then
 * checked, so asking for a colleague's proof is answered the same way as asking
 * for one that does not exist. A "not found" cannot be used to confirm that a
 * colleague filed something.
 *
 * **Only a PENDING proof can move.** Withdrawal, approval and rejection all run
 * as status-guarded writes: the `where` clause names the status the record must
 * still be in, so when two reviewers act at the same instant the second one's
 * write matches nothing and is reported as a conflict rather than silently
 * overwriting the first decision.
 *
 * What this deliberately does NOT do:
 *
 * - **No manager scope.** A manager sees nothing of their team's proofs. What
 *   an employee invests in, insures or borrows against is not a line-management
 *   concern, and the only people who need the documents are the ones who have
 *   to check them.
 * - **Nothing is read out of the document.** The claimed amount is whatever the
 *   employee typed; no OCR, no arithmetic, no cross-check against the file. A
 *   reviewer opens it and decides.
 * - **The declared total is not capped here.** Approving proofs beyond the
 *   statutory ceiling for a head is possible; the ceiling is applied by the tax
 *   calculation, which is where it belongs.
 * - **Approval does not recompute anyone's TDS.** The effect appears in the next
 *   payroll run, and only once the tenant has switched verification on and the
 *   cutoff month has arrived.
 */

/** One head's figures in a proof summary. Amounts are fixed-2 strings. */
export interface ProofSummaryRow {
  section: InvestmentProofSection;
  /** What the employee declared for this head, from their tax declaration. */
  declared: string;
  /** What the filed documents claim to support, excluding refused ones. */
  claimed: string;
  /** What a reviewer has actually accepted. */
  approved: string;
  pendingCount: number;
  rejectedCount: number;
}

export interface ProofSummary {
  financialYear: number;
  /**
   * Whether the employer requires proofs at all.
   *
   * Separate from `verificationInForce` because an employee needs to tell three
   * states apart: no requirement, a requirement that has not yet bitten, and
   * one in force. The in-force flag alone collapses the first two into false,
   * and the page must not invent a deadline that does not exist. It cannot read
   * the tenant configuration to find out either, since that endpoint is limited
   * to payroll staff.
   */
  verificationRequired: boolean;
  /** Whether verified amounts are currently replacing declared ones for TDS. */
  verificationInForce: boolean;
  /** The month from which they start to, 1 to 12. */
  cutoffMonth: number;
  rows: ProofSummaryRow[];
}

/** Who is asking for a proof's document. */
export interface ProofFileViewer {
  employeeId?: string;
  /** Payroll staff review other people's documents; nobody else may. */
  isPayrollStaff: boolean;
}

const ZERO = new Decimal(0);

/**
 * The financial year a date falls in. FY 2026-27 is 2026, and it starts in
 * April, so March 2027 is still 2026.
 */
export function currentFinancialYear(now: Date = new Date()): number {
  const month = now.getMonth() + 1;
  return month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Enough of the upload to render a download, loaded with every proof. */
const uploadSelect = {
  id: true,
  key: true,
  fileName: true,
  mimeType: true,
  size: true,
} as const;

/** Enough of the employee to work a review queue without a second round trip. */
const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
} as const;

@Injectable()
export class ProofsService {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Employee
  // -------------------------------------------------------------------------

  /**
   * File a document as evidence for one head.
   *
   * The upload is checked first: it must be in the same tenant and must have
   * been uploaded by the person filing the proof. Without that, a caller who
   * guessed an upload id could attach a colleague's payslip or medical bill to
   * their own proof and then read it back through the download route.
   */
  async submit(
    tenantId: string,
    employeeId: string | undefined,
    userId: string,
    dto: SubmitProofDto,
  ) {
    const filer = this.requireEmployee(employeeId);

    const claimedAmount = new Decimal(dto.claimedAmount);
    if (claimedAmount.lte(ZERO)) {
      throw new BadRequestException(
        'A proof has to claim an amount greater than zero',
      );
    }

    const upload = await this.prisma.upload.findFirst({
      where: { id: dto.uploadId, tenantId },
      select: { id: true, uploadedBy: true },
    });
    if (!upload) {
      // Scoped by tenant, so an id from another tenant reads as "no such
      // upload" rather than confirming that it exists somewhere.
      throw new BadRequestException('No such upload; upload the document first');
    }
    if (upload.uploadedBy !== userId) {
      throw new ForbiddenException(
        'That document was uploaded by somebody else, so it cannot back your proof',
      );
    }

    return this.prisma.investmentProof.create({
      data: {
        tenantId,
        employeeId: filer,
        financialYear: dto.financialYear,
        section: dto.section,
        status: InvestmentProofStatus.PENDING,
        claimedAmount,
        uploadId: dto.uploadId,
        description: dto.description,
      },
      include: { upload: { select: uploadSelect } },
    });
  }

  /** Every proof the caller has filed for one year, newest first. */
  async listMine(
    tenantId: string,
    employeeId: string | undefined,
    financialYear?: number,
  ) {
    const filer = this.requireEmployee(employeeId);

    return this.prisma.investmentProof.findMany({
      where: {
        tenantId,
        employeeId: filer,
        financialYear: financialYear ?? currentFinancialYear(),
      },
      include: { upload: { select: uploadSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Withdraw a proof the employee filed themselves.
   *
   * Only while it is still pending: once payroll has decided, the decision and
   * its reason are part of the record and the employee cannot erase them. A
   * withdrawal deletes the row, because a proof nobody is claiming has nothing
   * left to say — the document itself stays in the upload store.
   */
  async withdraw(tenantId: string, employeeId: string | undefined, id: string) {
    const filer = this.requireEmployee(employeeId);

    const existing = await this.prisma.investmentProof.findFirst({
      where: { id, tenantId, employeeId: filer },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Proof not found');
    if (existing.status !== InvestmentProofStatus.PENDING) {
      throw new ConflictException(
        `This proof has already been ${existing.status.toLowerCase()} and can no longer be withdrawn`,
      );
    }

    try {
      return await this.prisma.investmentProof.delete({
        where: {
          id,
          tenantId,
          employeeId: filer,
          status: InvestmentProofStatus.PENDING,
        },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException(
          'This proof was reviewed while you were withdrawing it; reload to see the decision',
        );
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // The document
  // -------------------------------------------------------------------------

  /**
   * The upload behind a proof, for streaming.
   *
   * An employee reaches only their own; payroll staff reach any in their own
   * tenant, because they cannot review a document they cannot open. The scope
   * is in the `where` clause, so a caller who is not entitled to the proof gets
   * the same answer as one who named an id that does not exist.
   */
  async fileFor(tenantId: string, id: string, viewer: ProofFileViewer) {
    const scope = viewer.isPayrollStaff
      ? { id, tenantId }
      : { id, tenantId, employeeId: this.requireEmployee(viewer.employeeId) };

    const proof = await this.prisma.investmentProof.findFirst({
      where: scope,
      include: { upload: { select: uploadSelect } },
    });
    if (!proof) throw new NotFoundException('Proof not found');

    return proof.upload;
  }

  // -------------------------------------------------------------------------
  // Payroll staff
  // -------------------------------------------------------------------------

  /** The review queue: oldest first, because the oldest has waited longest. */
  async list(tenantId: string, filters: ProofQueueQueryDto) {
    return this.prisma.investmentProof.findMany({
      where: {
        tenantId,
        ...(filters.financialYear !== undefined
          ? { financialYear: filters.financialYear }
          : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      },
      include: {
        upload: { select: uploadSelect },
        employee: { select: employeeSelect },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Accept a proof, in whole or in part.
   *
   * The verified amount may be lower than the claim and often is; it may never
   * be higher. A reviewer who accepts more than the employee claimed is not
   * verifying anything, they are inventing a figure, and the employee would
   * carry the consequence at assessment time.
   */
  async approve(
    tenantId: string,
    reviewerUserId: string,
    id: string,
    dto: ApproveProofDto,
  ) {
    const existing = await this.findPendingForReview(tenantId, id, 'approved');

    const verifiedAmount = new Decimal(dto.verifiedAmount);
    const claimedAmount = new Decimal(existing.claimedAmount as Prisma.Decimal);
    if (verifiedAmount.gt(claimedAmount)) {
      throw new BadRequestException(
        `Cannot verify ${verifiedAmount.toFixed(2)} against a claim of ` +
          `${claimedAmount.toFixed(2)}: a verified amount may be lower than what was ` +
          'claimed, never higher',
      );
    }

    return this.guardedDecision(id, tenantId, {
      status: InvestmentProofStatus.APPROVED,
      verifiedAmount,
      reviewNote: dto.reviewNote ?? null,
      reviewedBy: reviewerUserId,
      reviewedAt: new Date(),
    });
  }

  /**
   * Refuse a proof, with a reason.
   *
   * No verified amount is stored, because nothing was accepted; leaving the
   * field null keeps "refused" distinct from "accepted at zero" for anything
   * reading these records later.
   */
  async reject(
    tenantId: string,
    reviewerUserId: string,
    id: string,
    dto: RejectProofDto,
  ) {
    // Checked before the lookup: a refusal without a reason is not a request
    // worth running a query for.
    const reviewNote = dto.reviewNote?.trim();
    if (!reviewNote) {
      throw new BadRequestException(
        'A rejection needs a reason: the employee has to know what to fix',
      );
    }

    await this.findPendingForReview(tenantId, id, 'rejected');

    return this.guardedDecision(id, tenantId, {
      status: InvestmentProofStatus.REJECTED,
      verifiedAmount: null,
      reviewNote,
      reviewedBy: reviewerUserId,
      reviewedAt: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  /**
   * Declared against claimed against approved, for one employee and year.
   *
   * `claimed` excludes refused proofs. A rejected claim is not a live one, and
   * counting it would leave the employee looking at a total they cannot use;
   * `rejectedCount` says how many were refused, which is the fact that actually
   * needs acting on.
   */
  async summary(
    tenantId: string,
    employeeId: string | undefined,
    financialYear?: number,
  ): Promise<ProofSummary> {
    const subject = this.requireEmployee(employeeId);
    const fy = financialYear ?? currentFinancialYear();

    const [declaration, config, proofs] = await Promise.all([
      this.prisma.employeeTaxDeclaration.findFirst({
        where: { tenantId, employeeId: subject, financialYear: fy },
      }),
      this.prisma.statutoryConfig.findUnique({ where: { tenantId } }),
      this.prisma.investmentProof.findMany({
        where: { tenantId, employeeId: subject, financialYear: fy },
        select: {
          section: true,
          status: true,
          claimedAmount: true,
          verifiedAmount: true,
        },
      }),
    ]);

    const declared = declaration as Record<string, unknown> | null;

    const rows = (
      Object.keys(PROOF_SECTION_TO_DECLARATION_FIELD) as InvestmentProofSection[]
    ).map((section) => {
      const field = PROOF_SECTION_TO_DECLARATION_FIELD[section];
      const forSection = proofs.filter((proof) => proof.section === section);

      let claimed = ZERO;
      let approved = ZERO;
      let pendingCount = 0;
      let rejectedCount = 0;

      for (const proof of forSection) {
        if (proof.status === InvestmentProofStatus.REJECTED) {
          rejectedCount += 1;
          continue;
        }
        if (proof.status === InvestmentProofStatus.PENDING) pendingCount += 1;
        claimed = claimed.plus(new Decimal(proof.claimedAmount as Prisma.Decimal));
        if (proof.verifiedAmount !== null) {
          approved = approved.plus(new Decimal(proof.verifiedAmount as Prisma.Decimal));
        }
      }

      return {
        section,
        declared: this.declaredAmount(declared, field).toFixed(2),
        claimed: claimed.toFixed(2),
        approved: approved.toFixed(2),
        pendingCount,
        rejectedCount,
      };
    });

    const cutoffMonth = config?.proofCutoffMonth ?? 1;

    return {
      financialYear: fy,
      verificationRequired: config?.proofVerificationRequired ?? false,
      verificationInForce: verificationApplies({
        // A tenant with no statutory configuration has not opted in, so
        // declarations stand exactly as they did before proofs existed.
        proofVerificationRequired: config?.proofVerificationRequired ?? false,
        proofCutoffMonth: cutoffMonth,
        payrollMonth: new Date().getMonth() + 1,
      }),
      cutoffMonth,
      rows,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The caller's own employee id, or a refusal.
   *
   * Runs before any query, so an account with no employee record never reaches
   * the database at all.
   */
  private requireEmployee(employeeId: string | undefined): string {
    if (!employeeId) {
      throw new ForbiddenException(
        'Your account is not linked to an employee record',
      );
    }
    return employeeId;
  }

  /** A proof a reviewer may still act on, or the reason they may not. */
  private async findPendingForReview(
    tenantId: string,
    id: string,
    verb: 'approved' | 'rejected',
  ) {
    const existing = await this.prisma.investmentProof.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, claimedAmount: true },
    });
    if (!existing) throw new NotFoundException('Proof not found');
    if (existing.status !== InvestmentProofStatus.PENDING) {
      throw new ConflictException(
        `This proof was already ${existing.status.toLowerCase()} and cannot be ${verb} again`,
      );
    }
    return existing;
  }

  /**
   * Record a decision only if the proof is still pending.
   *
   * The status is part of the `where` clause rather than something checked
   * beforehand, so two reviewers deciding at the same instant cannot both win:
   * the second write matches no row, Prisma raises P2025, and the reviewer is
   * told what happened instead of quietly replacing a colleague's decision.
   */
  private async guardedDecision(
    id: string,
    tenantId: string,
    data: Prisma.InvestmentProofUncheckedUpdateInput,
  ) {
    try {
      return await this.prisma.investmentProof.update({
        where: { id, tenantId, status: InvestmentProofStatus.PENDING },
        data,
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException(
          'Another reviewer decided this proof first; reload to see their decision',
        );
      }
      throw err;
    }
  }

  /** A declaration field's amount, or zero when nothing was declared. */
  private declaredAmount(
    declaration: Record<string, unknown> | null,
    field: string,
  ): Decimal {
    const value = declaration?.[field];
    if (value === undefined || value === null) return ZERO;
    return new Decimal(value as Prisma.Decimal);
  }
}
