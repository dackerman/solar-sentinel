# Swipe Day Navigation — Design

Date: 2026-07-29
Status: Approved (interactive drag variant)

## Goal

On touch devices, swiping left on the main content moves forward one day and swiping
right moves back one day, with an interactive finger-following drag animation. A small
drag, or a drag that returns to its origin, snaps back and stays on the same day.

## Behavior

- **Interactive drag:** while a horizontal gesture is active, the day-specific content
  tracks the finger via `translateX`.
- **Axis lock:** the first meaningful `touchmove` classifies the gesture as horizontal
  (handled, `preventDefault`) or vertical (ignored; normal page scroll). One decision
  per gesture.
- **Commit rule:** on release, navigate only if the final offset exceeds a distance
  threshold (fraction of surface width) or the release velocity is a decisive flick in
  the same direction as the offset, with a minimum offset floor. Releasing near the
  origin always snaps back — moving your finger back cancels.
- **Direction:** swipe left → `navigateDate(1)` (next day); swipe right →
  `navigateDate(-1)` (previous day).
- **Bounds:** at today / +16 days the blocked direction gets rubber-band resistance and
  always snaps back.
- **Commit animation:** content continues off-screen in the drag direction, the app
  navigates (cache-hit renders are near-instant), then the new content slides in from
  the opposite edge.
- **Exclusions:** gestures starting on the history scrubber (or any `input`) are
  ignored. New touches are ignored while a commit animation is in flight.
- **Reduced motion:** with `prefers-reduced-motion`, no transforms are applied; release
  still navigates if the commit rule passes.

## Architecture

- `src/utils/swipeNavigation.ts` — new module.
  - Pure, unit-tested gesture math: axis classification, rubber-band resistance,
    commit decision.
  - `SwipeNavigator` class: owns touch listeners on a swipe surface, applies
    transforms to a target element, and calls back `canNavigate(direction)` /
    `onNavigate(direction)`.
- `src/index.html` — new `#day-view` wrapper around the day-specific sections
  (current conditions, loading/error, both chart containers). Header and the 16-day
  forecast calendar stay static; the swipe surface is the content area below the
  header, so swipes over the calendar still navigate.
- `src/app.ts` — instantiate `SwipeNavigator`, wiring `canNavigate` to the existing
  date bounds and `onNavigate` to `navigateDate`.
- `src/styles.css` — transition classes for snap-back/commit animation.

## Testing

Vitest unit tests for the pure gesture math (axis lock, thresholds, velocity flicks,
return-to-origin cancel, resistance) in `src/test/`. Existing navigation tests remain
the safety net for date logic. `pnpm test`, `typecheck`, `format:check` must pass.

## Non-goals

- No mouse-drag support on desktop; arrows remain the pointer path.
- No swipe gestures inside the location picker or app menu.
- No change to data loading, caching, or the cache-hit fast path.
