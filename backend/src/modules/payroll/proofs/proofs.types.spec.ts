import {
  PROOF_SECTION_TO_DECLARATION_FIELD,
  positionInFinancialYear,
  verificationApplies,
} from './proofs.types';

describe('positionInFinancialYear', () => {
  it('orders the months from April, not from January', () => {
    expect(positionInFinancialYear(4)).toBe(1);
    expect(positionInFinancialYear(12)).toBe(9);
    // January is the tenth month of the financial year, not the first. Getting
    // this wrong would put the proof cutoff nine months early.
    expect(positionInFinancialYear(1)).toBe(10);
    expect(positionInFinancialYear(3)).toBe(12);
  });
});

describe('verificationApplies', () => {
  const cutoffJanuary = { proofCutoffMonth: 1 };

  it('leaves an installation that has not opted in exactly as it was', () => {
    // The whole safety of this feature rests here. Every existing tenant has
    // this off, and every one of them must keep deducting what it deducted
    // yesterday.
    expect(
      verificationApplies({
        proofVerificationRequired: false,
        ...cutoffJanuary,
        payrollMonth: 3,
      }),
    ).toBe(false);
  });

  it('leaves declarations standing before the cutoff', () => {
    // Employers take declarations through the year and call proofs in near its
    // end. Demanding evidence in April would be wrong, not strict.
    expect(
      verificationApplies({
        proofVerificationRequired: true,
        ...cutoffJanuary,
        payrollMonth: 4,
      }),
    ).toBe(false);
    expect(
      verificationApplies({
        proofVerificationRequired: true,
        ...cutoffJanuary,
        payrollMonth: 12,
      }),
    ).toBe(false);
  });

  it('uses verified amounts from the cutoff month to the end of the year', () => {
    for (const payrollMonth of [1, 2, 3]) {
      expect(
        verificationApplies({
          proofVerificationRequired: true,
          ...cutoffJanuary,
          payrollMonth,
        }),
      ).toBe(true);
    }
  });

  it('honours a cutoff set later in the year', () => {
    expect(
      verificationApplies({
        proofVerificationRequired: true,
        proofCutoffMonth: 2,
        payrollMonth: 1,
      }),
    ).toBe(false);
    expect(
      verificationApplies({
        proofVerificationRequired: true,
        proofCutoffMonth: 2,
        payrollMonth: 3,
      }),
    ).toBe(true);
  });
});

describe('PROOF_SECTION_TO_DECLARATION_FIELD', () => {
  it('maps every head to the declaration field it supports', () => {
    expect(PROOF_SECTION_TO_DECLARATION_FIELD.SECTION_80C).toBe('section80C');
    expect(PROOF_SECTION_TO_DECLARATION_FIELD.HRA).toBe('hraExemption');
    expect(PROOF_SECTION_TO_DECLARATION_FIELD.PREVIOUS_EMPLOYER_TDS).toBe(
      'previousEmployerTds',
    );
  });

  it('has no head for the employer NPS contribution or for declared income', () => {
    // 80CCD(2) is the employer's own contribution, which it already knows, and
    // declared income raises tax rather than reducing it. Neither is something
    // an employee should be asked to evidence.
    const fields = Object.values(PROOF_SECTION_TO_DECLARATION_FIELD);
    expect(fields).not.toContain('section80CCD2');
    expect(fields).not.toContain('otherIncome');
  });
});
