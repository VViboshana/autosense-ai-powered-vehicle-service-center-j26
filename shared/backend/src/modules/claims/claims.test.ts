import { describe, expect, it } from 'vitest';
import { approveBody } from './claims.routes.js';

describe('approving a vehicle request', () => {
  it('needs no vehicle details when the plate is already on record', () => {
    expect(approveBody.parse({ note: '' })).toEqual({ note: null });
  });

  it('accepts the details of a vehicle that is not on record yet; empty optional fields are left out', () => {
    const body = approveBody.parse({ vehicle: { make: ' Toyota ', model: 'Aqua', year: '2015', colour: '', fuelType: '' } });
    expect(body.vehicle).toEqual({ make: 'Toyota', model: 'Aqua', year: 2015, colour: null, fuelType: undefined });
  });

  it('requires make and model, and a sensible year and fuel', () => {
    const result = approveBody.safeParse({ vehicle: { make: '', model: ' ', year: '1890', fuelType: 'coal' } });
    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((i) => i.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['vehicle.make', 'vehicle.model', 'vehicle.year', 'vehicle.fuelType']));
  });
});
