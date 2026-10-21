import { describe, expect, it } from 'vitest';
import { vehicleYearBody } from './maintenance.routes.js';

describe('vehicle year update validation', () => {
  it('accepts a verified vehicle year', () => {
    expect(vehicleYearBody.parse({ year: '2015' })).toEqual({ year: 2015 });
  });

  it('rejects missing or implausible years', () => {
    expect(vehicleYearBody.safeParse({ year: 1949 }).success).toBe(false);
    expect(vehicleYearBody.safeParse({ year: new Date().getFullYear() + 2 }).success).toBe(false);
  });
});
