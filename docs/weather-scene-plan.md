# Weather scene: vision, implementation plan, and agent handoff

Updated October 6, 2026, after reference comparison and David's zoomed-out camera suggestion. Repository: `/home/david/code/solar-sentinel`.

## October 6 automatic phone tilt

David confirmed physical phone tilt worked after tapping the phone icon. Preview
client logs confirm both permissions returned granted, orientation readings arrived,
and a camera movement was requested. He then requested automatic tilt without tapping.

`SceneParallax` now defaults to listening on active, secure touch devices even when
`requestPermission()` exists. The presence of that API no longer disables tilt. It
attempts both permission APIs once to reuse an existing grant without a user gesture;
rejections that require activation leave the tap fallback available. Existing sensor
readings can also activate tilt before the permission promise completes. No permission
attempt is made for desktop, reduced motion, insecure contexts, or an inactive scene.
Explicitly disabling working tilt stays off through pause/resume within that page.

First-time permission prompting can still require a tap; the application cannot remove
that browser requirement. Reference: the permission-state/activation steps in
<https://w3c.github.io/deviceorientation/#dom-deviceorientationevent-requestpermission>.
The updated preview is
<https://davids-macbook-pro-1.tail663e6.ts.net/?preview=auto-tilt>.
Automatic startup is regression-tested with previously granted permission, live events,
activation rejection, denial/retry, both API grants, and desktop exclusion. All 289 tests,
typecheck, and the build pass. David tested the updated preview on his phone and reported that tilt started automatically
without tapping the icon. Phone logs independently confirm automatic permission grants,
orientation readings, and camera movement requests on startup.

## October 6 phone tilt diagnosis and frosted metrics

The HTTP Tailscale preview disabled phone sensors. David approved a private HTTPS
Tailscale Serve proxy at <https://davids-macbook-pro-1.tail663e6.ts.net/> forwarding
to this Mac's port 49878. The production Linux hosts are without power; production
deployment remains canceled. The latest diagnostic preview is
<https://davids-macbook-pro-1.tail663e6.ts.net/?preview=tilt-glass>.

Phone tilt is still awaiting physical-device confirmation after the HTTPS switch.
The preview's Android Chrome logs confirm the scene loaded, but the earlier build
had no sensor diagnostics. `SceneParallax` now logs capabilities, listening, missing
readings, permission results, first valid source, and the first movement request.
It never logs raw angles or acceleration. The existing client-log endpoint ships
these state transitions so debugging does not require copying phone logs.

Touch detection also considers `navigator.maxTouchPoints`. Both orientation and
motion permissions are requested directly from the same tap; a granted motion API
can supply the gravity fallback even when orientation is denied. Touch pointer exit
no longer resets calibrated sensor tilt. If four seconds pass without valid readings,
the phone icon becomes a retry action and a visible note explains motion sensor site
settings. Reduced motion and insecure contexts show their reasons instead of silently
hiding the phone control. These changes are regression-tested; actual phone readings
remain unverified until the device visits the updated preview.

The green metrics panel uses a translucent tint, 18px backdrop blur, saturation,
a soft inset highlight, and its existing separators. Put `-webkit-backdrop-filter`
before `backdrop-filter` in source: reversing that order caused the CSS build to
retain only the prefixed alias, disabling blur in Chrome. Compiled CSS and computed
browser styles now confirm both aliases and the blur; desktop and 390px portrait
layouts are visually checked. All 287 tests, typecheck, and the production build pass.

## October 6 pointer and device-tilt parallax

David requested a small perspective change when moving the mouse or tilting a phone.
The main forecast renderer now exposes `setParallax(x, y)`, with normalized input,
clamped camera travel, and an exponential ease at the existing capped frame rate.
The original camera position/target remain the immutable base; near objects shift more
than the distant town. Desktop travel is at most 0.38 m sideways / 0.18 m vertically;
portrait framing permits 0.55 m / 0.30 m. The standalone orbit-controlled demo is unchanged.

`src/components/sceneParallax.ts` maps pointer positions across the hero, recenters on
exit, and ignores touch drags. On phones, the first valid sensor sample defines a neutral
holding position. Relative pitch/roll saturate at 14 degrees and rotate with the screen;
changing screen orientation or resuming recalibrates. Device orientation is preferred,
with gravity-based accelerometer fallback if orientation readings are absent. Shakes,
invalid readings, and tiny sensor jitter are ignored. No sensor readings are stored or sent.

Secure-context mobile browsers without a permission gate start tilt automatically. Where
`requestPermission()` is required, the phone icon requests it directly from a tap; denial
leaves the camera still and the control can retry. The icon also disables tilt. Reduced
motion disables pointer/sensor parallax; pause, minimize, backgrounding, and leaving the
viewport stop sensor listeners and recenter. The scene and text use explicit stacking
layers to keep forecast controls above the moving WebGL backdrop.

Tests cover pointer/touch behavior, relative calibration, bounded travel, angle wrap,
landscape axes, accelerometer fallback, denial/retry, lifecycle, and reduced motion.
Desktop perspective is verified visually in the built browser preview. Actual phone
sensor hardware still needs a physical-device check; browser sensor behavior here is
covered using simulated readings. Sensor API reference:
<https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static>.

## October 6 main-app integration

David explicitly requested integrating the existing village into Solar Sentinel. This
supersedes the earlier instructions to keep forecast integration deferred; the remaining
appearance-study work and its limitations still apply.

- `src/components/weatherHero.ts` mounts the lazy renderer above the hourly chart. The
  desktop hero is wide; portrait mobile fills the first screen with a broader street
  camera, while the standalone demo retains its original camera controls.
- Default is the selected location's current forecast hour. The hour slider samples all
  conditions together, supports backwards scrubbing, and preserves a manually selected
  hour across data refreshes/history snapshots. Date/location changes reset to now for
  today, or midday for another day. Back to now and Day overview are explicit controls.
- The daily overview uses daily high temperature/maxima/code plus mean hourly cloud cover
  at noon; it is labeled as a summary. Hourly temperature, apparent temperature, humidity,
  cloud, precipitation chance, wind, gusts, and meteorological wind direction use the
  selected sample. Text keeps missing measurements as dashes.
- `src/utils/forecastScene.ts` is the pure adapter. WMO weather codes provide artistic
  rain/snow intensity independently from probability; humidity alone never creates fog.
  No ground accumulation is claimed because the current API has no measured snow depth.
  Geometry remains deterministic when scrubbing. Transitions use the short path through
  midnight and wraparound wind angles.
- Weather responses/snapshots now include Open-Meteo's `timezone` and `utcOffsetSeconds`.
  Current hour and date use that IANA timezone. Daylight uses forecast date, latitude,
  longitude, and the date's UTC offset. Old snapshots without timezone metadata use a
  longitude-based standard-time approximation until refreshed.
- `solar_sentinel_weather_scene_minimized` stores compact mode. A minimized startup skips
  loading Three.js/assets; existing scenes pause while minimized, offscreen, hidden, or
  without an available history sample. Reduced motion renders still scenes; the pause
  button stops environmental motion while keeping forecast transitions usable.
- Text and controls paint before a double animation-frame deferral of the dynamic scene
  import. WebGL failures leave the full text forecast and chart accessible. Orbit controls
  are disabled in the forecast backdrop so touch scrolling/day swipes stay usable.
- The unused traveller GLB import is removed from the renderer (assets remain in source),
  preventing an 11 MB unused model from being emitted and service-worker precached.

Browser review covered desktop, portrait mobile, night/backward scrubbing, daily summary,
next-day navigation, pause, compact persistence after reload, and horizontal overflow.
Automated adapter coverage includes location-midnight/timezone/DST, weather-code intensity,
missing wind/old snapshots, polar night, deterministic reverse sampling, and circular
transitions. All 278 tests, typecheck, and the main production build pass. Captures:
[desktop](../../screenshots/weather-hero-desktop.jpg) and
[mobile](../../screenshots/weather-hero-mobile.jpg). The separate built-app preview is
<http://localhost:49878/?preview=weather-hero>. This local integration is not a deployment
or a real-phone GPU benchmark.

## October 6 continuation checkpoint

Implementation resumed from commit `9b8ae2b` in the macOS checkout
`/Users/dackerman/code/solar-sentinel`. The initial R0–R2 layout pass is implemented.
The remaining sections preserve the original reference plan; camera and street inventory
below is superseded by this checkpoint where it describes the old implementation.

- `src/scene/cameraPresets.ts` owns the exact original and user-supplied layout views,
  plus a provisional reference candidate. Layout view is the startup default.
- The view selector chooses which preset Reset camera restores. Mouse edits survive
  viewport resize; aspect remains live and unedited mobile presets use 48° FOV.
- Bokeh is disabled for layout inspection. Its existing implementation is retained for R5.
- `src/scene/streetLayout.ts` owns a continuous flat street from z=20 to z=−48:
  cafe sidewalk x=−3.2..4.1, asphalt x=4.1..10.3, opposite sidewalk x=10.3..11.6.
  Pavement ends at y=0; asphalt sits at y=−0.14. Curbs, slabs, double yellow lines,
  and a midground crosswalk share these coordinates. Ground beneath the street is
  lowered so it cannot cover the road.
- Superseded paving, waterfront water strip, and rail borders are removed. Opposite
  storefronts move across the new road; curbside trees/planters stay on the sidewalk.
  The church moves beyond the opposite shops rather than standing in the roadway.
- Two imported parked cars now replace the composition placeholders (see car-pack update below).
- Surface snow is now implemented by the snow update below; rain darkening remains a placeholder.
- The character remains hidden. Browser verification recorded no GLB requests.

Provisional reference camera (not appearance-approved):

```json
{
  "position": [-1.4, 7.8, 9.8],
  "target": [2.4, 1.5, -13],
  "fov": 44
}
```

Verification: typecheck and isolated scene build pass; changed source files are formatted.
Headless Chrome verified exact user camera exports, orbit edits surviving resize,
Reset restoring the selected layout preset, all five weather presets with motion paused,
no browser errors, and no mobile horizontal overflow at 390px. Desktop canvas is
1102×620. These are correctness checks, not phone GPU performance measurements.
Baseline captures for this pass are stored in `docs/weather-scene/baselines/2026-10-06-layout.png`
and `2026-10-06-reference.png`.

Next: R3–R5, starting with a cafe frontage facing the street. Existing cafe sidewalls
and gabled shells remain visibly unfinished from the elevated view; foliage is still
chunky, hills are still conical, shadow coverage remains narrow, and winter/night styling
in the older environment helpers is incomplete. Do not call this reference parity.

Tooling on this Mac: pnpm is installed through Homebrew (`/opt/homebrew/bin/pnpm`,
Homebrew package 12.9.1); the launcher honors `packageManager: pnpm@9.15.9`.
Start the demo with `pnpm run scene:dev`.

Local preview: <http://localhost:45379/scene-demo.html>. On this Mac the current tailnet
address is <http://100.114.59.77:45379/scene-demo.html>; the old `homoiconicity` hostname
below belongs to the earlier Linux preview host.

## Snow accumulation update

`src/scene/snowAccumulation.ts` adds a shared snow shell to upward-facing surfaces,
including instanced buildings and street furniture, roofs, awnings, chairs, tables,
planters, lamp tops, and imported cars. Continuous sidewalk/road blankets bury seams,
markings, and fallen leaves. Depth grows to 30.48 cm with subtle unevenness; small
flower heads and narrow rails retain less depth than broad surfaces. Dusting uses
world-space patches instead of whitening every material. Hidden ancestor groups are
excluded so the retained character study cannot create floating snow.

The demo now has Light snow and Blizzard presets and an independent 0–12 inch
accumulation slider. Light snow leaves most surfaces bare; Blizzard uses full cover,
40 mph wind, dense snowfall (a bounded pool of 10,000 flakes), and pale snow haze.
Accumulation geometry is built once, refreshed when imported cars arrive, and displaced
by shared shader uniforms while changing weather. Camera movement does not rebuild it.

Verified light snow, blizzard, and the elevated reference view in the browser without
shader warnings/errors. Typecheck, scene build, and two focused regression tests pass
(hidden study exclusion, instanced surface transforms, valid snow-edge normals).
Captures: `docs/weather-scene/baselines/2026-10-06-light-snow.jpg` and
`2026-10-06-blizzard.jpg`. This is an appearance prototype; real forecast accumulation,
seasonal leaf loss, plowing, and physical snow transport are still deferred.

## Car-pack update

David supplied `~/Downloads/generic-passenger-car-pack.zip` and requested imported cars.
The archive was unpacked into `/tmp/solar-car-pack`; the selected blue compact and yellow
sedan are served from `src/scene/assets/cars/`. They replace all primitive car envelopes.
`src/scene/parkedCars.ts` asynchronously loads them and requests a render on completion,
including during motion pause/reduced motion. Tire bottoms align to asphalt at y=−0.14.

The source contains a single FBX scene with individual body and wheel meshes. Conversion
retains each selected body plus its four wheels, removes the pack's display rotations,
and centers/scales each footprint (compact 3.8m long; sedan 4.5m). Original diffuse textures
are resized to 512px JPEG; dark opaque glazing avoids transparency sorting artifacts.
The two GLBs total about 1.49 MB; their five shared/model textures total about 314 KB.
Source and regeneration details are in `src/scene/assets/cars/README.md` and
`scripts/convert-car-pack.mjs`. Car tops now receive the shared snow shell; wetness remains unfinished.

Typecheck/build pass. Chrome verifies all seven model/texture requests return 200,
no browser errors, and imported cars appear in reduced motion. Updated reference capture:
`docs/weather-scene/baselines/2026-10-06-imported-cars.png`.

## Distant village, hills, and lens update

The original low camera is again the startup/default selection, per David's request.
Layout and reference presets remain available. Left-side building shells and attached
cafe details now face the street after a 90° counterclockwise turn; the sidewalk seam
bed is recessed below slab bottoms and edge slabs clear the curbs to prevent z-fighting.

`src/scene/distantVillage.ts` replaces the distant wall of repeated boxes and cone mountains.
It builds deterministic town blocks at three depths with street openings, varied heights,
gabled/flat roofs, chimneys, recessed windows/sills, side elevations, and occasional shop
awnings. Three continuous terrain ridges have broad irregular summits, progressively cooler
colors, and low-detail woodland crowns seated into the slopes. Instancing keeps repeated
parts together; distant meshes do not cast into the near-street shadow map.

Desktop bokeh is restored at aperture 0.00022 and max blur 0.006. Focus follows 82% of the
camera-to-orbit-target distance so edited framing and the low/elevated presets have a useful
midground focal zone. Mobile stays sharp below 600px. This is restrained artistic depth
of field; final lighting/material work may justify retuning it.

### Proposed first texture batch

Generate reusable material tiles, starting with brick, paving, and asphalt. The existing
facade/prop silhouettes still need modeling work; textures should supply surface detail.

| Priority | Tile | Visual target | Application |
| --- | --- | --- | --- |
| 1 | Cafe brick | Warm russet/clay, slightly irregular brick faces, thin pale mortar, restrained wear | Near cafe and selected storefront walls; maintain a consistent real brick scale on front/side walls |
| 2 | Sidewalk concrete | Warm grey fine grain, gentle aggregate variation and worn edges; no large cracks or drawn slab grid | Individual existing slab faces; geometry owns the joints so texture repetition cannot create conflicting seams |
| 3 | Asphalt | Charcoal fine aggregate, muted mottling, sparse tiny grit; no markings, leaves, or puddles | Road surface; existing markings and weather effects remain separate |
| 4 | Roof slate | Muted blue-grey/slate or charcoal shingles, restrained row rhythm | Gable roofs; flatter parapet buildings use a simpler dark roof surface |
| 5 | Painted plaster/stone | Cream mineral grain with modest color variation | Upper facades, sills, planters, and church masonry |
| 6 | Timber and bark | Warm weathered slats; separate dark branching bark grain | Bench/awning supports and tree trunks with deliberate longitudinal UVs |

Generation brief for the first three: a square seamless tile photographed/rendered straight
on, diffuse neutral illumination, no perspective, cast shadows, directional sun, highlights,
text/signage, objects, leaves, or borders; cozy stylized material with small-scale detail.
Use 1024px masters, derive 512px served variants, and trial each on its actual geometry at
both low/elevated cameras before multiplying variants. Preserve muted midtones so the
existing lighting supplies the warmth. Brick should be the first close-crop trial.

Albedo is sRGB; roughness/normal maps are linear. Derive restrained roughness and normal
maps from coherent surface structure, not arbitrary noise; keep these materials nonmetallic.
Set texture repeats from world dimensions, with explicit wall and roof UV treatment rather
than stretching one square image across every box. Keep snow coverage, wetness, fallen
leaves, glazing reflections, and emissive window interiors separate from baked albedo.
Do not generate large facade pictures containing windows/doors; those already have geometry.
No new raster textures have been generated yet—this is the proposed asset batch.

## Street furniture and narrower sidewalk update

Cafe sidewalk is now x=−3.2..2.7 (5.9m wide, reduced by 1.4m). Road width stays 6.2m;
opposite curb moves to x=8.9 and its sidewalk ends at x=10.2. Opposite storefronts,
parked cars, church, bench, planter groups, and curb foliage follow the new layout.

`src/scene/streetFurniture.ts` supplies eleven framed lantern posts, six slatted bins,
and three round pedestal dining tables with two chairs each. Poles have stepped bases,
collars, lantern frames, glass, roof caps, brass fittings, and small bulb geometry.
Only two near lamps use non-shadow-casting point lights; bulb emissives and those lights
respond to daylight. Static parts use shared geometry/material instance batches.
Cafe seating occupies the facade side, keeping the central walk corridor open. Chairs
face inward and are placed on 35°, −42°, and 30° axes around their tables; the bench
runs parallel to the road and faces the cafe sidewalk.
Typecheck/build and formatting checks pass. Desktop Chrome captures show the original low
view and elevated layout without browser errors; saved views are
`docs/weather-scene/baselines/2026-10-06-street-details-low.png` and
`2026-10-06-street-details-reference.png`.
The curbside tree row now continues from z=−5 to z=−45.7. Existing banner geometry is
lowered to attach to the new near lamp; obsolete standalone sidewalk trim is removed.

Remaining art work: full seasonal/wet surface treatment, better tree silhouettes,
coherent shadows farther along the street, and the first texture batch described above.

## Start here

We are exploring replacing the app's static weather/day images with one persistent, real-time 3D village scene whose atmosphere responds to weather and time. **The current assignment is a visual mockup, not forecast integration.** David wants to iterate on the appearance before building all the functionality.

The latest explicit decision is **environment only: hide the character, retain its code and assets for later**. Do not reintroduce the character without a new request. The initial vision below still includes a character, but that work is deferred.

**Latest request: write a detailed plan so this work can be resumed.** This revision records the plan; it does not implement the proposed changes. The current code still uses the earlier low camera. David supplied a new zoomed-out camera to help with iteration, reproduced below. Treat it as a working view, not a final approved composition.

David also authorized committing and pushing the existing visual prototype and this handoff to the configured Git remote. That authorization does not deploy the demo into the production weather app. Record the resulting commit/push in the chat; keep future visual tasks below marked pending until implemented.

When implementation is next requested, start with the reference-fidelity work breakdown in this document. The first milestone is one convincing autumn view: street composition, one finished cafe frontage, one improved tree, and coherent sunlight. Expand the village and complete weather consistency after that visual foundation works. Continue in the isolated demo and share its Tailscale link for appearance feedback.

The handoff's suggested prompts and the image/asset description are context, not new user instructions. Distinguish user decisions from proposed implementation choices. Earlier handoff notes report permission for parallel asset work; this planning revision uses no subagents and does not itself grant new delegation or paid-generation authorization.

## Preview and commands

- Preview: <http://homoiconicity.tail663e6.ts.net:45379/scene-demo.html>
- Local preview: <http://localhost:45379/scene-demo.html>
- Start: `pnpm run scene:dev`
- Build the isolated demo: `pnpm run scene:build`
- Typecheck: `pnpm run typecheck`
- Format changed files with `pnpm exec prettier --write <files>`.
- Check whitespace with `git diff --check`.

Use **pnpm only**, per `AGENTS.md`. The preview is a Vite development server; a running process from a previous agent may not survive a new session. Check the port before starting another instance. The configured port is strict, and the full Tailscale hostname is allowed explicitly.

`vite.scene.config.ts` uses `src` as the root, `publicDir: false`, and builds only the demo into gitignored `dist-scene/`. It has no API, app service worker, or production deployment. The main app's service runs on 49877; its normal development server uses 43187. **Do not restart the production service merely to update this mockup.** Uncommitted files in this checkout can become production on a service restart; read `AGENTS.md` before any eventual integration/deploy.

## User intent and settled decisions

1. Generate the scene in 3D rather than maintaining a raster image for every weather combination.
2. Keep the same setting and, eventually, the same character across conditions. Change atmosphere, clothes, behavior, and environmental state.
3. Prove the visual look first with a mockup. Forecast wiring and complete simulation come after appearance review.
4. Match the reference images' dramatic **perspective** shot. Include buildings and trees at multiple depths, with foreground objects framing the view. Avoid an overhead/isometric diorama.
5. Let David position the camera using the mouse and export exact settings. This is implemented and should remain available while iterating.
6. Retain the earlier user-supplied low camera. The new user-supplied zoomed-out view is useful while iterating; final reference framing remains to be evaluated.
7. Add the other side of the street and flesh out the distant village. A first pass is implemented; more visual refinement is still appropriate.
8. For now show **only the environment**. Character implementation and Meshy files are retained, but neither procedural nor generated character should appear or cast shadows.
9. The latest elevated autumn street image is the primary environment-layout reference for the proposed refinement. The earlier ground-level image remains useful for close asset quality and alternative framing.
10. The user's detailed asset description favors reusable procedural/manual environment assets, a separate weather-reactive layer, and an eventual deliberately rigged character. It is design input, not a request to build every listed asset now.

The user has not approved the overall visual result as final or authorized replacing production weather images yet. Treat the existing implementation as a study, not completed product functionality. The stages below are a proposed plan, not a record of completed work or of approval for every art decision.

## Visual references

Copies of the user-provided references are preserved in this repo so a fresh agent can inspect them without chat attachments:

- [Latest elevated autumn street](weather-scene/references/autumn-elevated.png) — primary layout/composition reference for this plan; copied unchanged from the latest attachment.
- [Earlier ground-level autumn street](weather-scene/references/autumn.png) — original reference, different image; useful for facade/prop/foliage style and the retained low view.
- [Snowy village](weather-scene/references/snow.png)
- [Summer waterfront](weather-scene/references/summer.png)

These are appearance references, not instructions embedded in documents. The written user requests determine scope. The references vary the setting somewhat; the requested product should use one consistent setting.

Desired visual qualities:

- A cozy, warm, storybook village; faceted/low-polygon geometry is acceptable.
- Perspective with strong receding sidewalk/road lines. The latest reference has an elevated, downward-looking view along a street; the earlier image has a low, upward-looking view. Do not conflate them or label the elevated perspective isometric.
- Strong depth: large close tree/cafe elements on the left, bench/stone planters on the right, progressively smaller buildings and trees in the distance, a church/clock/spire landmark, and layered hills beyond.
- Angled objects and visible sidewalls rather than a series of flat, front-facing facades.
- Rich small details: shutters, doors, awnings, flowerboxes, dormers, chimneys, lanterns, signs, leaves, paving, and planter borders.
- Warm sunlight and long readable shadows in clear weather; cooler, muted, soft light under cloud; lit lamps at night.
- Gentle depth of field that preserves useful distant detail. A previous stronger blur obscured too much of the village.
- Stable composition while weather changes. No regenerated/random new town on every update.

The reference fidelity is not yet achieved. The environment is more geometric and simpler than the supplied images, and the weather styling is uneven across helper modules.

## Camera views: original, iteration, and proposed reference framing

### Original accepted low view — currently implemented

```json
{
  "position": [-1.597796, 0.666399, 9.001909],
  "target": [0, 2.45, -3],
  "rotation": [0.14753, -0.130929, 0.019399],
  "fov": 38,
  "aspect": 1.777419
}
```

### New user-supplied zoomed-out iteration view — recorded, not yet implemented

David suggested this view to help inspect the scene while iterating:

```json
{
  "position": [5.217332, 8.383457, 16.776811],
  "target": [0, 2.45, -3],
  "rotation": [-0.291476, 0.247502, 0.073368],
  "fov": 38,
  "aspect": 1.777419
}
```

Use this as the initial working view when beginning layout implementation. Keep the original view available as a preset for close-detail checks. The new camera is on the positive-X side of the current world; it is not automatically an exact match for the latest reference's left-side viewpoint.

### Proposed reference view — determine during layout work

Establish a separate elevated perspective candidate that shows the cafe sidewalk across the left/center, road on the right, and the distant town near the upper-right. Export its actual settings after visual comparison. No numerical preset or final camera approval exists for it yet. Keep the user-supplied working view available even if the reference candidate changes.

The code sets position and OrbitControls target, deriving orientation with `lookAt`/controls. Euler rotation is exported in radians for inspection; do not independently apply both rotation and target with conflicting results. Aspect comes from the actual viewport rather than being hardcoded to the exported value. Desktop scene is 16:9; the existing mobile framing uses a wider 48-degree field of view.

The default position is set both when creating the camera and when resetting/resizing before the user edits it. Consolidate these into shared presets during camera work so reset and resize cannot restore different settings. Preserve user-edited positioning on resize. Current clipping range is 0.1–180, and the sky dome radius is 140 so it does not cover distant hills. The elevated working view will need a new depth-of-field focus; do not reuse 7.9 blindly or change depth of field merely to hide unfinished geometry.

Controls:

- Left-drag: orbit.
- Right-drag or Shift-drag: pan.
- Wheel: zoom.
- Touch: one-finger orbit, two-finger pan/zoom.
- Currently Reset camera restores the original default. Planned behavior: restore the selected view's preset; selecting another preset also changes which view Reset restores. Arbitrary user edits are still exported.
- Live JSON exports position, target, rotation, FOV, and aspect.
- Copy camera settings uses the clipboard where available; on the HTTP Tailscale URL, it can select the textarea and instruct manual Ctrl+C/Command+C instead.

## Current implementation inventory

| File | Responsibility |
| --- | --- |
| `src/scene-demo.html` | Standalone page, scene viewport, weather overlay, presets, camera panel, six atmosphere sliders, pause/retry UI. |
| `src/scene/demo.css` | Demo layout, desktop 16:9 viewport, mobile layout, overlays, controls. |
| `src/scene/demo.ts` | Mock presets, slider-to-scene mapping, camera export/copy, renderer lifecycle, visibility pause, preset labels. |
| `src/scene/weatherScene.ts` | Three.js scene, camera/OrbitControls, sky, lights/shadows, base village and paving, clouds, rain/snow/leaves, accumulation/puddles, interpolation, rendering/disposal. |
| `src/scene/referenceEnvironment.ts` | Instanced foreground tree/foliage, continuous village, seven detailed right-side buildings with street-facing features, distant town/hills, church/clock, flowers, borders, leaves. |
| `src/scene/villageDetails.ts` | Additional cafe facade/sign/chalkboard/banner and small environment details; canvas textures and owned resource cleanup. |
| `src/scene/referenceCharacter.ts` | Preserved procedural character study with clothing fades, hair/scarf movement, accessories. Hidden. |
| `src/scene/assets/traveller.glb` | Preserved textured Meshy character, about 9.65 MiB. Not loaded in the current environment-only view. |
| `src/scene/assets/traveller-walking.glb` | Preserved rigged/walking Meshy character, about 10.62 MiB. Not loaded in the current view. |
| `src/types/weatherScene.ts` | Scene state and renderer interface. |
| `src/utils/weatherScene.ts` | Numeric clamp and scene-state interpolation. |
| `vite.scene.config.ts` | Isolated demo dev server/build. |

Three.js is pinned to `0.186.1`, with `@types/three` `0.186.0`. `package.json`, lockfile, and `.gitignore` contain the supporting demo changes. At the start of this handoff revision, these changes and new scene files were uncommitted; David subsequently authorized committing/pushing the prototype and documentation. Inspect the actual Git state when resuming and preserve any intervening work.

### Rendering and lifecycle

- ACES tone mapping, sRGB output, hemisphere/sun/fill lighting, soft shadows.
- DPR capped at 1.5 and rendering throttled around 30 fps.
- EffectComposer with RenderPass, BokehPass, and OutputPass. Current bokeh focus 7.9, aperture 0.00045, maximum blur 0.012; disabled on narrow viewports.
- Numeric weather targets blend using smoothstep over approximately 1.1 seconds.
- Render work pauses when hidden/offscreen. User motion pause is separate from visibility pause; changing weather or camera still requests a render.
- Reduced-motion behavior limits ongoing animation and settles weather changes immediately.
- Geometry/material/texture/control/postprocessing cleanup is implemented, with WebGL unavailable/retry handling.
- Helper geometry is generally instanced by material to contain draw calls.

### Character is intentionally disabled

`weatherScene.ts` currently has `showCharacter = false`, hides the procedural root, and guards the GLTF loader behind that flag. There should be no character download during normal viewing. The procedural helper is still constructed and updated, which could be made lazy later if worthwhile. Retain the implementation and asset provenance; do not spend time completing wardrobe/behavior until requested.

### Stylesheet regression and fix

The user encountered a fully unstyled page where the canvas became a 150px-high strip. The stylesheet had been imported through the demo JavaScript. It now loads explicitly from `<link rel="stylesheet" href="/scene/demo.css">` in `scene-demo.html`, and the JS CSS import was removed. Preserve this direct loading arrangement. The fixed desktop render was verified at 1102×620 in a 1280px-wide browser with no horizontal overflow.

## What the mockup does—and does not do

Implemented illustrative presets: autumn breeze, light snow, snow day, blizzard, summer heat, rainy evening, clear night. Sliders cover temperature, wind, precipitation, snow accumulation (0–12 inches), cloud, humidity, and hour. Cloud/sky/light/particle changes and raised surface snow are visible.

The demo makes deliberately simple assumptions:

- Temperature values are Fahrenheit; wind is mph. Other scene quantities are mostly normalized 0–1.
- The precipitation slider drives visual rain/snow intensity directly. It is **not** real precipitation amount.
- Rain versus snow switches at 32°F in the mock mapping.
- Daylight uses fixed illustrative dawn/dusk hours, not actual sunrise/sunset or location/date.
- Snow accumulation is an independent artistic depth control, not accumulated weather history.
- Feels-like and heat are illustrative calculations, not actual API values.
- `snowAccumulation.ts` extracts upward-facing surfaces across the village and loaded cars. Artistic season/leaf loss and full foliage wind animation remain unfinished.
- The retained Meshy outfit is a single winter outfit. Generated clothing was never made dynamically swappable.
- There is no selected-date forecast adapter, daily/hourly switch, actual hourly scrubber, or app integration.

Do not describe these as completed forecast simulation. The footer intentionally labels this a mockup with illustrative weather.

## Reference comparison and current baseline

On October 6, the current demo was rendered in headless Chromium at the original low camera. The page reported no browser errors, a 1102×620 canvas, and no horizontal overflow. That screenshot is preserved at [original-view baseline](weather-scene/baselines/2026-10-06-original-view.png). This verifies the current page renders; it does not verify the proposed elevated layout or real phone performance.

The latest reference has several defining relationships:

- The cafe occupies the left edge with substantial upper brickwork, broad charcoal awnings, tall dark glass, cream trim, and warm visible interiors.
- A broad slab sidewalk fills the left/center foreground. Its curb borders an asphalt road on the right, with double yellow lines, a crosswalk, parked vehicles, and a separate opposite sidewalk.
- Trees, lamps, benches, and planters overlap and diminish down the street. They form groups around a clear walking corridor rather than uniform decorative borders.
- Close orange foliage crops into the left/bottom edges. Midground crowns show irregular branches, gaps, layered foliage, and leaf-shaped edges.
- A church and small town remain identifiable in the distance, with rounded wooded hills and restrained atmospheric haze beyond them.
- Warm directional sun produces bright foliage edges, long readable shadows, cooler shaded pavement, and contact shadows beneath props. Most materials remain matte; glass and wet surfaces supply selective reflections.

The existing demo's largest differences, observed in both the screenshot and source:

| Area | Current study | Refinement target |
| --- | --- | --- |
| Composition | Near-ground camera looking upward; central pale paved lane | Elevated perspective showing a broad cafe sidewalk and a distinct road to its right |
| Street | Paving and background strips from multiple helpers; no coherent asphalt road, markings, crosswalk, or cars | One coordinated street layout with continuous surfaces and meaningful curbs |
| Architecture | Small pale windows, pastel blocks, repeated prominent gabled/pyramidal roofs | Brick storefront rhythm, taller ground-floor glazing, charcoal awnings, visible sidewalls, varied parapets/rooflines |
| Foliage | Dodecahedron clusters with solid chunky silhouettes | Branching crowns, varied cluster scale, recognizable outer leaf shapes, luminous warm edges |
| Materials | Mostly solid-color surfaces and hard box edges | Selective bevels, subtle brick/paving grain, restrained roughness variation, darker recessed glass |
| Detail placement | Large bench/lamp prominent at low view, scattered small borders | Cafe furniture and flower groups that reinforce scale, depth, and sidewalk use |
| Distant scene | Church/town softened substantially by current bokeh | Readable landmark, overlapping smaller buildings, rolling wooded hills |
| Weather consistency | New environment ignores snow cover and wind; applies low emissive color to all materials at night | Explicit surface/foliage/motion/light roles across the full environment |

The visual hypothesis is that composition, one strong facade, one strong tree, and lighting will make the largest early difference. More object count alone is not an acceptance criterion. Primitive modeling is appropriate, but the reference finish also requires surface treatment, proportion, and careful light/shadow placement.

## Proposed asset and scene organization

Keep one persistent deterministic village. Reuse the current Three.js renderer, transitions, controls, and resource lifecycle. Consolidate overlapping builders as their geometry is replaced; a wholesale renderer rewrite is unnecessary.

Use three responsibilities:

1. **Static layout and asset construction:** street surfaces, building shells/facades, furniture, parked cars, and distant silhouettes. Placement is reproducible and changes only when deliberately editing the layout.
2. **Weather-reactive surfaces and motion:** foliage, leaf scatter visibility, airborne leaves, sky/clouds, rain/snow, snow cover, wetness, banners, and light intensity. These respond to shared state without regenerating the village.
3. **Character:** retained code/assets, hidden and unloaded in normal viewing. Later wardrobe/rigging work stays separate from environment construction.

An asset can cross categories: a lamp has a static frame and a reactive light; a bench has static geometry and a snow/wetness surface. Record those capabilities explicitly instead of recoloring every material indiscriminately.

Suggested module boundaries, to introduce only as needed:

| File or area | Planned responsibility | Rationale |
| --- | --- | --- |
| `src/scene/cameraPresets.ts` (new) | Original and iteration camera presets; eventual exported reference preset | A single source prevents create/reset/resize divergence. |
| `src/scene/environment/layout.ts` (new) | Street dimensions, placement records, deterministic seed, sidewalk/road height sampling | Building, curb, tree, and prop positions need a common ground definition. |
| `src/scene/environment/materials.ts` (new) | Shared palette/textures plus semantic weather roles | Reuse surfaces while distinguishing glass, pavement, foliage, stone, metal, and emissive windows. |
| `src/scene/environment/street.ts` (new) | Slabs, curbs, asphalt, markings, crosswalk | Replace overlapping ground pieces with one coordinated street. |
| `src/scene/environment/architecture.ts` (new) | Building/facade kits, shop interiors, church, distant buildings | Reuse proportions/details with controlled variants. |
| `src/scene/environment/vegetation.ts` (new) | Branching trees, foliage clusters, flower groups, static leaves | Unify visual language and preserve seasonal/wind control. |
| `src/scene/environment/props.ts` (new) | Cafe furniture, benches, lamps/banners, planters, bins, simple cars | Repeat one polished reusable asset rather than hand-positioning unrelated primitives everywhere. |
| Existing `referenceEnvironment.ts` | Assemble layout/builders and expose update/dispose | It can remain the integration point while internals are gradually replaced. |
| Existing `villageDetails.ts` | Retain useful sign textures/details; migrate overlapping pieces incrementally | Preserve the cafe identity and avoid double construction or double resource ownership. |
| Existing `weatherScene.ts` | Renderer, camera, lights, shared weather/animation, particles, composition/lifecycle | Keep infrastructure stable during art iteration. |

These paths are proposed, not existing files. Start with camera/layout and the builders needed for the first milestone; do not create empty scaffolding for the entire table. Local TypeScript imports continue to use `.js` extensions. Shared geometries/materials/textures have one disposal owner; instance roots and motion registrations are released with their environment.

### Asset strategy and style rules

- **Procedural/manual first:** road, slabs, curbs, modular buildings, trim/windows/awnings, tables/chairs, benches, lamps, planters, bins, church, hills, clouds, leaves, rain/snow, and most vegetation.
- **Optional external authored assets:** one or two cars or distinctive decorative props if a procedural trial visibly limits quality. Evaluate fit, pivot/orientation, material compatibility, license, size, and cleanup before adopting them. No external dependency or purchase is required by this plan.
- **Optional Meshy:** selected secondary props only after the style is established. New spending needs task-specific cost approval; previous character credits do not cover it. Roads/buildings/trees/weather remain controllable procedural systems.
- **Deferred character:** the existing generated character is a retained study, not the final wardrobe system. Future production character work needs compatible rigging, clothing attachment, and deliberate facial/hair/scarf control.
- Treat the user's suggested 30–40 meshes as an asset-family estimate, not a target object count or required folder of 40 GLBs. Code-generated geometry need not be exported to GLB merely to satisfy a conceptual asset list.
- Detail by projected size: bevels and richer geometry on close silhouettes, simplified repetition in the midground, low-detail silhouettes/instances in the far town and forest.
- Use a restrained family of brick reds, cream stone, charcoal awnings/metal, warm timber, dark glass, and saturated foliage. Variation should reinforce an asset's form rather than give every small piece an unrelated color.
- Preserve faceting without making every surface equally coarse. Broad maple outlines and branch structure matter more than arbitrary polygon reduction.

## Reference-fidelity implementation work breakdown

All tasks below are pending. Dependencies establish an order for implementation, not an instruction to start it during this planning request. Complete and visually inspect each milestone before expanding its detail.

### R0 — Re-establish the baseline and comparison setup

**Depends on:** a future request to continue implementation. **Unblocks:** R1–R2.

1. Read this document and `AGENTS.md`, inspect `git status`, and preserve existing changes. Reopen both autumn references; the elevated image is the layout target and the low image is a close-quality reference.
2. Check whether the port-45379 demo already responds before starting `pnpm run scene:dev`. Do not start a duplicate server or restart the production service.
3. Render the current original view and compare with the preserved baseline. Record any intervening code changes rather than assuming this document's screenshot is current forever.
4. Use a consistent 16:9 canvas for image comparison. Capture the canvas alone for art review and a full-page shot for layout/control review. A temporary overlay-hide option may help inspect composition, but preserve the normal weather overlay.
5. Record renderer draw calls, triangles, frame time, and viewport/DPR from a small bounded debug capture if instrumentation is added. Initial budgets should follow measurement; no phone performance number has been established.

**Done when:** the page is reproducibly renderable, baseline/reference differences are visible, and the implementation state is understood.

### R1 — Camera presets and working view

**Depends on:** R0. **Unblocks:** R2, R3, R4, all consistent screenshot comparisons.

1. Store original and iteration position/target/FOV in one preset source. Preserve exported Euler values as provenance; derive actual orientation from position/target through OrbitControls.
2. Add clearly named view choices such as `Original view` and `Layout view`. Start layout work in David's exact zoomed-out view. Keep arbitrary mouse positioning and camera JSON export.
3. Define reset as restoring the selected preset. Consolidate initialization/resize/reset use of the preset; resizing an edited view must preserve position/target. Continue using live viewport aspect and the existing deliberate mobile FOV behavior.
4. Add a reference candidate only after framing it visually in R2. Do not overwrite either user-supplied preset or invent a final accepted view.
5. Disable bokeh for the initial layout comparison, then tune focus per view after establishing depth. The current focus 7.9 is specific to the low scene.

**Done when:** the layout preset exports the supplied position/target/FOV to the existing six-decimal precision, original view remains available, and orbit/pan/zoom/reset/export/resize work across presets.

### R2 — Street composition and coordinated ground

**Depends on:** R1. **Unblocks:** R3–R7 and reliable placement/weather surfaces.

1. Create one layout definition with a common scale: broad cafe sidewalk on the left, curb, two-lane asphalt road, curb, opposite sidewalk/storefronts. Keep the cafe walking corridor wide enough for furniture, planters, and future character placement.
2. Greybox building envelopes, trees, lamps, bench/planter groups, cars, and landmark. Arrange near/middle/far depths with intentional overlaps; avoid equal spacing and a centered symmetrical corridor.
3. Define ground elevation from distance along the street. Begin with flat or a gentle grade; use the elevated camera first to produce depth. Introduce a downhill grade only if it improves the reference read. Derive slabs, curbs, props, tree bases, markings, and parked-car positions from the same height function so objects do not float.
4. Build broad concrete slabs with subtle seams and restrained color variation. Add curb returns/tree openings where useful; retain a visually continuous asphalt road. Use slightly offset marking geometry to avoid z-fighting, with double yellow lines and a crosswalk placed in the midground.
5. Remove replaced paving/ground strips from both existing helpers as the new surfaces are integrated. Review the old water strip and rail borders; retain them only if they fit the street scene rather than inheriting waterfront geometry accidentally.
6. Frame a separate elevated reference candidate: cafe left/center, road on the right, vanishing region toward the upper-right, town/hills visible beyond. Judge by image relationships; world coordinates may change as layout develops.
7. Inspect the layout view for intersections, exposed ground gaps, hidden backfaces, and blank sidewalls. Inspect the original view for useful close asset scale; do not force two different cameras to reproduce the same screen composition.

**Done when:** without detailed materials the sidewalk/road split, cafe zone, opposite street, and distant town are unmistakable. Record a screenshot and the candidate camera before adding detail.

### R3 — One finished cafe frontage

**Depends on:** R2. **Unblocks:** R6 and the first autumn milestone.

1. Build one brick cafe frontage at the primary viewing distance: two/three-story shell, cream base/trim/cornice, tall ground-floor glazing, framed door, upper windows, broad charcoal awning, parapet/roof edge.
2. Give windows depth: outer frame, recessed dark glass, mullions, sill. Add a few warm interior surfaces, counters/seating silhouettes, and hanging lights behind the glazing. Avoid a uniformly bright opaque window block.
3. Use a subtle tiled brick surface treatment with coherent scale. Prefer textures/procedural material detail for mortar and grain; model trim/recesses that alter silhouette and cast useful shadows. Do not construct every brick as a separate mesh.
4. Shape the awning with sloped fabric panels, seams/valance, and plausible supports. Make it readable as a broad canopy, not an unrelated row of strips.
5. Preserve or refine the `Maple & Moss` identity and chalkboard textures. Integrate the sign, entrance, window boxes, and planters with the new facade; remove their superseded counterparts from the old builders.
6. Add selective bevels to close stone, timber, and frame edges. Reuse geometry and material variants. Check building sidewalls because the elevated layout camera will expose them.

**Done when:** a close crop reads as a cozy brick cafe with broad awnings and warm interior depth; the frontage also supports the full street composition. It does not rely on blur to disguise flat geometry.

### R4 — One finished tree and leaf vocabulary

**Depends on:** R2. **Unblocks:** R6–R8 and the first autumn milestone.

1. Create a reusable tree with a tapered trunk, asymmetric main forks, smaller branching directions, and an irregular crown. Preserve a few visible openings and varied heights rather than a solid sphere.
2. Use faceted foliage masses within the crown, with smaller leaf-shaped clusters at its boundary. Build a small maple/oval leaf vocabulary for near silhouettes, fallen leaves, and airborne particles. Fully modeled individual leaves throughout every tree are unnecessary.
3. Use coherent yellow/orange/rust crown variation, including brighter outer edges and darker inner areas. Prototype a restrained backlit appearance; compare ordinary lighting first before adding a foliage shader.
4. Add cropped foreground foliage to left/bottom framing, sized for its screen footprint. Keep the main sidewalk and far landmark readable.
5. Separate foliage batches from static building/flower batches even when colors match. Register tree/branch motion and base transforms so wind can deform the relevant pieces without moving trunks or rebuilding the world.
6. Define season as a separate artistic input or preset property, independent of current temperature. A warm October hour should not automatically turn all leaves summer-green. Prepare foliage visibility/color and bare-branch behavior for R8.

**Done when:** the close crown reads as foliage rather than stones, the silhouette has branch/gap structure, and its reduced-detail variant still reads at town distance. Seasonal and motion responsibilities have clear owners.

### R5 — First autumn milestone: composition, cafe, tree, sunlight

**Depends on:** R3 and R4. **Unblocks:** extensive replication in R6–R7; final weather polishing in R8.

1. Establish warm directional sunlight and cooler shaded fill. Adjust sun direction, exposure, and material colors together; avoid compensating for flat forms solely with saturation or ambient brightness.
2. Fit the shadow coverage to the new visible street and preserve near detail. Check the current 1024 map and tight frustum against the elevated layout; evaluate changes by measured cost and visible improvement, not by an automatic resolution increase.
3. Make shadows attach furniture/tree bases to the ground. Use simple authored contact shading where useful; additional screen-space effects are optional experiments after the baseline works.
4. Keep cafe glazing dark enough to show frames/interiors and foliage bright enough to show sunlit edges. Add subtle brick/stone/paving roughness and grain without overwhelming the stylized scene.
5. Reintroduce only gentle depth of field after the still reads clearly. Focus on the cafe/sidewalk zone and preserve recognizability of the town/church. Never use haze/blur as a substitute for missing background forms.
6. Capture reference-candidate, user layout, and original views under the same autumn settings. Compare silhouette/composition first, then material and light quality. Share the preview for feedback when appropriate.

**Done when:** one autumn still has the target sidewalk/road relationship, convincing cafe and foliage, and coherent directional light. This is the first appearance-review milestone; it is not a claim of reference parity or production readiness.

### R6 — Furniture, flowers, vehicles, and near street detail

**Depends on:** R5. **Unblocks:** R7–R8 final dressing.

1. Create a small prop kit: round pedestal cafe table; simple readable chair; A-frame sign; slatted bench with stone/metal supports; framed lantern/post; banner; stone/wood planter; slatted trash can.
2. Add flower groups with green support foliage and yellow/orange/red blooms. Vary mass, height, and edges; expose inset soil/rims where appropriate instead of filling each planter with identical blobs.
3. Place two or three cafe groups, bench/planter groups along the curb, and receding lamps. Keep a clear walk corridor, avoid collisions with tree bases/awnings, and use consistent real-world proportions across assets.
4. Prototype a parked car with shaped body/roof, dark windows, wheels, and lights. If the silhouette is adequate at its distance, produce a small set of recolored variants. Evaluate an authored replacement only if the simple asset visibly limits the scene; no new paid generation is implicit.
5. Scatter fallen leaves using deterministic density masks: more around tree bases, planters, and gutters; less in walking/road centers; occasional broad leaves for close readability. Share the leaf vocabulary with airborne particles.

**Done when:** the sidewalk feels used and the road feels like a street, with detail density concentrated where visible. Instancing/shared assets contain repetition cost and layout remains legible.

### R7 — Opposite storefronts, far town, and rolling wooded hills

**Depends on:** R5, with final prop placement from R6. **Unblocks:** R8–R9.

1. Expand the facade kit into a restrained family: brick cafe, brick storefront, pale stone/stucco building, corner variant. Vary width, height, awnings, trim, window rhythm, and roofline while retaining style and scale.
2. Arrange buildings in overlapping depths with visible street-facing and side elevations. Use flatter parapets prominently near the cafe; retain gables where they fit the distant town. Avoid a repeated pyramid roof skyline.
3. Position the church beyond the storefronts rather than as a giant central object. Model nave/roof/tower/spire and a few readable windows; use the reference candidate to judge its scale and separation.
4. Replace cone-like isolated peaks with layered rolling hill silhouettes. Use low-detail displaced/triangulated terrain or broad shaped meshes, with distant autumn woodland instances/clusters. Decrease contrast/saturation with depth and keep sky/far clipping coordinated.
5. Add far-town blocks at enough different distances to create a village rather than a single flat wall. Use lower geometry/material detail and restrained fog. Check visibility from the user layout view as well as the reference candidate.

**Done when:** buildings, trees, town, church, wooded hills, and sky form distinguishable depth layers. Far details remain readable; nearby backs/sides are coherent when orbiting.

### R8 — Consistent weather across the improved environment

**Depends on:** R4's reactive registrations and R6–R7's final assets. **Unblocks:** R9. Register capabilities while building earlier stages, then complete their visual behavior here.

1. Extend the environment update boundary to receive shared weather and artistic season/surface state rather than only temperature/snow/daylight. Preserve existing Fahrenheit/mph and normalized quantities. Keep forecast data adaptation deferred.
2. **Wind:** derive direction/strength/gust phase once; drive tree/foliage motion, banners, drifting leaves, clouds, and rain/snow angle coherently. Preserve base transforms and phase variation. Prototype one tree before selecting group motion versus shader deformation for repeated foliage.
3. **Winter:** season controls leaf loss/color; snow cover controls caps on upward-facing roofs, awnings, slabs, benches, and planter rims. Hide flowers/fallen leaves appropriately, expose bare branches, and keep surfaces from intersecting or z-fighting. Do not make all vertical walls white.
4. **Rain:** darken pavement/stone/timber modestly, reduce roughness on suitable exposed surfaces, and add bounded puddle patches where useful. Keep wetness distinct from the rain particle count so a transition can briefly leave damp ground.
5. **Night:** dim sky/daylight and selectively brighten lamp/window emissives and limited local lights. Replace the existing blanket emissive assignment to all environment materials. Avoid every facade/leaf glowing or every lamp gaining an expensive shadow-casting light.
6. **Cloud:** soften/reduce sun contribution and cool the palette without erasing form. Humidity remains visually quiet unless another input justifies haze; it should not automatically create fog.
7. Maintain the current continuous approximately-one-second retargeting behavior. Surface state remains an explicit deterministic target, not snow/puddle accumulation based on time spent rendering. Keep artistic season independently selectable in fixtures/presets for useful combinations.
8. Validate sunny snow, windy snow, damp clearing, summer greenery, overcast afternoon, and clear night. The mock slider still represents illustrative intensity; it must not be relabeled as real forecast amount.

**Done when:** every visible environment layer agrees with each preset, weather transitions are continuous, and changing weather preserves scene/camera/layout identity.

### R9 — Verify, document, and hand off the visual result

**Depends on:** R8. **Unblocks:** appearance feedback and, after approval, forecast-adapter work.

1. Run `pnpm run typecheck`, `pnpm run scene:build`, Prettier on changed text files, and `git diff --check`. Add tests only for meaningful new logic such as camera state/reset rules or pure state math; art changes are primarily verified through rendered views.
2. Render all five presets at desktop and a narrow/mobile viewport. Check canvas dimensions, horizontal overflow, missing textures, browser errors, z-fighting, clipped hills, blank sidewalls, and overlay readability.
3. Exercise view selection, mouse/touch orbit/pan/zoom, reset, JSON export/copy fallback, resize preservation, motion pause, reduced motion, hide/show, and WebGL retry as relevant. Ensure normal viewing does not download either character GLB.
4. Check transitions while motion is paused, rapid preset retargeting, and resuming after being hidden. Camera/weather updates must still request a render when appropriate.
5. Compare draw calls/frame time/geometry with R0, especially trees/shadows and elevated framing. Keep the existing capped DPR/frame rate unless measurement justifies a change. Headless SwiftShader is useful for correctness, not proof of phone GPU speed.
6. Save representative canvas screenshots and exact camera settings, record remaining artistic/performance limitations, and update this document's inventory/status to match implementation. Share the Tailscale preview for appearance review.

**Done when:** checks pass, the scene behaves coherently across views/conditions, and the handoff distinguishes implemented work, reviewed appearance, and remaining work. Production integration still needs separate appearance approval and its own validation.

### Dependency summary and immediate resume sequence

`R0 → R1 → R2 → (R3 + R4) → R5 → R6 → R7 → R8 → R9`

R3 and R4 are independently workable after layout settles, but shared files still need one integration owner if delegation is explicitly authorized. R8's registration requirements should influence asset construction earlier; full weather polish follows the autumn milestone.

The first implementation session should accomplish **R0–R2**: load the existing demo, add the two user camera presets, and build the greybox sidewalk/road/storefront layout. Its reviewable result is screenshots in the layout and reference candidate views with exported camera settings. Then implement the single cafe/tree/light milestone before filling the entire town.

### Decisions to make through visual trials

- Final reference-camera coordinates and whether a slight street grade improves the view.
- Exact sidewalk/road proportions and how much foreground foliage to crop into frame.
- Foliage cluster/leaf density and whether ordinary materials provide sufficient warm backlighting.
- Texture scale, selective bevel detail, shadow coverage, and optional contact-shading cost.
- Adequacy of procedural cars at their viewing distance.
- Final bokeh focus/strength for each view and mobile composition.

These are normal art/implementation choices to prototype within the standalone study, not questions that block writing this plan. Seek appearance feedback on a concrete rendered result. New paid assets, reintroducing the character, and production replacement remain separate scope decisions.

## Original product behavior to implement after visual approval

### Weather dimensions

| Input | Intended depiction |
| --- | --- |
| Temperature / apparent temperature | Environment reads cold/warm appropriately. Eventually the same character wears shorts/light clothing in heat and a jacket/hat/scarf in cold. |
| Wind speed/gust/direction | Trees/foliage and drifting leaves/debris respond in strength and direction; eventually hair/scarf, body lean, and behavior too. |
| Precipitation | Light through heavy rain; light through heavy snowfall under freezing conditions; visible ground accumulation for substantial snow. |
| Cloud cover | Cloud density and sky/light color change; cloudy/rainy weather becomes grey and gloomy. |
| Sun / daylight | Clear daytime is bright with visible sun; clouds obscure it; actual nighttime is dark with suitable village lights. |
| Humidity | Often visually quiet; eventually high heat plus humidity produces visible discomfort/sweat/towel behavior. Avoid inventing prominent fog solely from humidity. |

Combine inputs creatively while preserving legibility: e.g. windy snow drifts diagonally, sunny snow has warm highlights over cold ground, rain wets paving, warm humid overcast weather feels heavy, or a storm clears to sunlight. These are artistic suggestions, not a demand for a physically exact fluid simulation.

### Daily and hourly views

- Daily overview must represent the selected day's summary, e.g. high temperature and daily precipitation chance. Treat the visual as a summary, not a claim that every condition occurs simultaneously all day.
- Where hourly data exists, allow scrubbing through the selected day's hours with the scene updating in real time.
- Use the selected location's timezone/date for light and labels, including nighttime. Do not use the machine clock to depict a forecast hour in another timezone.
- Blend changes over about one second: rain should taper away, cloud should open, sky/light should change smoothly, snow cover should visually melt when appropriate.
- If clothing returns, crossfade clothing layers or use another deliberate gentle transition rather than instant pops.
- Scrubbing repeatedly during transitions must start from the current interpolated state so it stays continuous.
- Keep time-dependent surface state deterministic when scrubbing backwards/forwards. Do not accumulate extra snow merely because the render loop ran longer, or leave a future hour's snow on an earlier hour.
- Wind direction and time-of-day angles need circular interpolation across wraparound; the current generic numeric interpolator does not handle those cases automatically.

### Real forecast mapping

Read current weather types and server contracts before changing them. `AGENTS.md` documents the existing `/api/weather` and `/api/daily-calendar` data. Hourly temperature, apparent temperature, precipitation probability, cloud cover, humidity, weather code, and wind are available. Daily summaries and daily-calendar records have a smaller field set.

Resolve data gaps deliberately:

- **Probability is not amount**: prefer actual precipitation/snowfall amount or weather-code intensity where available. If new Open-Meteo fields are needed, add them through the existing cache/history/response pipeline with suitable defaults for older snapshots.
- Daily cloud/humidity/time/precipitation intensity may need an aggregation of available hourly data or a documented fallback.
- Do not imply snow on the ground merely from below-freezing temperature. Use snowfall/known cover/history where available.
- Choose a representative daylight view for a daily overview; use actual selected time for hourly views.
- Handle null/missing fields and older cached/history snapshots without breaking the scene.

Weather rendering must not slow the app's highest-priority path: immediate cached forecast display. Eventually lazy-load the renderer/assets after the normal UI paints. Preserve existing location/date resolution, history scrub semantics, service-worker behavior, performance logging, and accessibility/fallback paths.

## Recommended next steps

### Phase 1: finish the environment appearance study (current scope)

Follow R0–R9 above. Begin with the user-supplied zoomed-out iteration view and a coordinated street greybox, retain the original low camera, and develop a separate reference candidate. Keep the character hidden. Establish the cafe/tree/light autumn milestone, expand the village, complete weather consistency, and verify the standalone demo before sharing appearance results.

Acceptance for this phase: a readable, coherent environment with convincing perspective/depth in the reference candidate and useful user camera views; no missing CSS, clipped background, excessive blur, abrupt weather changes, or obvious mismatched winter/night assets. The reference quality is an artistic target, not yet an achieved claim.

### Phase 2: define the forecast-to-scene adapter

1. Introduce a pure, typed adapter for daily and hourly inputs, with explicit units and fallbacks.
2. Decide required upstream fields and realistic intensity/accumulation heuristics.
3. Separate forecast sampling from visual transition state and deterministic surface state.
4. Build the hourly scrub UI in the demo using fixture data before touching production navigation.
5. Test meaningful cases: freezing boundary, chance vs amount, midnight/timezone, backwards scrub, rapid retargeting, missing hourly data, wind-direction wrap, and old snapshots.

### Phase 3: production integration

1. Integrate only after visual approval; lazy-load scene code/assets and preserve fast cached first paint.
2. Tie daily and hourly modes to existing selected date/location and available data.
3. Keep a static/weather-text fallback for unsupported WebGL and reduced resources.
4. Measure startup cost, GPU/CPU work, frame rate, and asset sizes on actual mobile hardware.
5. Run relevant repository checks and follow `AGENTS.md` deployment instructions when integration is authorized. Do not treat a successful standalone build as a verified main-app deployment.

### Phase 4: revisit the character if requested

Reuse the preserved studies. Pick a consistent identity and style, then build swappable clothing/accessories and pose/behavior layers driven by temperature, apparent temperature, precipitation, wind, and humidity. Validate animation and silhouette before adding more assets. A generated static mesh alone does not provide separable wardrobe parts or believable weather animation.

## Meshy access, assets, and credit history

Meshy MCP tools were available directly (`mcp__meshy__...`); retrieving configuration via SSH to perceptron was unnecessary. An attempted SSH check hit a local SSH-config permission error, not a proven Tailscale authentication failure. Do not invent a Tailscale re-auth link from that error.

The user explicitly approved **30 credits** for Meshy 7.1 preview plus texturing and **5 additional credits** for rigging/walking. Those operations completed: **35 credits total**. This approval covered those character tasks, not unlimited future generation. The Meshy workflow requires presenting the cost and waiting for confirmation before new credit-spending calls; download/status checks are free. One earlier generation attempt was rejected by automatic approval review for lacking approval of its specific cost/request; it did not produce a model.

Task IDs for provenance/recovery:

- Mesh preview: `01a111a4-3d9d-738e-9b7c-a2e26e3aa656`
- Textured/refined character: `01a111a6-0935-724c-88dc-79f916092e56`
- Rig with included walking/running: `01a111ab-7b6e-71ee-850e-0ed5f44bee2e`

The character request targeted a cozy animated-film traveller with chestnut hair, rust knit hat, striped scarf, olive winter jacket, cream sweater, jeans, tan boots, and backpack; 25k target triangles, standard geometry, GLB, T-pose for rigging, 2K PBR textures. Actual generated clothing differs from the prompt and is not an exact reference match. The walking GLB includes its animation. Do not buy another walking animation: it was included with rigging.

Use retained local files rather than expiring signed download URLs. Browser use requires GLB; no need to ask the user to choose a different format for this demo. Subagents can work on separate asset/helper files to avoid shared-file conflicts, with the root agent doing scene integration and visual review.

## Verification history and practical cautions

- For this documentation/prototype checkpoint, typechecking and the standalone build passed again. The current build emits the retained walking GLB even though the environment-only view does not request it; eventual production integration needs to review asset packaging as well as runtime loading.
- Typechecking and standalone builds passed after scene/camera/environment updates and character hiding.
- Headless Chromium/SwiftShader screenshots verified desktop scene size, no overflow, and no browser errors in the latest environment-only view.
- Mouse orbit/pan/zoom changed exported settings; Reset camera matched the default; clipboard fallback selected the readout text.
- Earlier preset, mobile, and reduced-motion checks passed, but repeat relevant visual checks after new environment changes. The new helper's incomplete winter styling remains a known gap.
- A Vite chunk-size warning is currently expected: the demo includes Three.js/postprocessing. It is not a build failure, but production integration needs a loading/performance strategy.
- Temporary Puppeteer check scripts live in `/tmp/solar-scene-preview.mjs`, `/tmp/solar-scene-qa.mjs`, and `/tmp/solar-camera-qa.mjs`; they are session aids, not committed tests and may disappear.
- The installed Puppeteer can launch `/home/david/.cache/ms-playwright/chromium-1194/chrome-linux/chrome` with `--no-sandbox --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` in this environment. Use another browser if that path changes. Headless verification is not proof of actual phone GPU performance.
- Extending the background required increasing both camera far clipping and sky-dome radius; otherwise the sky sphere obscured new distant assets. Keep those bounds coordinated.
- Main forecast/backend/app integration files were intentionally left out of this mockup. Inspect the working tree before making new changes and preserve unrelated edits.

## Suggested prompt for a fresh agent

This is a suggested future implementation request, not an instruction to implement while only reading or updating the plan:

> Read `AGENTS.md` and `docs/weather-scene-plan.md` and continue the standalone 3D environment demo at port 45379. Inspect `autumn-elevated.png` as the primary layout reference and `autumn.png` for close asset quality. Start with R0–R2: add shared original/layout camera presets, use David's zoomed-out view while iterating, and establish a broad cafe sidewalk with a distinct asphalt road and receding town. Keep the character hidden and retain its assets. Preserve the original low view and export a separate reference candidate. Then work toward the one-cafe/one-tree/sunlight milestone in R3–R5 before expanding detail. Render and check results, update the handoff, and share the Tailscale preview. Keep forecast integration and production deployment deferred; ask before any new Meshy credit spending.
