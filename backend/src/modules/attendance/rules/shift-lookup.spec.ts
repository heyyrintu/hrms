import { coveringAssignmentWhere, effectiveShift } from './shift-lookup';

describe('shift lookup rule', () => {
  const day = new Date('2026-03-16T00:00:00Z');

  it('only counts active assignments that cover the day', () => {
    expect(coveringAssignmentWhere('t-1', day)).toEqual({
      tenantId: 't-1',
      isActive: true,
      startDate: { lte: day },
      OR: [{ endDate: null }, { endDate: { gte: day } }],
    });
  });

  it('ignores an assignment whose shift has been deactivated', () => {
    const shift = { startTime: '22:00', endTime: '06:00', isActive: false };
    expect(effectiveShift({ shift })).toBeNull();
    expect(effectiveShift({ shift: { ...shift, isActive: true } })).toEqual({
      ...shift,
      isActive: true,
    });
    expect(effectiveShift(null)).toBeNull();
  });
});
