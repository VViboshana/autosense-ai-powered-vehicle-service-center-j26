import type pg from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://test@localhost/test' });

/** A fake database: answers SELECT 1, fails everything else the way an unreachable server does. */
const fakePool = (up: boolean) =>
  ({
    query: async (sql: string) => {
      if (up && sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    },
  }) as unknown as pg.Pool;

describe('API envelope and protection', () => {
  it('reports health with the database up', async () => {
    const res = await request(createApp(fakePool(true), env)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', checks: { database: { status: 'up' } } } });
    expect(res.body.requestId).toEqual(res.headers['x-request-id']);
  });

  it('reports health as down (503) when the database is unreachable', async () => {
    const res = await request(createApp(fakePool(false), env)).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('down');
  });

  it('answers an unknown route with a 404 envelope', async () => {
    const res = await request(createApp(fakePool(true), env)).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('asks for sign-in on protected routes when there is no session', async () => {
    const res = await request(createApp(fakePool(true), env)).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses changes posted from another website', async () => {
    const res = await request(createApp(fakePool(true), env))
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'admin', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('rejects an invalid configuration with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL must start with postgres/);
  });
});
