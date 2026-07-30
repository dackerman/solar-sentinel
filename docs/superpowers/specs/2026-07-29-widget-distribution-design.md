# Widget Distribution Page — Design

**Date:** 2026-07-29
**Status:** Approved (David: APKs committed to repo latest-only; screenshots section fed from `public/widget/screens/`, images supplied later)

## Goal

Distribute the Android widget from the Solar Sentinel site itself: a link in the web app leads to a landing page describing the widget, showing screenshots, listing a changelog, and offering the latest APK — whose filename embeds the git commit hash it was built from, so you can tell at a glance whether you already have it.

## Design

### Artifacts in `public/widget/`

- `solar-sentinel-widget-<shorthash>.apk` — the latest release APK, exactly one committed at a time (release script replaces the previous; history keeps old ones). `<shorthash>` = `git rev-parse --short HEAD` at build time.
- `manifest.json` — single source of truth for the page:

```json
{
  "latest": {
    "file": "solar-sentinel-widget-7020427.apk",
    "versionName": "1.2",
    "versionCode": 3,
    "commit": "7020427",
    "builtAt": "2026-07-29T19:40:00Z",
    "sizeBytes": 5007486
  },
  "screenshots": ["screens/summary-4x2.png"],
  "changelog": [
    { "version": "1.2", "date": "2026-07-29", "notes": ["Temperature y-axis…", "…"] }
  ]
}
```

- `screens/` — screenshot images; the release script refreshes `screenshots` from this directory's contents (sorted). Empty is fine — the page hides the section.
- `index.html` — self-contained static landing page (inline CSS/JS, no build step, no external assets): dark slate aesthetic matching the app (#0f172a background, amber accents), sections: hero + what-it-is blurb, download button (filename, version, size, built date from manifest), screenshots grid, changelog list, install notes (allow unknown sources; grant location "Allow all the time"; set Battery → Unrestricted on Samsung). Fetches `manifest.json` at load; page works (with a "no release yet" state) if the fetch fails.

Vite copies `public/` into `dist/` verbatim; express static serves it (mime type for `.apk` comes from the mime db). Everything sits behind the same Cloudflare Access as the app — browsers with a session can download directly.

### Release script `scripts/release-widget`

`#!/usr/bin/env bash`, replaces the manual flow: verifies `android/` has no uncommitted changes (warn+abort otherwise — the hash must describe the APK), runs the existing `scripts/build-widget-apk`, computes short hash, copies the APK to `public/widget/solar-sentinel-widget-<hash>.apk`, deletes any previous `solar-sentinel-widget-*.apk`, rewrites `manifest.json`'s `latest` + `screenshots` (via `node` for JSON safety; versionName/versionCode parsed from `android/app/build.gradle.kts`), and prints a reminder to add a changelog entry, commit, and deploy. It does NOT git-commit by itself.

### Link in the web app

A small footer link in `src/index.html` (e.g. "📱 Get the Android widget" → `/widget/`), styled consistently; no JS changes.

## Out of scope

- Auto-update inside the app; multiple hosted versions; delta updates; auth-free public downloads.

## Verification

- `pnpm exec vitest run` stays green (no server changes); `pnpm run build` copies `public/widget/` into dist.
- After deploy: `/widget/` renders with manifest data through the tunnel; APK downloads with correct filename; app footer link navigates there.
