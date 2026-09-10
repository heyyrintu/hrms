/**
 * Investment proofs: the evidence behind a declared deduction, and its review.
 *
 * Money arrives as a **string**, because the backend holds it as a Prisma
 * `Decimal` and a rupee figure that has been through a JavaScript float is no
 * longer the figure that was stored. Payloads take numbers, which is what the
 * DTO validates, so the conversion happens only on the way out.
 */

export enum InvestmentProofStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * The heads a proof can be filed under.
 *
 * Only deductions that evidence can support. Section 80CCD(2) is the employer's
 * own contribution and the employer already knows it. Declared other income
 * increases tax rather than reducing it, and nobody needs evidence to be taxed
 * more. Neither appears here, and that is deliberate.
 */
export enum InvestmentProofSection {
  SECTION_80C = 'SECTION_80C',
  SECTION_80D = 'SECTION_80D',
  SECTION_80CCD1B = 'SECTION_80CCD1B',
  HRA = 'HRA',
  HOME_LOAN_INTEREST = 'HOME_LOAN_INTEREST',
  OTHER_DEDUCTIONS = 'OTHER_DEDUCTIONS',
  PREVIOUS_EMPLOYER_TDS = 'PREVIOUS_EMPLOYER_TDS',
}

/** What each head is called in front of a person. */
export const PROOF_SECTION_LABELS: Record<InvestmentProofSection, string> = {
  [InvestmentProofSection.SECTION_80C]: 'Section 80C',
  [InvestmentProofSection.SECTION_80D]: 'Section 80D, health insurance',
  [InvestmentProofSection.SECTION_80CCD1B]: 'Section 80CCD(1B), NPS',
  [InvestmentProofSection.HRA]: 'House rent allowance',
  [InvestmentProofSection.HOME_LOAN_INTEREST]: 'Home loan interest',
  [InvestmentProofSection.OTHER_DEDUCTIONS]: 'Other deductions',
  [InvestmentProofSection.PREVIOUS_EMPLOYER_TDS]: 'Tax deducted by a previous employer',
};

/** The declaration field each head supports, for showing claimed against declared. */
export const PROOF_SECTION_TO_DECLARATION_FIELD: Record<InvestmentProofSection, string> = {
  [InvestmentProofSection.SECTION_80C]: 'section80C',
  [InvestmentProofSection.SECTION_80D]: 'section80D',
  [InvestmentProofSection.SECTION_80CCD1B]: 'section80CCD1B',
  [InvestmentProofSection.HRA]: 'hraExemption',
  [InvestmentProofSection.HOME_LOAN_INTEREST]: 'homeLoanInterest',
  [InvestmentProofSection.OTHER_DEDUCTIONS]: 'otherDeductions',
  [InvestmentProofSection.PREVIOUS_EMPLOYER_TDS]: 'previousEmployerTds',
};

export interface ProofUpload {
  id: string;
  fileName: string;
  mimeType: string;
  /** Bytes. */
  size: number;
}

export interface InvestmentProof {
  id: string;
  tenantId: string;
  employeeId: string;
  /** FY 2026-27 is 2026. */
  financialYear: number;
  section: InvestmentProofSection;
  status: InvestmentProofStatus;

  /** What the employee says the document supports. */
  claimedAmount: string;
  /**
   * What the reviewer accepted, which may be less than claimed. Null until a
   * decision is recorded, and null on a rejection.
   */
  verifiedAmount: string | null;

  uploadId: string;
  description: string | null;

  reviewedBy: string | null;
  reviewedAt: string | null;
  /**
   * Why it was refused, or a note on a partial approval. An employee whose
   * evidence is refused is owed a reason, so never render a rejection without
   * this.
   */
  reviewNote: string | null;

  createdAt: string;
  updatedAt: string;

  upload?: ProofUpload;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department?: { name: string } | null;
  };
  reviewer?: { id: string; firstName: string; lastName: string } | null;
}

export interface SubmitProofPayload {
  financialYear: number;
  section: InvestmentProofSection;
  claimedAmount: number;
  uploadId: string;
  description?: string;
}

export interface ReviewProofPayload {
  /**
   * The amount accepted. Required on approval, and may be lower than claimed.
   * Omitted on rejection, where nothing is accepted.
   */
  verifiedAmount?: number;
  /** Required when refusing. */
  reviewNote?: string;
}

/**
 * What an employee has claimed and had accepted, per head, for one year.
 *
 * `declared` is what their tax declaration says; `approved` is the sum of their
 * approved proofs. The gap between them is the point of the whole workflow, so
 * show both rather than one.
 */
export interface ProofSummaryRow {
  section: InvestmentProofSection;
  declared: string;
  claimed: string;
  approved: string;
  pendingCount: number;
  rejectedCount: number;
}

export interface ProofSummary {
  financialYear: number;
  /**
   * Whether the employer requires proofs at all.
   *
   * Distinct from `verificationInForce`, which is false both when no
   * requirement exists and when one exists but the cutoff has not arrived.
   * Those are different messages to an employee, and conflating them invents a
   * deadline that does not exist. The tenant configuration cannot be read to
   * tell them apart, because that endpoint is limited to payroll staff.
   */
  verificationRequired: boolean;
  /** Whether verified amounts are in force for this tenant and month. */
  verificationInForce: boolean;
  /** The month from which they take over, 1 to 12. */
  cutoffMonth: number;
  rows: ProofSummaryRow[];
}
