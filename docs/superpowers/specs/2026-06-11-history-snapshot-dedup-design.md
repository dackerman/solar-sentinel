# History Snapshot Dedup + All-Dates Scrubbing — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

The history slider scrubs through every stored snapshot across all dates (not just
today). Make that efficient for data transfer and processing by recording only
snapshots whose meaningful content actually changed.

## Background / Measurements (production DB, 7-day retention)

- ~2,497 snapshots per route (`/api/weather`, `/api/daily-calendar`), ~2–4 KB each
  → ~13.5 MB JSON if the frontend loads everything.
- Every `response_json` is unique, but only because of the embedded `$.metadata`
  (cacheAge, performance timings). Stripping metadata leaves **381/2,497** distinct
  weather payloads and **309/2,497** distinct calendar payloads — ~85–88% of rows are
  exact duplicates recorded on cache hits.
- The working tree already removes the date filter from `/api/history` and pages all
  entries (500/page) into the frontend's in-memory history cache. That client logic
  stays unchanged; dedup shrinks the volume it handles 7–8×.

## Decision

Dedupe at the source (approach A). Index+lazy-fetch (B) and delta encoding (C) were
considered and rejected as unnecessary at this data size; B is the natural upgrade if
retention grows beyond 7 days.

Slider semantics change from "every fetch" to "every change": a slider position exists
only where the forecast actually differed. Skipped inserts preserve the `fetched_at`
of the last real change, which is the timestamp the slider label should show.

## Changes

### 1. Dedup on insert (`server.js`, `recordApiCall`)

Before inserting, compare the new payload against the most recent stored snapshot for
the same `(route, location_key, date)`, ignoring `$.metadata`. Skip the insert when
identical. Comparison happens in SQL so both sides go through SQLite's JSON
normalizer:

```sql
SELECT json_remove(response_json, '$.metadata') = json_remove(?, '$.metadata') AS isDuplicate
FROM api_call_history
WHERE route = ? AND location_key IS ? AND date IS ? AND status_code = 200
ORDER BY fetched_at DESC, id DESC LIMIT 1
```

The comparison must select the latest row and compare against it — not filter on
equality (which would match *any* historical row and wrongly skip a payload that
changed and later changed back).

Keying per-date (not globally) means flipping between dates in the UI does not
re-record unchanged forecasts. Only status-200 responses participate (matching what
the history endpoint serves). `date IS ?` handles NULL dates.

### 2. One-time cleanup of existing duplicates (startup)

An idempotent pass next to `pruneApiHistory()` deletes rows whose metadata-stripped
payload equals the previous row's within the same `(route, location_key, date)`
partition, using a `LAG()` window query:

```sql
DELETE FROM api_call_history WHERE id IN (
  SELECT id FROM (
    SELECT id,
           json_remove(response_json, '$.metadata') AS content,
           LAG(json_remove(response_json, '$.metadata')) OVER (
             PARTITION BY route, location_key, date
             ORDER BY fetched_at, id
           ) AS prev_content
    FROM api_call_history
    WHERE status_code = 200
  ) WHERE content = prev_content
)
```

Runs once at startup (sub-second on ~5k rows), fixes the prod Docker DB on next
deploy with no manual step, and is a no-op thereafter.

### 3. Frontend: rAF-throttled scrubbing (`src/app.ts`)

`renderHistoryAt` currently re-renders charts on every `input` event while dragging.
Store the pending index and render at most once per animation frame via
`requestAnimationFrame`.

### 4. Unchanged

The working-tree changes already in flight (no date filter on `/api/history`, paging,
client-side merge cache) stay as-is. Post-dedup volume: ~700 points/week ≈ 1.8 MB raw,
~150 KB gzipped across ~2 pages per route.

## Testing

- Server: recording two identical responses (modulo `metadata`) produces one history
  row; a changed payload produces a second row.
- Server: startup cleanup collapses pre-existing duplicate rows and keeps the first
  occurrence (its `fetched_at`).
- Existing history tests pass unchanged (mock payloads differ per fetch).

## Error handling

Dedup lookup and cleanup follow the existing pattern: try/catch with
`console.error`, never failing the request path. A dedup-check failure falls back to
inserting (worst case: a duplicate row, the status quo).
