import { describe, expect, it, vi } from 'vitest';
import { listBookingsAwaitingForecast, listJobsAwaitingForecast, vehicleBootstrap } from './maintenance.repository.js';

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

describe('the service flow: inspected vehicles awaiting a maintenance forecast', () => {
  it('lists jobs whose damage inspection is confirmed and that have no forecast yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listJobsAwaitingForecast({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("j.stage = 'inspected'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM maintenance.forecasts f WHERE f.job_id = j.job_id)');
    expect(sql).toContain("WHERE job_id = j.job_id AND status = 'confirmed'");
  });

  it('returns the visit with its own inspection', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      job_id: 9, job_no: 'JOB-26-000120', vehicle_id: 37, registration_no: 'WP CAD-4512', make: 'Nissan', model: 'Patrol',
      customer_name: 'Manodya Edirisinghe', service: 'Body repair', bay: 'Bay 8', inspection_id: 40, inspection_no: 'INS-26-000040',
      overall_severity: 'severe', reviewed_at: '2026-10-22T05:00:00Z',
    }] });
    const [job] = await listJobsAwaitingForecast({ query } as never);
    expect(job).toMatchObject({ jobId: 9, jobNo: 'JOB-26-000120', vehicleId: 37, bay: 'Bay 8', inspectionId: 40, inspectionNo: 'INS-26-000040', severity: 'severe' });
  });

  it('bookings awaiting a preliminary forecast are only those not yet past', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listBookingsAwaitingForecast({ query } as never);
    expect(String(query.mock.calls[0]?.[0])).toContain('b.booking_date >= current_date');
  });
});

describe('the forecast wizard context for a visit', () => {
  it('refuses a job of another vehicle', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(vehicleBootstrap({ query } as never, 37, undefined, 99)).rejects.toThrow('That job is not for this vehicle.');
  });

  it("puts this job's inspection first and uses the job's booking", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ job_id: 9, job_no: 'JOB-26-000120', stage: 'inspected', service: 'Body repair', booking_id: 6 }] })
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 37, registration_no: 'WP CAD-4512', make: 'Nissan', model: 'Patrol', year: 2018, odometer_km: 86500, customer_id: 1012, customer_name: 'M' }] })
      .mockResolvedValue({ rows: [] });
    const result = await vehicleBootstrap({ query } as never, 37, undefined, 9);
    expect(result.job).toEqual({ jobId: 9, jobNo: 'JOB-26-000120', stage: 'inspected', service: 'Body repair', bookingId: 6 });
    const bookingCall = query.mock.calls[2]!;
    expect(bookingCall[1]).toEqual([37, 6, true]);
    const inspectionCall = query.mock.calls[4]!;
    expect(String(inspectionCall[0])).toContain('ORDER BY (i.job_id IS NOT DISTINCT FROM $2::int) DESC');
    expect(inspectionCall[1]).toEqual([37, 9]);
  });
});
