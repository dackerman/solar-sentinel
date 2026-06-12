# Weather Art Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill weather-art flicker, cut art payload from ~45 MB lossless to ~4 MB lossy, and make art cache-immutable.

**Architecture:** Originals move out of `public/` into `art-src/weather-art/`; a `magick`-based script emits 384px lossy WebP into `public/weather-art/v2/` (committed). The frontend stops touching `<img>` elements whose art key didn't change, swaps via an off-DOM loader when it did, and skips history re-renders when the as-of snapshot is unchanged. Server + service worker treat `/weather-art/` as immutable.

**Tech Stack:** ImageMagick (`magick`, present on this NixOS host), bash (`/usr/bin/env bash`), TypeScript frontend, Vitest + happy-dom, Express static headers, service worker.

**Spec:** `docs/superpowers/specs/2026-06-12-weather-art-optimization-design.md`

**Conventions:** pnpm only; `pnpm exec vitest run` (bare `pnpm test` is watch mode). `pnpm run format` before each commit. Note: `CLAUDE.md` is a symlink — edit `AGENTS.md`.

**Inventory facts:** `public/weather-art/v1/` holds 191 art images (512×512 lossless WebP) plus generation artifacts: `manifest.json`, `sample-prompts.json`, `sample-contact-sheet.webp`, `grok-batches/`. Nothing in `src/` references the manifest or v1 path except `WEATHER_ART_BASE_PATH` in `src/utils/weatherArt.ts`.

---

### Task 1: Move originals, add compression script, emit v2, bump base path

**Files:**
- Create: `art-src/weather-art/` (moved content), `scripts/compress-weather-art`
- Create: `public/weather-art/v2/*.webp` (191 generated files, committed)
- Modify: `src/utils/weatherArt.ts` (base path), `src/test/weatherArt.test.ts` (path expectations, if any)
- Delete: `public/weather-art/v1/`

- [ ] **Step 1: Move originals out of public/**

```bash
mkdir -p art-src
git mv public/weather-art/v1 art-src/weather-art
```

- [ ] **Step 2: Write `scripts/compress-weather-art`**

```bash
#!/usr/bin/env bash
# Regenerate compressed weather art from the lossless originals.
# Originals: art-src/weather-art/*.webp (512x512 lossless)
# Output:    public/weather-art/v2/*.webp (384x384 lossy q82, committed)
set -euo pipefail
cd "$(dirname "$0")/.."

src_dir="art-src/weather-art"
out_dir="public/weather-art/v2"
mkdir -p "$out_dir"

count=0
skipped=0
for src in "$src_dir"/*.webp; do
  name="$(basename "$src")"
  # Generation artifacts are not served art
  if [[ "$name" == sample-* ]]; then continue; fi
  out="$out_dir/$name"
  if [[ -f "$out" && "$out" -nt "$src" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  magick "$src" -resize 384x384 -strip -quality 82 -define webp:method=6 "$out"
  count=$((count + 1))
done

echo "Compressed $count image(s), $skipped up to date."
echo "Total output size: $(du -sh "$out_dir" | cut -f1)"
```

```bash
chmod +x scripts/compress-weather-art
```

- [ ] **Step 3: Run it and sanity-check the output**

Run: `./scripts/compress-weather-art`
Expected: `Compressed 191 image(s), 0 up to date.` and total output around 3–6 MB.

Run again: `./scripts/compress-weather-art`
Expected: `Compressed 0 image(s), 191 up to date.` (idempotent)

Verify dimensions and size of one output:

```bash
magick identify public/weather-art/v2/day-cool-storm.webp
ls -la public/weather-art/v2/day-cool-storm.webp
```

Expected: `WEBP 384x384`, file size roughly 10–40 KB.

- [ ] **Step 4: Bump the served base path**

In `src/utils/weatherArt.ts`:

```ts
const WEATHER_ART_BASE_PATH = '/weather-art/v2';
```

Check `src/test/weatherArt.test.ts` for `/v1` path assertions and update them to `/v2`:

```bash
grep -n "v1" src/test/weatherArt.test.ts
```

- [ ] **Step 5: Run the suite and typecheck**

Run: `pnpm exec vitest run && pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: Format and commit**

```bash
pnpm run format
git add -A art-src public/weather-art scripts/compress-weather-art src/utils/weatherArt.ts src/test/weatherArt.test.ts
git commit -m "Compress weather art to 384px lossy, move originals out of public"
```

---

### Task 2: No-op art updates when the key is unchanged; swap-on-load otherwise

**Files:**
- Modify: `src/app.ts` (`updateWeatherArtImage`, ~line 490)
- Test: create `src/test/weatherArtImage.test.ts`

- [ ] **Step 1: Write the failing tests**

`updateWeatherArtImage` is private; tests reach it via a structural cast. The
off-DOM loader is observed by stubbing `Image` with a capturing fake.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import type { WeatherArtResult } from '../utils/weatherArt.js';

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
}

const mkArt = (key: string): WeatherArtResult => ({
  key,
  path: `/weather-art/v2/${key}.webp`,
  label: key,
  alt: `Weather art: ${key}`,
  bins: { daypart: 'day', tempBand: 'mild', condition: 'clear-low-uv' },
});

type ArtApp = { updateWeatherArtImage(elementId: string, art: WeatherArtResult): void };

describe('updateWeatherArtImage', () => {
  beforeEach(() => {
    document.body.innerHTML = `<img id="art" class="hidden" />`;
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when the art key is unchanged', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;
    image.dataset.weatherArtKey = 'day-mild-clear-low-uv';
    image.src = '/weather-art/v2/day-mild-clear-low-uv.webp';
    image.classList.remove('hidden');

    app.updateWeatherArtImage('art', mkArt('day-mild-clear-low-uv'));

    expect(FakeImage.instances).toHaveLength(0);
    expect(image.classList.contains('hidden')).toBe(false);
    expect(image.src).toContain('day-mild-clear-low-uv.webp');
  });

  it('keeps the old art visible until the replacement has loaded', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;
    image.dataset.weatherArtKey = 'day-mild-clear-low-uv';
    image.src = '/weather-art/v2/day-mild-clear-low-uv.webp';
    image.classList.remove('hidden');

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));

    // Old art still showing, loader fetching in the background
    expect(image.src).toContain('day-mild-clear-low-uv.webp');
    expect(image.classList.contains('hidden')).toBe(false);
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0].src).toContain('day-hot-storm.webp');

    FakeImage.instances[0].onload?.();

    expect(image.src).toContain('day-hot-storm.webp');
    expect(image.classList.contains('hidden')).toBe(false);
  });

  it('ignores a stale load when a newer art was requested', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));
    app.updateWeatherArtImage('art', mkArt('night-mild-clear'));

    FakeImage.instances[0].onload?.(); // stale
    expect(image.src).not.toContain('day-hot-storm.webp');

    FakeImage.instances[1].onload?.();
    expect(image.src).toContain('night-mild-clear.webp');
  });

  it('hides the element when the replacement fails to load', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));
    FakeImage.instances[0].onerror?.();

    expect(image.classList.contains('hidden')).toBe(true);
    expect(image.getAttribute('src')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/test/weatherArtImage.test.ts`
Expected: FAIL — current implementation hides immediately and sets `src` directly
(no `FakeImage` instances; old-art-stays-visible assertions fail)

- [ ] **Step 3: Replace `updateWeatherArtImage` in `src/app.ts`**

```ts
private updateWeatherArtImage(elementId: string, art: WeatherArtResult): void {
  const image = document.getElementById(elementId) as HTMLImageElement | null;
  if (!image) return;

  if (image.dataset.weatherArtKey === art.key && image.getAttribute('src')) {
    image.alt = art.alt;
    image.title = art.label;
    return;
  }

  // Load off-DOM and swap only when ready, so the previous art (if any)
  // stays visible and there is never a blank frame.
  image.dataset.weatherArtKey = art.key;
  const loader = new Image();
  loader.onload = () => {
    if (image.dataset.weatherArtKey !== art.key) return;
    image.alt = art.alt;
    image.title = art.label;
    image.src = art.path;
    image.classList.remove('hidden');
  };
  loader.onerror = () => {
    if (image.dataset.weatherArtKey !== art.key) return;
    image.classList.add('hidden');
    image.removeAttribute('src');
  };
  loader.src = art.path;
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm exec vitest run && pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/app.ts src/test/weatherArtImage.test.ts
git commit -m "Swap weather art without flicker, skip unchanged art"
```

---

### Task 3: Skip history re-renders when the resolved snapshot is unchanged

**Files:**
- Modify: `src/app.ts` (`renderHistoryAt`; fields near `historyTimeline`; resets in `enterHistoryMode`, `exitHistoryMode`, `refreshHistoryForDateChange`)
- Test: `src/test/history.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/test/history.test.ts` (the existing `setupDOM` there already includes
the history elements; spies neutralize the heavy render methods):

```ts
it('re-renders only when scrubbing resolves to a different snapshot', () => {
  const app = new SolarSentinelApp() as unknown as {
    historyTimeline: string[];
    weatherHistory: Array<{ id: number; fetchedAt: string; data: unknown }>;
    calendarHistory: unknown[];
    renderHistoryAt(index: number): void;
    renderWeatherData(data: unknown, silent: boolean): void;
  };

  const renderSpy = vi
    .spyOn(app as unknown as Record<'renderWeatherData', (...args: unknown[]) => void>, 'renderWeatherData')
    .mockImplementation(() => {});

  app.historyTimeline = [
    '2026-06-10T10:00:00.000Z',
    '2026-06-10T11:00:00.000Z',
    '2026-06-10T12:00:00.000Z',
  ];
  app.weatherHistory = [
    { id: 1, fetchedAt: '2026-06-10T09:30:00.000Z', data: {} },
    { id: 2, fetchedAt: '2026-06-10T11:30:00.000Z', data: {} },
  ];
  app.calendarHistory = [];

  app.renderHistoryAt(0); // resolves to id 1
  app.renderHistoryAt(1); // still id 1 — must not re-render
  app.renderHistoryAt(2); // resolves to id 2

  expect(renderSpy).toHaveBeenCalledTimes(2);
});
```

Add the `vi` import to the existing import line if missing:
`import { describe, it, expect, beforeEach, vi } from 'vitest';`

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/test/history.test.ts`
Expected: FAIL — `renderWeatherData` called 3 times

- [ ] **Step 3: Implement the skip**

Add fields next to `historyTimeline` in `src/app.ts`:

```ts
private lastHistoryWeatherId: number | string | null = null;
private lastHistoryCalendarId: number | string | null = null;
```

Replace the body of `renderHistoryAt`:

```ts
private renderHistoryAt(index: number): void {
  const asOf = this.historyTimeline[index];
  if (!asOf) return;

  const weatherEntry = this.getLatestEntryAt(this.weatherHistory, asOf);
  if (weatherEntry) {
    this.setHistoryUnavailable(false);
    const weatherId = weatherEntry.id ?? weatherEntry.fetchedAt;
    if (weatherId !== this.lastHistoryWeatherId) {
      this.lastHistoryWeatherId = weatherId;
      this.renderWeatherData(weatherEntry.data, false);
    }
  } else {
    this.lastHistoryWeatherId = null;
    this.setHistoryUnavailable(true);
  }

  const calendarEntry = this.getLatestEntryAt(this.calendarHistory, asOf);
  if (calendarEntry) {
    const calendarId = calendarEntry.id ?? calendarEntry.fetchedAt;
    if (calendarId !== this.lastHistoryCalendarId) {
      this.lastHistoryCalendarId = calendarId;
      this.renderForecastCalendar(calendarEntry.data);
    }
  }
  this.updateHistoryLabel(index, weatherEntry);
}
```

Reset tracking wherever history rendering context changes — add this line:

```ts
this.lastHistoryWeatherId = null;
this.lastHistoryCalendarId = null;
```

in three places:
1. `enterHistoryMode`, right before `this.renderHistoryAt(this.historyTimeline.length - 1);`
2. `exitHistoryMode`, right after `this.setHistoryUnavailable(false);`
3. `refreshHistoryForDateChange`, right before `this.renderHistoryAt(index);`

(The unavailable branch resets the weather id so returning to the same snapshot
after an unavailable stretch re-renders the hidden sections.)

- [ ] **Step 4: Run the full suite**

Run: `pnpm exec vitest run && pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/app.ts src/test/history.test.ts
git commit -m "Skip history re-renders when the snapshot is unchanged"
```

---

### Task 4: Immutable caching for weather art (server + service worker)

**Files:**
- Modify: `server.js` (static `setHeaders`, ~line 337)
- Modify: `public/sw.js` (fetch strategy + `VERSION`)
- Test: `src/test/server.api.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new describe block in `src/test/server.api.test.ts` (the test server serves
`public/` because `NODE_ENV=test` ≠ production):

```ts
describe('Weather art static serving', () => {
  it('serves weather art with immutable cache headers', async () => {
    const response = await request(app)
      .get('/weather-art/v2/day-cool-storm.webp')
      .expect(200);

    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/test/server.api.test.ts -t "immutable cache"`
Expected: FAIL — current header is `public, max-age=86400`

- [ ] **Step 3: Add the header rule in `server.js`**

In the static `setHeaders` callback, insert a `weather-art` branch directly after
the `/assets/` branch (before the HTML rule), mirroring its path matching:

```js
      // Weather art is path-versioned (/weather-art/v2/...); cache indefinitely.
      else if (path.match(/[\\/]weather-art[\\/]/)) {
        res.set({
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      }
```

- [ ] **Step 4: Service worker cache-first for weather art**

In `public/sw.js`:

1. Bump `const VERSION = '1.0.1';` → `'1.1.0'`.
2. In the fetch handler, extend the cache-first branch condition from:

```js
  else if (cacheStrategies.static.some(path => url.pathname.includes(path))) {
```

to:

```js
  else if (
    url.pathname.startsWith('/weather-art/') ||
    cacheStrategies.static.some(path => url.pathname.includes(path))
  ) {
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm exec vitest run`
Expected: PASS

- [ ] **Step 6: Format and commit**

```bash
pnpm run format
git add server.js public/sw.js src/test/server.api.test.ts
git commit -m "Serve weather art with immutable caching"
```

---

### Task 5: Docs, final verification, deploy

**Files:**
- Modify: `AGENTS.md` (CLAUDE.md is a symlink to it)

- [ ] **Step 1: Document the art pipeline**

In `AGENTS.md` `## Architecture`, after the Chart.js lazy-import line, add:

```markdown
- Weather art lives as 512px lossless originals in `art-src/weather-art/`; `./scripts/compress-weather-art` (ImageMagick) emits the served 384px lossy copies into `public/weather-art/v2/` (committed). Art URLs are path-versioned and cached immutable — any art change goes to a new `/v3/` directory
```

- [ ] **Step 2: Full check**

Run: `pnpm exec vitest run && pnpm run typecheck && pnpm run format:check && pnpm run build`
Expected: all PASS; `dist/weather-art` should be ~4 MB (was 45 MB)

```bash
du -sh dist/weather-art
```

- [ ] **Step 3: Commit, push, deploy**

```bash
git add AGENTS.md
git commit -m "Document weather art pipeline"
git push
./scripts/deploy
```

- [ ] **Step 4: Production smoke test**

```bash
curl -sI http://localhost:49877/weather-art/v2/day-cool-storm.webp | grep -i -E 'cache-control|content-length'
```

Expected: immutable cache header; content-length roughly 10–40 KB.
