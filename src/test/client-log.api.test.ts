import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
// @ts-ignore - server.js doesn't have TypeScript declarations
import app, { apiHistoryDb, pruneClientLog } from '../../server.js';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'device-1',
    loadId: 'load-1',
    build: '1.5.0',
    userAgent: 'TestAgent/1.0',
    entries: [
      { seq: 0, at: 1_700_000_000_000, timestamp: '2026-06-10T10:00:00.000Z', message: 'hello' },
    ],
    ...overrides,
  };
}

function clearClientLog() {
  apiHistoryDb.exec('DELETE FROM client_log');
}

describe('POST /api/client-log', () => {
  beforeEach(() => {
    clearClientLog();
  });

  it('stores rows and returns accepted/received', async () => {
    const payload = validPayload({
      entries: [
        { seq: 0, at: 1_700_000_000_000, timestamp: '2026-06-10T10:00:00.000Z', message: 'first' },
        { seq: 1, at: 1_700_000_001_000, timestamp: '2026-06-10T10:00:01.000Z', message: 'second' },
      ],
    });

    const response = await request(app).post('/api/client-log').send(payload).expect(200);

    expect(response.body).toEqual({ accepted: 2, received: 2 });
    expect(response.headers['cache-control']).toBe('no-store');

    const rows = apiHistoryDb
      .prepare('SELECT * FROM client_log WHERE device_id = ? ORDER BY seq')
      .all('device-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].message).toBe('first');
    expect(rows[1].message).toBe('second');
  });

  it('returns accepted 0 for a duplicate POST', async () => {
    const payload = validPayload();

    await request(app).post('/api/client-log').send(payload).expect(200);
    const response = await request(app).post('/api/client-log').send(payload).expect(200);

    expect(response.body).toEqual({ accepted: 0, received: 1 });

    const rows = apiHistoryDb
      .prepare('SELECT * FROM client_log WHERE device_id = ?')
      .all('device-1');
    expect(rows).toHaveLength(1);
  });

  it('responds 400 when deviceId is missing', async () => {
    const payload = validPayload({ deviceId: undefined });
    delete (payload as Record<string, unknown>).deviceId;

    const response = await request(app).post('/api/client-log').send(payload).expect(400);

    expect(typeof response.body.error).toBe('string');
  });

  it('responds 400 when entries exceeds 300', async () => {
    const entries = Array.from({ length: 301 }, (_, index) => ({
      seq: index,
      at: 1_700_000_000_000 + index,
      timestamp: '2026-06-10T10:00:00.000Z',
      message: `entry ${index}`,
    }));
    const payload = validPayload({ entries });

    const response = await request(app).post('/api/client-log').send(payload).expect(400);

    expect(typeof response.body.error).toBe('string');
  });

  it('responds 400 when a message is too long', async () => {
    const payload = validPayload({
      entries: [
        {
          seq: 0,
          at: 1_700_000_000_000,
          timestamp: '2026-06-10T10:00:00.000Z',
          message: 'x'.repeat(501),
        },
      ],
    });

    const response = await request(app).post('/api/client-log').send(payload).expect(400);

    expect(typeof response.body.error).toBe('string');
  });

  it('stores data as JSON, truncated to 4000 chars with an ellipsis marker', async () => {
    const longData = { blob: 'y'.repeat(5000) };
    const payload = validPayload({
      entries: [
        {
          seq: 0,
          at: 1_700_000_000_000,
          timestamp: '2026-06-10T10:00:00.000Z',
          message: 'has data',
          data: longData,
        },
      ],
    });

    await request(app).post('/api/client-log').send(payload).expect(200);

    const row = apiHistoryDb
      .prepare('SELECT data FROM client_log WHERE device_id = ?')
      .get('device-1') as { data: string };

    expect(row.data.length).toBe(4001);
    expect(row.data.endsWith('…')).toBe(true);
  });

  it('stores null for missing data', async () => {
    const payload = validPayload();

    await request(app).post('/api/client-log').send(payload).expect(200);

    const row = apiHistoryDb
      .prepare('SELECT data FROM client_log WHERE device_id = ?')
      .get('device-1') as { data: string | null };

    expect(row.data).toBeNull();
  });
});

describe('GET /api/client-log', () => {
  beforeEach(() => {
    clearClientLog();
  });

  it('filters by device', async () => {
    await request(app)
      .post('/api/client-log')
      .send(validPayload({ deviceId: 'device-a' }))
      .expect(200);
    await request(app)
      .post('/api/client-log')
      .send(validPayload({ deviceId: 'device-b' }))
      .expect(200);

    const response = await request(app)
      .get('/api/client-log')
      .query({ device: 'device-a' })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].deviceId).toBe('device-a');
  });

  it('filters by q, case-insensitively, matching data too', async () => {
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [
            {
              seq: 0,
              at: 1_700_000_000_000,
              timestamp: '2026-06-10T10:00:00.000Z',
              message: 'contains NEEDLE in message',
            },
          ],
        })
      )
      .expect(200);
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [
            {
              seq: 1,
              at: 1_700_000_001_000,
              timestamp: '2026-06-10T10:00:01.000Z',
              message: 'plain message',
              data: { marker: 'needle-in-data' },
            },
          ],
        })
      )
      .expect(200);
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [
            {
              seq: 2,
              at: 1_700_000_002_000,
              timestamp: '2026-06-10T10:00:02.000Z',
              message: 'unrelated entry',
            },
          ],
        })
      )
      .expect(200);

    const response = await request(app).get('/api/client-log').query({ q: 'needle' }).expect(200);

    expect(response.body.rows).toHaveLength(2);
    const messages = response.body.rows.map((row: { message: string }) => row.message).sort();
    expect(messages).toEqual(['contains NEEDLE in message', 'plain message']);
  });

  it('honours since', async () => {
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [
            { seq: 0, at: 1_000, timestamp: '', message: 'old' },
            { seq: 1, at: 5_000, timestamp: '', message: 'new' },
          ],
        })
      )
      .expect(200);

    const response = await request(app).get('/api/client-log').query({ since: 2_000 }).expect(200);

    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].message).toBe('new');
  });

  it('honours limit and returns newest-first order', async () => {
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [
            { seq: 0, at: 1_000, timestamp: '', message: 'first' },
            { seq: 1, at: 2_000, timestamp: '', message: 'second' },
            { seq: 2, at: 3_000, timestamp: '', message: 'third' },
          ],
        })
      )
      .expect(200);

    const response = await request(app).get('/api/client-log').query({ limit: 2 }).expect(200);

    expect(response.body.rows).toHaveLength(2);
    expect(response.body.rows.map((row: { message: string }) => row.message)).toEqual([
      'third',
      'second',
    ]);
  });

  it('round-trips data as JSON', async () => {
    const data = { count: 3, nested: { ok: true }, list: [1, 2, 3] };
    await request(app)
      .post('/api/client-log')
      .send(
        validPayload({
          entries: [{ seq: 0, at: 1_700_000_000_000, timestamp: '', message: 'has data', data }],
        })
      )
      .expect(200);

    const response = await request(app).get('/api/client-log').expect(200);

    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].data).toEqual(data);
  });
});

describe('pruneClientLog', () => {
  beforeEach(() => {
    clearClientLog();
  });

  it('deletes rows with received_at older than 30 days', () => {
    const insert = apiHistoryDb.prepare(`
      INSERT INTO client_log (
        device_id, load_id, build, user_agent, seq, client_at, client_timestamp, message, data, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const oldReceivedAt = now - 31 * 24 * 60 * 60 * 1000;
    const recentReceivedAt = now - 1 * 24 * 60 * 60 * 1000;

    insert.run(
      'device-old',
      'load-old',
      '1.0',
      'agent',
      0,
      1_000,
      '',
      'old row',
      null,
      oldReceivedAt
    );
    insert.run(
      'device-new',
      'load-new',
      '1.0',
      'agent',
      0,
      2_000,
      '',
      'recent row',
      null,
      recentReceivedAt
    );

    pruneClientLog();

    const rows = apiHistoryDb.prepare('SELECT device_id FROM client_log').all() as Array<{
      device_id: string;
    }>;
    expect(rows.map(row => row.device_id)).toEqual(['device-new']);
  });

  it('keeps only the newest maxRows rows regardless of age', () => {
    const insert = apiHistoryDb.prepare(`
      INSERT INTO client_log (
        device_id, load_id, build, user_agent, seq, client_at, client_timestamp, message, data, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      insert.run('device', 'load', '1.0', 'agent', i, now + i, '', `row ${i}`, null, now + i);
    }

    pruneClientLog({ maxRows: 4 });

    const rows = apiHistoryDb.prepare('SELECT message FROM client_log ORDER BY id').all() as Array<{
      message: string;
    }>;
    expect(rows.map(row => row.message)).toEqual(['row 2', 'row 3', 'row 4', 'row 5']);
  });

  it('is a no-op when under the row cap', () => {
    const insert = apiHistoryDb.prepare(`
      INSERT INTO client_log (
        device_id, load_id, build, user_agent, seq, client_at, client_timestamp, message, data, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    insert.run('device', 'load', '1.0', 'agent', 0, now, '', 'only row', null, now);

    pruneClientLog({ maxRows: 4 });

    expect(apiHistoryDb.prepare('SELECT COUNT(*) n FROM client_log').get()).toEqual({ n: 1 });
  });
});
