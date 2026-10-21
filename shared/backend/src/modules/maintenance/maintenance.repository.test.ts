import { describe, expect, it, vi } from 'vitest';
import { listBookingsAwaitingForecast } from './maintenance.repository.js';

describe('bookings awaiting a maintenance forecast', () => {
  it('returns canonical booking, vehicle, customer and service context', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      booking_id: 4, booking_no: 'BK-26-000004', vehicle_id: 35, registration_no: 'CAH-3463', make: 'Suzuki', model: 'WaganR',
      customer_name: 'Kaveesha Munasinghe', service: 'Full service', booking_date: '2026-10-22', slot_time: '13:30', status: 'pending', customer_notes: null,
    }] });
    const result = await listBookingsAwaitingForecast({ query } as never);
    expect(result).toEqual([{ bookingId: 4, bookingNo: 'BK-26-000004', vehicleId: 35, registrationNo: 'CAH-3463', make: 'Suzuki', model: 'WaganR', customer: 'Kaveesha Munasinghe', service: 'Full service', date: '2026-10-22', time: '13:30', status: 'pending', notes: null }]);
  });

  it('filters cancelled bookings and bookings with any linked forecast in SQL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listBookingsAwaitingForecast({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("b.status IN ('pending', 'confirmed')");
    expect(sql).toContain('LEFT JOIN maintenance.forecasts f ON f.booking_id = b.booking_id');
    expect(sql).toContain('f.forecast_id IS NULL');
  });
});
