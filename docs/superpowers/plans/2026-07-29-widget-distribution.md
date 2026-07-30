# Widget Distribution Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the widget APK on the Solar Sentinel site: `/widget/` landing page (blurb, screenshot, changelog, hash-named APK download) + release script + footer link in the app.

**Spec:** `docs/superpowers/specs/2026-07-29-widget-distribution-design.md` (schema + page requirements live there — read it).

## Global Constraints

- pnpm only; `pnpm exec vitest run` (never bare `pnpm test`); `pnpm run format` before committing JS/TS/HTML in src (public/ and android/ are prettier-ignored).
- Bash scripts: `#!/usr/bin/env bash` (NixOS). Never read/print/commit `android/local.properties`.
- Stage files individually by path — never `git add -A`/`.` (shared working tree; an unrelated `bugs/` dir exists).
- The landing page is fully self-contained (inline CSS/JS, no CDN, no Tailwind build); the app's fast path is untouched.
- `manifest.json` schema exactly as in the spec; the page must degrade gracefully when `latest` is missing or fetch fails.
- Screenshot already present: `public/widget/screens/widgets-home-screen.jpg` (uncommitted — Task 1 commits it).

---

### Task 1: Release script + manifest + first hash-named APK

**Files:**
- Create: `scripts/release-widget` (executable)
- Create: `public/widget/manifest.json`
- Commit also: `public/widget/screens/widgets-home-screen.jpg` (already on disk) and the APK the script produces

**Interfaces (Task 2 relies on):** `manifest.json` at `/widget/manifest.json` with `latest{file,versionName,versionCode,commit,builtAt,sizeBytes}`, `screenshots: string[]` (paths relative to `/widget/`), `changelog: [{version,date,notes[]}]`.

- [ ] **Step 1: Write `scripts/release-widget`**

```bash
#!/usr/bin/env bash
# Build the release APK and stage it for distribution at /widget/.
# Produces public/widget/solar-sentinel-widget-<shorthash>.apk (latest only)
# and rewrites manifest.json's `latest` + `screenshots`. Does NOT git-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git diff --quiet HEAD -- android/; then
  echo "error: android/ has uncommitted changes; commit them first so the APK hash is honest" >&2
  exit 1
fi

./scripts/build-widget-apk

HASH="$(git rev-parse --short HEAD)"
APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
DEST_DIR="public/widget"
DEST="$DEST_DIR/solar-sentinel-widget-$HASH.apk"

mkdir -p "$DEST_DIR/screens"
rm -f "$DEST_DIR"/solar-sentinel-widget-*.apk
cp "$APK_SRC" "$DEST"

VERSION_NAME="$(grep -oP 'versionName = "\K[^"]+' android/app/build.gradle.kts)"
VERSION_CODE="$(grep -oP 'versionCode = \K[0-9]+' android/app/build.gradle.kts)"

HASH="$HASH" DEST="$DEST" VERSION_NAME="$VERSION_NAME" VERSION_CODE="$VERSION_CODE" node <<'NODE'
const fs = require('node:fs');
const path = 'public/widget/manifest.json';
const manifest = fs.existsSync(path)
  ? JSON.parse(fs.readFileSync(path, 'utf8'))
  : { latest: null, screenshots: [], changelog: [] };
manifest.latest = {
  file: require('node:path').basename(process.env.DEST),
  versionName: process.env.VERSION_NAME,
  versionCode: Number(process.env.VERSION_CODE),
  commit: process.env.HASH,
  builtAt: new Date().toISOString(),
  sizeBytes: fs.statSync(process.env.DEST).size,
};
manifest.screenshots = fs
  .readdirSync('public/widget/screens')
  .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
  .sort()
  .map(f => `screens/${f}`);
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest updated:', JSON.stringify(manifest.latest));
NODE

echo
echo "Staged $DEST"
echo "Next: add a changelog entry to public/widget/manifest.json if this is a new version,"
echo "then commit public/widget/ and deploy (docker compose down && docker compose up -d --build)."
```

`chmod +x scripts/release-widget`.

- [ ] **Step 2: Seed the changelog**

Run the script once (HEAD is the v1.2 code), then edit `public/widget/manifest.json` to backfill:

```json
"changelog": [
  { "version": "1.2", "date": "2026-07-29", "notes": ["Temperature y-axis with min/max labels and gridlines on the graph widget", "Rain-probability bars now span the full 0–100% chart height"] },
  { "version": "1.1", "date": "2026-07-29", "notes": ["New graph widget: today's temperature, rain probability, and cloud cover by hour", "Summary widget resizes responsively and fills its cells", "Fixed background refresh being frozen by Samsung battery optimization"] },
  { "version": "1.0", "date": "2026-07-28", "notes": ["Initial release: today's high/low, current temp, UV now/max, rain timing, and daily weather art"] }
]
```

- [ ] **Step 3: Verify + commit**

`pnpm run build` succeeds and `dist/widget/` contains the APK, manifest, and screenshot. Then:

```bash
git add scripts/release-widget public/widget/manifest.json "public/widget/solar-sentinel-widget-"*.apk public/widget/screens/widgets-home-screen.jpg
git commit -m "Add widget release script and hosted APK manifest"
```

---

### Task 2: Landing page + app footer link

**Files:**
- Create: `public/widget/index.html`
- Modify: `src/index.html` (footer link only)

**Interfaces:** consumes `manifest.json` per Task 1's schema.

- [ ] **Step 1: `public/widget/index.html`** — self-contained page per the spec: dark slate (#0f172a) with amber accents, system font stack, max-width ~640px column. Sections: (1) hero — title "Solar Sentinel Widget", one-paragraph blurb (glanceable UV/temp/rain widgets fed by this site, home-screen summary + today graph); (2) prominent download button showing `versionName`, hash-named filename, human size (MB, 1 decimal), built date — `href` = `latest.file` (relative, `download` attribute); (3) screenshots — one `<img>` per `manifest.screenshots` entry, rounded corners, max-width 100%; hide section when empty; (4) changelog — version + date heading with bullet notes per entry; (5) install notes — allow installs from browser, grant location then "Allow all the time", Samsung: Battery → Unrestricted. Vanilla JS `fetch('manifest.json')` renders 2-4; on failure or `latest: null`, button area shows "No release published yet" and the static sections remain. No external requests of any kind.

- [ ] **Step 2: footer link in `src/index.html`** — a small, unobtrusive footer element at the end of the app's main container: `<a href="/widget/">📱 Get the Android widget</a>`, muted color consistent with existing footer/debug styling (inspect the file's current classes; Tailwind utility classes are fine — this file is built by Vite).

- [ ] **Step 3: Verify** — `pnpm run build` (page + assets land in dist), `pnpm exec vitest run` green (no server change), `pnpm run format` (src/index.html), manual `curl` of the built page from `dist/`.

- [ ] **Step 4: Commit**

```bash
git add public/widget/index.html src/index.html
git commit -m "Add widget landing page and app footer link"
```

---

### Task 3: Ship (main session)

- [ ] Full suite + typecheck + format:check green on the branch
- [ ] Merge to master, push
- [ ] Docker rebuild from clean state; verify `/widget/` + APK download + manifest through the tunnel (with Access service-token headers)
- [ ] Retire the temporary tailnet APK server; notify David
