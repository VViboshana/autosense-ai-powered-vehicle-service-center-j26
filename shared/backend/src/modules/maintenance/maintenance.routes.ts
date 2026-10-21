import { Router } from 'express';
import type { Env } from '../../config/env.js';
import { sendOk } from '../../http/envelope.js';
import { maintenanceDuration, maintenanceHealth, maintenanceModel, maintenanceTasks, predictMaintenance } from '../../integrations/ml/maintenanceService.js';
import { requireScreen } from '../../middleware/requireScreen.js';
import { parse } from '../../http/validate.js';
import { signedInUser } from '../../middleware/requireScreen.js';
import { z } from 'zod';
import type pg from 'pg';
import { getForecast, listBookingsAwaitingForecast, listForecasts, searchVehicles, vehicleBootstrap } from './maintenance.repository.js';
import { NotFoundError, ValidationError } from '../../http/errors.js';
import { audit } from '../../lib/audit.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const searchQuery = z.object({ search: z.string().trim().min(1).max(60) });
const bootstrapQuery = z.object({ vehicleId: z.coerce.number().int().positive(), bookingId: z.coerce.number().int().positive().optional() });
export const vehicleYearBody = z.object({ year: z.coerce.number().int().min(1950, 'Enter a year from 1950.').max(new Date().getFullYear() + 1, 'That year is in the future.') });

export function maintenanceRoutes(pool: pg.Pool, env: Env) {
  const router = Router();
  router.use(requireScreen('MAINTENANCE_FORECASTS'));

  router.get('/health', async (_req, res) => {
    const health = await maintenanceHealth(env.MAINTENANCE_ML_SERVICE_URL);
    sendOk(res, { status: health.status, mlService: health }, health.status === 'ok' && health.modelsLoaded ? 200 : 503);
  });

  router.get('/model', async (_req, res) => sendOk(res, await maintenanceModel(env.MAINTENANCE_ML_SERVICE_URL)));
  router.get('/vehicles/search', async (req, res) => sendOk(res, await searchVehicles(pool, parse(searchQuery, req.query).search)));
  router.get('/vehicles/bootstrap', async (req, res) => { const q = parse(bootstrapQuery, req.query); sendOk(res, await vehicleBootstrap(pool, q.vehicleId, q.bookingId)); });
  router.get('/bookings/awaiting-forecast', async (_req, res) => sendOk(res, await listBookingsAwaitingForecast(pool)));
  router.patch('/vehicles/:id', async (req, res) => {
    const user = signedInUser(req);
    const id = parse(idParam, req.params).id;
    const body = parse(vehicleYearBody, req.body);
    const { rows } = await pool.query('UPDATE workshop.vehicles SET year = $2 WHERE vehicle_id = $1 RETURNING vehicle_id, year', [id, body.year]);
    if (!rows[0]) throw new NotFoundError('Vehicle not found.');
    await audit(pool, { table: 'workshop.vehicles', recordId: id, action: 'year updated', userId: user.userId, snapshot: { year: body.year } });
    sendOk(res, { vehicleId: rows[0].vehicle_id, year: rows[0].year });
  });
  router.get('/forecasts', async (_req, res) => sendOk(res, await listForecasts(pool)));
  router.get('/forecasts/:id', async (req, res) => { const row = await getForecast(pool, parse(idParam, req.params).id); sendOk(res, row); });
  router.post('/forecasts', async (req, res) => {
    const user = signedInUser(req);
    const result = await predictMaintenance(env.MAINTENANCE_ML_SERVICE_URL, req.body);
    const vehicleId = Number(req.body?.vehicleId);
    if (!Number.isInteger(vehicleId) || vehicleId < 1) return sendOk(res, result, 201);
    const { rows } = await pool.query(`SELECT vehicle_id, customer_id FROM workshop.vehicles WHERE vehicle_id = $1`, [vehicleId]);
    if (!rows[0]) return sendOk(res, result, 201);
    if (req.body.bookingId) {
      const booking = await pool.query('SELECT 1 FROM workshop.bookings WHERE booking_id = $1 AND vehicle_id = $2', [req.body.bookingId, vehicleId]);
      if (!booking.rows[0]) throw new ValidationError('The booking does not belong to the selected vehicle.');
    }
    if (req.body.inspectionId) {
      const inspection = await pool.query('SELECT 1 FROM damage.inspections WHERE inspection_id = $1 AND vehicle_id = $2', [req.body.inspectionId, vehicleId]);
      if (!inspection.rows[0]) throw new ValidationError('The inspection does not belong to the selected vehicle.');
    }
    const inserted = await pool.query(`INSERT INTO maintenance.forecasts (vehicle_id, customer_id, booking_id, inspection_id, created_by, predicted_category, model_score, category_scores, problem_description, severity, service_history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING forecast_id`, [vehicleId, rows[0].customer_id, req.body.bookingId ?? null, req.body.inspectionId ?? null, user.userId, result.maintenanceCategory.predicted, result.maintenanceCategory.modelScore, JSON.stringify(result.maintenanceCategory.scores), req.body.customerReport.problemDescription, req.body.customerReport.severity, JSON.stringify(req.body.serviceHistory ?? {})]);
    sendOk(res, { ...result, forecastId: inserted.rows[0].forecast_id }, 201);
  });
  router.get('/tasks/:category', async (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 8 : Number(rawLimit);
    sendOk(res, await maintenanceTasks(env.MAINTENANCE_ML_SERVICE_URL, req.params.category, limit));
  });
  router.post('/duration', async (req, res) => sendOk(res, await maintenanceDuration(env.MAINTENANCE_ML_SERVICE_URL, req.body)));
  router.post('/forecasts/:id/confirm', async (req, res) => {
    const user = signedInUser(req); const id = parse(idParam, req.params).id;
    const body = z.object({ fixTitle: z.string().trim().min(1).max(300), estimatedHours: z.number().nonnegative(), estimatedMinutes: z.number().int().nonnegative(), durationVariant: z.string().max(80), benchmark: z.boolean(), targetType: z.string().max(100), note: z.string().trim().max(2000).optional() }).parse(req.body);
    const { rows } = await pool.query(`UPDATE maintenance.forecasts SET selected_fix_title=$2, estimated_hours=$3, estimated_minutes=$4, duration_variant=$5, duration_benchmark=$6, duration_target_type=$7, technician_note=$8, status='confirmed', confirmed_at=now(), confirmed_by=$9 WHERE forecast_id=$1 RETURNING forecast_id`, [id, body.fixTitle, body.estimatedHours, body.estimatedMinutes, body.durationVariant, body.benchmark, body.targetType, body.note ?? null, user.userId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Forecast not found.' } });
    sendOk(res, { forecastId: id, status: 'confirmed' });
  });
  return router;
}
