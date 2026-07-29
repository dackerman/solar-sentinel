# Widget Improvements — Design

**Date:** 2026-07-29
**Status:** Approved (scoped with David: all three workstreams; graph = temp line + rain bars + cloud shading)
**Builds on:** 2026-07-28-android-widget-design.md

## Problems / goals

1. **Refresh reliability.** On-device evidence (server logs): after install the widget fetched at 22:16 EDT, then made zero requests for 16.5 h. Samsung One UI app-sleep froze the WorkManager periodic job. Harden the client so launcher-driven triggers and a battery-exemption prompt keep refreshes alive.
2. **Responsive layout.** The summary widget renders a fixed-size 96dp-art row centered in whatever frame it gets; a 4×2 placement is mostly padding. Make it size-aware: fill the given cells, scale art with height, allow 3×1 and up.
3. **Graph widget.** A second widget showing today's curves: temperature line, precipitation-probability bars, cloud-cover shading — the web app's chart feel at widget scale.

## Design

### Refresh hardening (Android)

- `solar_widget_info.xml` (and the new graph widget info): `android:updatePeriodMillis="1800000"` — the launcher's AlarmManager-driven poke survives app-sleep better than WorkManager alone.
- `SolarWidgetReceiver.onUpdate` (and graph receiver): after `super.onUpdate`, call `RefreshWorker.schedule(context)` + `RefreshWorker.refreshNow(context)` — every launcher poke re-anchors the periodic job and fetches.
- `MainActivity`: if `PowerManager.isIgnoringBatteryOptimizations(packageName)` is false, launch `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (manifest gains `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`). Setup text mentions Samsung's Unrestricted battery setting.
- `versionCode` 2, `versionName` 1.1.

### Responsive summary widget (Android)

- `SolarWidget.sizeMode = SizeMode.Exact`; `WidgetContent` reads `LocalSize.current`.
- Art block: shown only when width ≥ 220.dp; its size = (height − 24.dp) capped at 120.dp and at 40% of width.
- Compact mode (height < 90.dp): single dense row — art (if it fits), "91°/68° · UV 6.2/9.1 · Rain ~4 PM" one-liner + updated stamp.
- Regular mode: current column layout, filling the frame.
- Widget info: `minWidth 180dp`, `minHeight 40dp`, `minResizeWidth 110dp`, `minResizeHeight 40dp`, target 3×2 — resizable down to 3×1 and up to full width.

### Graph widget (server + Android)

**Server:** `/api/widget` response gains an `hourly` object for the requested date (all hours of that day, not just remaining): `{ hours: number[], temp: number[], precipProb: number[], cloudCover: number[], uv: number[] }` where `hours` is 0–23 as present in the forecast. Built inside `buildWidgetData` from the existing day-index scan; pure addition, cache-hit path untouched. Tests assert shape and alignment.

**Android:**
- `WidgetData` gains optional `hourly: HourlySeries? = null` (old cached JSON keeps parsing).
- New `GraphWidget : GlanceAppWidget` (SizeMode.Exact) + `GraphWidgetReceiver` + `graph_widget_info.xml` (target 4×2, `updatePeriodMillis 1800000`, resizable, same initialLayout).
- `GraphRenderer.render(hourly, nowHour, widthPx, heightPx): Bitmap` draws with Canvas:
  - background: container's dark slate handled by Glance modifier; bitmap itself transparent
  - cloud cover: per-hour full-height vertical strips, white alpha scaled to cover (max ~18% alpha)
  - precip probability: bottom-anchored blue bars, 0–100% mapped to 55% of chart height
  - temperature: amber polyline normalized to [min−2°, max+2°]
  - "now" marker: thin vertical line at the current hour
  - axis: hour labels 6a / 12p / 6p along the bottom, high/low temp labels top-left
- Header row above the chart: date-less "Today · 79°/59° · Rain ~4 PM" one-liner when height allows.
- `RefreshWorker` updates both widgets (`SolarWidget.updateAll` + `GraphWidget.updateAll`); a single fetch feeds both from the same stored JSON.
- Tap opens the web app (same intent).

## Out of scope

- Per-widget location configuration; night hourly ranges; multi-day graphs; Play Store.

## Verification

- Server: Vitest for the hourly block (shape, full-day inclusion, alignment with mock data).
- Android: JVM test for `HourlySeries` parsing + old-JSON compatibility; renderer and layouts verified on-device (screenshots via the phone bridge if available).
- End-to-end: rebuild release APK via `scripts/build-widget-apk`, reinstall (same signing key → in-place upgrade), watch server logs for the launcher-driven cadence.
