import { describe, expect, it } from 'vitest';
import { actionProblem, formatAlertNo, NOTIFICATION_MATRIX, SEVERITIES } from './security.rules.js';

describe('security rules', () => {
  it('numbers alerts by year (Sri Lanka time) and id', () => {
    expect(formatAlertNo(123, new Date('2026-10-18T10:00:00Z'))).toBe('SEC-26-000123');
    // 31 Dec 20:00 UTC is already 1 Jan in Colombo (UTC+5:30)
    expect(formatAlertNo(7, new Date('2026-12-31T20:00:00Z'))).toBe('SEC-27-000007');
  });

  it('acknowledges only open alerts, and changes nothing once resolved', () => {
    const open = { status: 'open', severity: 'medium', hasVehicle: false } as const;
    expect(actionProblem('acknowledge', open)).toBeNull();
    expect(actionProblem('acknowledge', { ...open, status: 'acknowledged' })).toMatch(/already acknowledged/);
    expect(actionProblem('resolve', { ...open, status: 'acknowledged' })).toBeNull();
    for (const action of ['acknowledge', 'resolve', 'note'] as const) {
      expect(actionProblem(action, { ...open, status: 'resolved' })).toMatch(/already resolved/);
    }
  });

  it('calls emergency services only for high and critical alerts', () => {
    const alert = { status: 'open', hasVehicle: false } as const;
    expect(actionProblem('emergency_called', { ...alert, severity: 'medium' })).not.toBeNull();
    expect(actionProblem('emergency_called', { ...alert, severity: 'high' })).toBeNull();
    expect(actionProblem('emergency_called', { ...alert, severity: 'critical' })).toBeNull();
  });

  it('informs an owner only when a customer vehicle is affected', () => {
    const alert = { status: 'acknowledged', severity: 'high' } as const;
    expect(actionProblem('owner_informed', { ...alert, hasVehicle: false })).not.toBeNull();
    expect(actionProblem('owner_informed', { ...alert, hasVehicle: true })).toBeNull();
  });

  it('has one notification row per severity, and tells more people as severity rises', () => {
    expect(NOTIFICATION_MATRIX.map((r) => r.severity)).toEqual([...SEVERITIES]);
    for (let i = 1; i < NOTIFICATION_MATRIX.length; i++) {
      expect(NOTIFICATION_MATRIX[i]!.notify).toEqual(expect.arrayContaining(NOTIFICATION_MATRIX[i - 1]!.notify));
    }
    expect(NOTIFICATION_MATRIX.at(-1)!.notify).toContain('emergency_services');
  });
});
