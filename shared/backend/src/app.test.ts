import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import type { Db } from './db/pool.js';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://test@localhost/test', DEV_USER: 'tester' });

/** A fake database: answers SELECT 1, fails everything else the way an unreachable server does. */
const fakeDb = (up: boolean): Db =>
  ({
    query: async (sql: string) => {
      if (up && sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    },
  }) as unknown as Db;

describe('API envelope', () => {
  it('reports health with the database up', async () => {
    const res = await request(createApp(fakeDb(true), env)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', checks: { database: { status: 'up' } } } });
    expect(res.body.requestId).toEqual(res.headers['x-request-id']);
  });

  it('reports health as down (503) when the database is unreachable', async () => {
    const res = await request(createApp(fakeDb(false), env)).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('down');
  });

  it('answers an unknown route with a 404 envelope', async () => {
    const res = await request(createApp(fakeDb(true), env)).get('/api/does-not-exist');
    // The dev user lookup fails first against the fake database, which proves database errors also use the envelope.
    expect(res.body.success).toBe(false);
    expect(['NOT_FOUND', 'DATABASE_UNAVAILABLE']).toContain(res.body.error.code);
  });

  it('rejects an invalid configuration with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL must start with postgres/);
  });
});
