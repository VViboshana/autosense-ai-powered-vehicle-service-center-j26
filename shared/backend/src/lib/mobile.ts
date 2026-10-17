/**
 * Sri Lankan mobile numbers in one form, 0XXXXXXXXX, so "+94 77 123 4501", "94771234501" and "077-123-4501" all
 * match the same account. Returns null when it isn't a valid 10-digit number.
 */
export function normalizeMobile(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+94')) digits = '0' + digits.slice(3);
  else if (/^94\d{9}$/.test(digits)) digits = '0' + digits.slice(2);
  return /^0\d{9}$/.test(digits) ? digits : null;
}
