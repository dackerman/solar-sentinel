# History Snapshot Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record only history snapshots whose meaningful content changed, so the all-dates history scrubber stays small and fast.

**Architecture:** Server-side dedup in `recordApiCall` compares the new payload (minus `$.metadata`) against the latest stored row for the same `(route, location_key, date)` and skips identical inserts. An idempotent startup pass deletes pre-existing consecutive duplicates. The frontend throttles scrub rendering to one frame.

**Tech Stack:** Express + `node:sqlite` (`DatabaseSync`), TypeScript frontend, Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-11-history-snapshot-dedup-design.md`

**Conventions:** pnpm only. Prettier (2 spaces, single quotes, 100 width) — run `pnpm run format` before each commit. Tests share one in-memory SQLite DB per test file, so new tests must use unique coordinates/location keys to stay isolated.

---

### Task 1: Commit the in-flight all-dates scrubbing changes

The working tree already contains the change that lets `/api/history` serve all dates (server statements, optional `date` param, frontend paging). Commit it as the base.

**Files:**
- Already modified: `server.js`, `src/app.ts`, `src/services/api.ts`, `src/test/server.api.test.ts`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS (all suites; includes the new "returns stored weather snapshots without a date filter" test)

- [ ] **Step 2: Run typecheck and format check**

Run: `pnpm run typecheck && pnpm run format:check`
Expected: both succeed

- [ ] **Step 3: Commit**

```bash
git add server.js src/app.ts src/services/api.ts src/test/server.api.test.ts
git commit -m "Let history scrubber page through all dates"
```

---

### Task 2: Dedup on insert

**Files:**
- Modify: `server.js` (statements near line 142; `recordApiCall` near line 453)
- Test: `src/test/server.api.test.ts` (inside `describe('GET /api/history'...)` block, after the "without a date filter" test near line 286)
- Modify: `docs/superpowers/specs/2026-06-11-history-snapshot-dedup-design.md` (corrected comparison SQL, see Step 3)

- [ ] **Step 1: Write the failing test**

Add a mock helper next to `getMockCombinedData` (near line 60 of `src/test/server.api.test.ts`):

```ts
function getMockTwoDayData(dateA: string, dateB: string) {
  return {
    hourly: {
      time: [`${dateA}T10:00:00`, `${dateA}T11:00:00`, `${dateB}T10:00:00`, `${dateB}T11:00:00`],
      uv_index: [3.1, 4.2, 2.5, 3.3],
      uv_index_clear_sky: [5.0, 6.0, 4.0, 5.0],
      precipitation_probability: [10, 20, 30, 40],
      temperature_2m: [60.1, 62.2, 55.3, 57.4],
      apparent_temperature: [59.0, 61.0, 54.0, 56.0],
      cloud_cover: [20, 30, 40, 50],
      relative_humidity_2m: [50, 55, 60, 65],
      weather_code: [1, 2, 2, 3],
    },
    daily: {
      time: [dateA, dateB],
      temperature_2m_max: [62.2, 57.4],
      temperature_2m_min: [40.0, 38.0],
      uv_index_max: [4.2, 3.3],
      precipitation_probability_max: [20, 40],
      relative_humidity_2m_max: [55, 65],
      weather_code: [2, 3],
    },
  };
}
```

Add the test inside the `/api/history` describe block. Coordinates `41.42, -72.42` are unique to this test so the shared in-memory DB stays isolated. The single `mockResolvedValueOnce` doubles as an assertion that requests 2 and 3 are cache hits (a second upstream fetch would reject):

```ts
it('skips recording history snapshots when the payload is unchanged', async () => {
  const dateA = getTestDate(5);
  const dateB = getTestDate(6);
  const lat = 41.42;
  const lon = -72.42;

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(getMockTwoDayData(dateA, dateB)),
  });

  await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);
  await request(app).get('/api/weather').query({ lat, lon, date: dateB }).expect(200);
  await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);

  const response = await request(app)
    .get('/api/history')
    .query({ route: '/api/weather', lat, lon })
    .expect(200);

  expect(response.body.entries).toHaveLength(2);
  const dates = response.body.entries.map((entry: { date: string }) => entry.date);
  expect(dates).toContain(dateA);
  expect(dates).toContain(dateB);
});
```

The repeat `dateA` request is identical to the latest `dateA` row (only `metadata` differs) → must be skipped. `dateB` is a different payload and date partition → must be recorded. This also proves the comparison is partitioned per date: a global latest-row comparison would see `dateB` as latest and wrongly re-record `dateA`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server.api.test.ts -t "skips recording history snapshots"`
Expected: FAIL — `entries` has length 3 (every request currently inserts a row)

- [ ] **Step 3: Implement dedup in `server.js`**

Add the prepared statement after `selectApiHistoryAllDatesAfterStatement` (near line 208). It fetches only the latest row for the key and compares in SQL so both sides pass through SQLite's JSON normalizer. `IS` handles NULL `location_key`/`date`:

```js
const selectApiHistoryIsDuplicateStatement = apiHistoryDb.prepare(`
  SELECT json_remove(response_json, '$.metadata') = json_remove(?, '$.metadata') AS isDuplicate
  FROM api_call_history
  WHERE route = ?
    AND location_key IS ?
    AND date IS ?
    AND status_code = 200
  ORDER BY fetched_at DESC, id DESC
  LIMIT 1
`);
```

Note this intentionally differs from the spec's original sketch (which put the equality in `WHERE ... LIMIT 1` — that would match *any* historical row and wrongly skip a value that changed and later changed back). Update the spec's "Dedup on insert" SQL block to this query.

Rework `recordApiCall` (line 453) to check before inserting. A failed dedup check falls back to inserting (status quo: a duplicate row):

```js
function recordApiCall({ req, lat, lon, date, cacheKey, cacheStatus, statusCode, responseBody }) {
  try {
    const safeLat = getSafeNumber(lat);
    const safeLon = getSafeNumber(lon);
    const locationKey =
      safeLat !== null && safeLon !== null ? getForecastCacheKey(safeLat, safeLon) : null;
    const responseJson = JSON.stringify(responseBody);

    if (statusCode === 200) {
      const latest = selectApiHistoryIsDuplicateStatement.get(
        responseJson,
        req.path,
        locationKey,
        date || null
      );
      if (latest?.isDuplicate) {
        return;
      }
    }

    insertApiHistoryStatement.run(
      new Date().toISOString(),
      req.path,
      JSON.stringify(req.query || {}),
      safeLat,
      safeLon,
      locationKey,
      date || null,
      cacheKey || null,
      cacheStatus || null,
      statusCode,
      responseJson
    );
  } catch (error) {
    console.error('API history write error:', error.message);
  }
}
```

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: PASS — including the new test and all existing history tests (their mock payloads differ per fetch, so nothing else gets deduped)

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add server.js src/test/server.api.test.ts docs/superpowers/specs/2026-06-11-history-snapshot-dedup-design.md
git commit -m "Skip history snapshots with unchanged payloads"
```

---

### Task 3: Startup cleanup of existing duplicates

**Files:**
- Modify: `server.js` (after `pruneApiHistory` wiring near line 225; exports near line 1006)
- Test: `src/test/server.api.test.ts`

- [ ] **Step 1: Write the failing test**

Update the server import at the top of `src/test/server.api.test.ts` (line 3–4):

```ts
// @ts-ignore - server.js doesn't have TypeScript declarations
import app, { apiHistoryDb, dedupeApiHistory } from '../../server.js';
```

Add a new describe block after the `/api/history` tests. It inserts rows directly (bypassing `recordApiCall`, like a DB written by an older server version), with a unique `location_key`:

```ts
describe('History duplicate cleanup', () => {
  it('removes consecutive duplicate snapshots, keeping the first occurrence', () => {
    const insert = apiHistoryDb.prepare(`
      INSERT INTO api_call_history (
        fetched_at, route, request_query_json, lat, lon, location_key,
        date, cache_key, cache_status, status_code, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const locationKey = '40.10,-70.10';
    const date = '2026-06-10';
    const payloadA = (cacheAge: number) =>
      JSON.stringify({ uv: [1, 2], metadata: { cached: true, cacheAge } });
    const payloadB = JSON.stringify({ uv: [9, 9], metadata: { cached: true, cacheAge: 3 } });

    insert.run(
      '2026-06-10T10:00:00.000Z', '/api/weather', '{}', 40.1, -70.1,
      locationKey, date, null, 'hit', 200, payloadA(1)
    );
    insert.run(
      '2026-06-10T10:10:00.000Z', '/api/weather', '{}', 40.1, -70.1,
      locationKey, date, null, 'hit', 200, payloadA(2)
    );
    insert.run(
      '2026-06-10T10:20:00.000Z', '/api/weather', '{}', 40.1, -70.1,
      locationKey, date, null, 'hit', 200, payloadB
    );

    dedupeApiHistory();

    const rows = apiHistoryDb
      .prepare(
        'SELECT fetched_at FROM api_call_history WHERE location_key = ? ORDER BY fetched_at'
      )
      .all(locationKey);

    expect(rows.map((row: { fetched_at: string }) => row.fetched_at)).toEqual([
      '2026-06-10T10:00:00.000Z',
      '2026-06-10T10:20:00.000Z',
    ]);
  });
});
```

Rows 1 and 2 differ only in `metadata.cacheAge` → row 2 must be deleted. Row 3 has different data → kept. Row 1 (earliest `fetched_at`) must survive, preserving the timestamp of the last real change.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server.api.test.ts -t "removes consecutive duplicate snapshots"`
Expected: FAIL — `dedupeApiHistory` is not exported (undefined is not a function)

- [ ] **Step 3: Implement cleanup in `server.js`**

Add after `pruneApiHistoryStatement` (near line 213):

```js
const dedupeApiHistoryStatement = apiHistoryDb.prepare(`
  DELETE FROM api_call_history WHERE id IN (
    SELECT id FROM (
      SELECT id,
             json_remove(response_json, '$.metadata') AS content,
             LAG(json_remove(response_json, '$.metadata')) OVER (
               PARTITION BY route, location_key, date
               ORDER BY fetched_at, id
             ) AS prevContent
      FROM api_call_history
      WHERE status_code = 200
    )
    WHERE content = prevContent
  )
`);

function dedupeApiHistory() {
  try {
    dedupeApiHistoryStatement.run();
  } catch (error) {
    console.error('API history dedupe error:', error.message);
  }
}
```

Call it once at startup, right after the existing `pruneApiHistory();` call (line 224):

```js
pruneApiHistory();
dedupeApiHistory();
setInterval(pruneApiHistory, 24 * 60 * 60 * 1000);
```

Add named exports next to the default export at the bottom of `server.js` (line 1006):

```js
export { apiHistoryDb, dedupeApiHistory };
export default app;
```

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add server.js src/test/server.api.test.ts
git commit -m "Clean up duplicate history snapshots at startup"
```

---

### Task 4: rAF-throttled scrub rendering

No unit test: the scrubber DOM wiring has no existing test harness (nothing in `src/test/app.test.ts` touches history), and the change is render-scheduling plumbing. Verified via typecheck + the full suite + manual scrub in Task 5.

**Files:**
- Modify: `src/app.ts` (input listener near line 107; new field + method near `renderHistoryAt`, line 953)

- [ ] **Step 1: Add the pending-index field**

Next to the other history fields (after `historyRefreshPromise`, near line 53):

```ts
private pendingHistoryRenderIndex: number | null = null;
```

- [ ] **Step 2: Throttle the input listener**

Replace the listener at line 107:

```ts
document.getElementById('history-scrubber')?.addEventListener('input', event => {
  this.scheduleHistoryRender(Number((event.target as HTMLInputElement).value));
});
```

Add the method directly above `renderHistoryAt` (line 953). While a frame is pending, new input only updates the target index — at most one chart render per animation frame:

```ts
private scheduleHistoryRender(index: number): void {
  const alreadyScheduled = this.pendingHistoryRenderIndex !== null;
  this.pendingHistoryRenderIndex = index;
  if (alreadyScheduled) return;

  requestAnimationFrame(() => {
    const pending = this.pendingHistoryRenderIndex;
    this.pendingHistoryRenderIndex = null;
    if (pending !== null) {
      this.renderHistoryAt(pending);
    }
  });
}
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `pnpm run typecheck && pnpm test`
Expected: PASS

- [ ] **Step 4: Format and commit**

```bash
pnpm run format
git add src/app.ts
git commit -m "Throttle history scrubbing to one render per frame"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full check**

Run: `pnpm test && pnpm run typecheck && pnpm run format:check && pnpm run build`
Expected: all PASS

- [ ] **Step 2: Verify the cleanup against a copy of the production DB**

Never run against the live file (the Docker server has it open). Copy first:

```bash
cp data/solar-sentinel.sqlite /tmp/ss-dedup-check.sqlite
sqlite3 /tmp/ss-dedup-check.sqlite "
SELECT route, count(*) FROM api_call_history WHERE status_code=200 GROUP BY route;
DELETE FROM api_call_history WHERE id IN (
  SELECT id FROM (
    SELECT id,
           json_remove(response_json, '\$.metadata') AS content,
           LAG(json_remove(response_json, '\$.metadata')) OVER (
             PARTITION BY route, location_key, date
             ORDER BY fetched_at, id
           ) AS prevContent
    FROM api_call_history
    WHERE status_code = 200
  ) WHERE content = prevContent
);
SELECT route, count(*) FROM api_call_history WHERE status_code=200 GROUP BY route;
"
rm /tmp/ss-dedup-check.sqlite
```

Expected: counts drop from ~2,500 per route to roughly the distinct-payload counts (~400 weather, ~330 calendar; slightly above the global-distinct measurement of 381/309 because this only collapses *consecutive* duplicates per date partition).

- [ ] **Step 3: Report deployment note**

The production DB gets cleaned automatically at next deploy (`docker compose down && docker compose up -d --build`). Don't deploy unprompted — note it for David.
