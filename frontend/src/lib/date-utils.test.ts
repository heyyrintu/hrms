import {
  formatMinutesToHoursMinutes,
  formatDate,
  formatDateShort,
  formatTime,
  formatDateForApi,
  getStartOfMonth,
  getEndOfMonth,
  getToday,
  formatDateRange,
  getRelativeTime,
  getMonthYear,
  getDaysInMonth,
  getMonthDates,
  isSameDay,
  isToday,
  isPast,
  isFuture,
  daysBetween,
} from './date-utils';

describe('formatMinutesToHoursMinutes', () => {
  it('returns 0m for zero', () => {
    expect(formatMinutesToHoursMinutes(0)).toBe('0m');
  });

  it('returns minutes only when under 60', () => {
    expect(formatMinutesToHoursMinutes(45)).toBe('45m');
  });

  it('returns hours only when exact', () => {
    expect(formatMinutesToHoursMinutes(120)).toBe('2h');
  });

  it('returns hours and minutes', () => {
    expect(formatMinutesToHoursMinutes(90)).toBe('1h 30m');
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2025-03-15');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });
});

describe('formatDateShort', () => {
  it('formats date without year', () => {
    const result = formatDateShort('2025-03-15');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
  });
});

describe('formatTime', () => {
  it('formats time string', () => {
    const result = formatTime('2025-03-15T14:30:00');
    expect(result).toBeTruthy();
  });
});

describe('formatDateForApi', () => {
  it('returns YYYY-MM-DD format', () => {
    // Use UTC noon to avoid timezone shift issues
    const date = new Date('2025-03-15T12:00:00Z');
    expect(formatDateForApi(date)).toBe('2025-03-15');
  });
});

describe('getStartOfMonth', () => {
  it('returns first day of month', () => {
    const date = new Date(2025, 5, 15);
    const result = getStartOfMonth(date);
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(5);
    expect(result.getFullYear()).toBe(2025);
  });

  it('defaults to current month', () => {
    const result = getStartOfMonth();
    expect(result.getDate()).toBe(1);
  });
});

describe('getEndOfMonth', () => {
  it('returns last day of month', () => {
    const date = new Date(2025, 1, 15); // February
    const result = getEndOfMonth(date);
    expect(result.getDate()).toBe(28);
    expect(result.getMonth()).toBe(1);
  });

  it('handles months with 31 days', () => {
    const date = new Date(2025, 0, 15); // January
    const result = getEndOfMonth(date);
    expect(result.getDate()).toBe(31);
  });
});

describe('getToday', () => {
  it('returns today at midnight', () => {
    const today = getToday();
    expect(today.getHours()).toBe(0);
    expect(today.getMinutes()).toBe(0);
    expect(today.getSeconds()).toBe(0);
    expect(today.getMilliseconds()).toBe(0);
  });
});

describe('formatDateRange', () => {
  it('formats same-month range', () => {
    const result = formatDateRange('2025-03-01', '2025-03-15');
    expect(result).toContain('Mar');
    expect(result).toContain('1');
    expect(result).toContain('15');
  });

  it('formats cross-month range', () => {
    const result = formatDateRange('2025-03-28', '2025-04-05');
    expect(result).toContain('Mar');
    expect(result).toContain('Apr');
  });
});

describe('getRelativeTime', () => {
  it('returns "Just now" for recent time', () => {
    const now = new Date().toISOString();
    expect(getRelativeTime(now)).toBe('Just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(getRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(getRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(getRelativeTime(threeDaysAgo)).toBe('3d ago');
  });
});

describe('getMonthYear', () => {
  it('returns month and year string', () => {
    const result = getMonthYear(new Date(2025, 11, 1));
    expect(result).toContain('December');
    expect(result).toContain('2025');
  });
});

describe('getDaysInMonth', () => {
  it('returns 31 for January', () => {
    expect(getDaysInMonth(new Date(2025, 0, 1))).toBe(31);
  });

  it('returns 28 for February (non-leap year)', () => {
    expect(getDaysInMonth(new Date(2025, 1, 1))).toBe(28);
  });

  it('returns 29 for February (leap year)', () => {
    expect(getDaysInMonth(new Date(2024, 1, 1))).toBe(29);
  });

  it('returns 30 for April', () => {
    expect(getDaysInMonth(new Date(2025, 3, 1))).toBe(30);
  });
});

describe('getMonthDates', () => {
  it('returns array of dates for the month', () => {
    const dates = getMonthDates(new Date(2025, 0, 1)); // January
    expect(dates).toHaveLength(31);
    expect(dates[0].getDate()).toBe(1);
    expect(dates[30].getDate()).toBe(31);
  });
});

describe('isSameDay', () => {
  it('returns true for same day', () => {
    const d1 = new Date(2025, 5, 15, 10, 30);
    const d2 = new Date(2025, 5, 15, 20, 0);
    expect(isSameDay(d1, d2)).toBe(true);
  });

  it('returns false for different days', () => {
    const d1 = new Date(2025, 5, 15);
    const d2 = new Date(2025, 5, 16);
    expect(isSameDay(d1, d2)).toBe(false);
  });
});

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });
});

describe('isPast', () => {
  it('returns true for past date', () => {
    const past = new Date(2020, 0, 1);
    expect(isPast(past)).toBe(true);
  });

  it('returns false for future date', () => {
    const future = new Date(2099, 0, 1);
    expect(isPast(future)).toBe(false);
  });
});

describe('isFuture', () => {
  it('returns true for future date', () => {
    const future = new Date(2099, 0, 1);
    expect(isFuture(future)).toBe(true);
  });

  it('returns false for past date', () => {
    const past = new Date(2020, 0, 1);
    expect(isFuture(past)).toBe(false);
  });
});

describe('daysBetween', () => {
  it('returns 1 for same day', () => {
    expect(daysBetween('2025-03-15', '2025-03-15')).toBe(1);
  });

  it('returns correct number of days', () => {
    expect(daysBetween('2025-03-10', '2025-03-15')).toBe(6);
  });

  it('works regardless of order', () => {
    expect(daysBetween('2025-03-15', '2025-03-10')).toBe(6);
  });
});
