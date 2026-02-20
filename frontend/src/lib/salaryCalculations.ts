import { SalaryComponent, SalaryBreakdown } from '@/types';

/**
 * Calculates salary breakdown from base pay and components
 * @param basePay - Monthly base pay amount
 * @param components - Array of salary components from structure
 * @returns Breakdown with earnings, deductions, gross, net
 */
export function calculateSalaryBreakdown(
  basePay: number,
  components: SalaryComponent[]
): SalaryBreakdown {
  const earnings: Array<{ name: string; amount: number }> = [
    { name: 'Base Pay', amount: basePay },
  ];

  const deductions: Array<{ name: string; amount: number }> = [];

  components.forEach((comp) => {
    const amount =
      comp.calcType === 'fixed'
        ? comp.value
        : Math.round((basePay * comp.value) / 100);

    if (comp.type === 'earning') {
      earnings.push({ name: comp.name, amount });
    } else {
      deductions.push({ name: comp.name, amount });
    }
  });

  const grossPay = earnings.reduce((sum, e) => sum + e.amount, 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netPay = grossPay - totalDeductions;

  return { basePay, earnings, deductions, grossPay, totalDeductions, netPay };
}

/**
 * Formats a number as Indian Rupee currency
 * @param amount - Amount to format
 * @returns Formatted currency string (e.g., "₹1,00,000")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats a date string in Indian locale
 * @param dateStr - ISO date string
 * @returns Formatted date (e.g., "15 Jan, 2026")
 */
export function formatSalaryDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calculates annual CTC from monthly breakdown
 * @param breakdown - Monthly salary breakdown
 * @returns Annual CTC
 */
export function calculateAnnualCTC(breakdown: SalaryBreakdown): number {
  return breakdown.grossPay * 12;
}
