import { cn, formatDate, formatDateTime, formatTime, formatMinutesToHours, getStatusColor, getInitials } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('handles undefined', () => {
    expect(cn('foo', undefined)).toBe('foo');
  });
});

describe('formatDate', () => {
  it('formats date string', () => {
    const result = formatDate('2025-06-15T00:00:00.000Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });

  it('formats Date object', () => {
    const result = formatDate(new Date(2025, 0, 1));
    expect(result).toContain('Jan');
    expect(result).toContain('2025');
  });
});

describe('formatDateTime', () => {
  it('formats date and time', () => {
    const result = formatDateTime('2025-06-15T14:30:00.000Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });
});

describe('formatTime', () => {
  it('formats time from date', () => {
    const result = formatTime('2025-06-15T14:30:00.000Z');
    expect(result).toBeTruthy();
  });
});

describe('formatMinutesToHours', () => {
  it('returns minutes only when less than 60', () => {
    expect(formatMinutesToHours(45)).toBe('45m');
  });

  it('returns hours only when exact hours', () => {
    expect(formatMinutesToHours(120)).toBe('2h');
  });

  it('returns hours and minutes', () => {
    expect(formatMinutesToHours(150)).toBe('2h 30m');
  });

  it('handles zero minutes', () => {
    expect(formatMinutesToHours(0)).toBe('0m');
  });
});

describe('getStatusColor', () => {
  it('returns success for PRESENT', () => {
    expect(getStatusColor('PRESENT')).toBe('badge-success');
  });

  it('returns danger for ABSENT', () => {
    expect(getStatusColor('ABSENT')).toBe('badge-danger');
  });

  it('returns warning for PENDING', () => {
    expect(getStatusColor('PENDING')).toBe('badge-warning');
  });

  it('returns success for APPROVED', () => {
    expect(getStatusColor('APPROVED')).toBe('badge-success');
  });

  it('returns gray for unknown status', () => {
    expect(getStatusColor('UNKNOWN')).toBe('badge-gray');
  });
});

describe('getInitials', () => {
  it('returns initials from names', () => {
    expect(getInitials('John', 'Doe')).toBe('JD');
  });

  it('returns uppercase initials', () => {
    expect(getInitials('john', 'doe')).toBe('JD');
  });
});
