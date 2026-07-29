# Widget Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix background-refresh reliability on Samsung, make the summary widget size-responsive, and add a second "today graph" widget (temp line + rain bars + cloud shading).

**Architecture:** Server adds a full-day `hourly` series to the existing `/api/widget` payload (pure addition inside `buildWidgetData`). Android hardens refresh triggers (launcher `updatePeriodMillis` pokes + battery-exemption prompt), makes `SolarWidget` compose against `LocalSize` (SizeMode.Exact), and adds `GraphWidget` rendering a Canvas-drawn bitmap from the cached payload. One fetch feeds both widgets.

**Tech Stack:** unchanged (Express/Vitest; Kotlin 2.0.20, Glance 1.1.0, Gradle 8.11.1/AGP 8.7.3).

**Spec:** `docs/superpowers/specs/2026-07-29-widget-improvements-design.md`.

## Global Constraints

- pnpm only; run server tests with `pnpm exec vitest run <file>` (bare `pnpm test` hangs); Prettier via `pnpm run format` (android/ is prettier-ignored).
- `/api/weather` cache-hit path must not get slower; server change is additive inside `buildWidgetData` + tests only.
- Android builds: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`. Never read/print/commit `android/local.properties`.
- Old cached widget JSON (no `hourly` field) must keep parsing on-device — every new model field is optional with a default.
- `versionCode` 2 / `versionName` "1.1" (in Task 2).
- Existing behavior stays: 30-min WorkManager cadence, Windham fallback, last-good-data on failure, immutable art cache.

---

### Task 1: Server — full-day hourly series in `/api/widget`

**Files:**
- Modify: `server.js` (`buildWidgetData` only — add the series to the return)
- Modify: `src/test/widget.api.test.ts` (extend first test; add alignment test)

**Interfaces:**
- Produces: response gains `hourly: { hours: number[], temp: number[], precipProb: number[], cloudCover: number[], uv: number[] }` — parallel arrays for every forecast hour of the served date (00–23 as present, NOT truncated to remaining hours).

- [ ] **Step 1: Extend tests (failing first)**

In `src/test/widget.api.test.ts`, add to the first test (`returns the render-ready day summary`):

```ts
    expect(response.body.hourly).toEqual({
      hours: [10, 13, 14, 16],
      temp: [75.0, 82.3, 84.1, 83.0],
      precipProb: [10, 20, 72, 80],
      cloudCover: [10, 30, 40, 50],
      uv: [3.0, 5.5, 6.2, 4.1],
    });
```

And a new test after it:

```ts
  it('keeps hourly series aligned and excludes other dates', async () => {
    const forecast = getMockForecast();
    forecast.hourly.time = [...forecast.hourly.time, '2026-07-29T09:00'];
    forecast.hourly.uv_index = [...forecast.hourly.uv_index, 1.1];
    forecast.hourly.uv_index_clear_sky = [...forecast.hourly.uv_index_clear_sky, 2.0];
    forecast.hourly.precipitation_probability = [...forecast.hourly.precipitation_probability, 99];
    forecast.hourly.temperature_2m = [...forecast.hourly.temperature_2m, 60.0];
    forecast.hourly.apparent_temperature = [...forecast.hourly.apparent_temperature, 60.0];
    forecast.hourly.cloud_cover = [...forecast.hourly.cloud_cover, 90];
    forecast.hourly.relative_humidity_2m = [...forecast.hourly.relative_humidity_2m, 80];
    forecast.hourly.weather_code = [...forecast.hourly.weather_code, 61];
    mockForecastResponse(forecast);
    const response = await request(app).get('/api/widget?lat=14.005&lon=14.005');

    expect(response.status).toBe(200);
    expect(response.body.hourly.hours).toEqual([10, 13, 14, 16]);
    expect(response.body.hourly.precipProb).toEqual([10, 20, 72, 80]);
  });
```

(`getMockForecast` returns a fresh object per call — mutating the copy is safe.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/test/widget.api.test.ts`
Expected: the two touched tests FAIL (`hourly` undefined); others pass.

- [ ] **Step 3: Implement in `buildWidgetData` (server.js)**

After the `nowIndex` loop, add:

```js
  const hourlySeries = { hours: [], temp: [], precipProb: [], cloudCover: [], uv: [] };
  hourly.time.forEach((timestamp, index) => {
    if (!timestamp.startsWith(`${requestedDate}T`)) return;
    const hour = parseInt(timestamp.slice(11, 13), 10);
    if (!Number.isFinite(hour)) return;
    hourlySeries.hours.push(hour);
    hourlySeries.temp.push(hourly.temperature_2m[index]);
    hourlySeries.precipProb.push(hourly.precipitation_probability[index]);
    hourlySeries.cloudCover.push(hourly.cloud_cover[index]);
    hourlySeries.uv.push(hourly.uv_index[index]);
  });
```

and add `hourly: hourlySeries,` to the returned object (after `rain`).

- [ ] **Step 4: Verify green + full suite**

Run: `pnpm exec vitest run src/test/widget.api.test.ts && pnpm exec vitest run && pnpm run typecheck`
Expected: all pass (145+ tests).

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add server.js src/test/widget.api.test.ts
git commit -m "Add full-day hourly series to /api/widget"
```

---

### Task 2: Android — refresh hardening + responsive summary widget

**Files:**
- Modify: `android/app/src/main/res/xml/solar_widget_info.xml`
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/SolarWidgetReceiver.kt`
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/MainActivity.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (one permission line)
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/SolarWidget.kt` (responsive content)
- Modify: `android/app/build.gradle.kts` (versionCode 2, versionName "1.1")

**Interfaces:**
- Consumes: existing `RefreshWorker.schedule/refreshNow`, formatters, `WidgetStore`.
- Produces: no API changes; `WidgetContent` becomes size-aware.

- [ ] **Step 1: Widget info — launcher pokes + smaller minimum**

Replace `solar_widget_info.xml` body attributes so it reads:

```xml
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:description="@string/widget_description"
  android:minWidth="180dp"
  android:minHeight="40dp"
  android:minResizeWidth="110dp"
  android:minResizeHeight="40dp"
  android:targetCellWidth="3"
  android:targetCellHeight="2"
  android:resizeMode="horizontal|vertical"
  android:updatePeriodMillis="1800000"
  android:widgetCategory="home_screen"
  android:initialLayout="@layout/glance_default_loading_layout" />
```

- [ ] **Step 2: Receiver — re-anchor work on every launcher poke**

Add to `SolarWidgetReceiver`:

```kotlin
  override fun onUpdate(
    context: Context,
    appWidgetManager: android.appwidget.AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    super.onUpdate(context, appWidgetManager, appWidgetIds)
    RefreshWorker.schedule(context)
    RefreshWorker.refreshNow(context)
  }
```

- [ ] **Step 3: Battery-exemption prompt**

Manifest, with the other permissions:

```xml
  <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

`MainActivity.onCreate`, after the location-permission block:

```kotlin
    val powerManager = getSystemService(POWER_SERVICE) as android.os.PowerManager
    if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
      startActivity(
        android.content.Intent(
          android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          android.net.Uri.parse("package:$packageName"),
        )
      )
    }
```

Also extend the setup text with a line: `"4. On Samsung: set Battery to 'Unrestricted' so refreshes aren't paused"`.

- [ ] **Step 4: Responsive `SolarWidget`**

In `SolarWidget`, add `override val sizeMode: SizeMode = SizeMode.Exact` (import `androidx.glance.appwidget.SizeMode`), and rework `WidgetContent` so it reads `val size = LocalSize.current` (import `androidx.glance.LocalSize`) with this structure — keep the existing openApp action, colors, and null-data branch:

```kotlin
@Composable
private fun WidgetContent(data: WidgetData?, artPath: String?) {
  val size = LocalSize.current
  val openApp =
    actionStartActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
  val compact = size.height < 90.dp
  val showArt = artPath != null && size.width >= 220.dp
  val artSize = minOf(size.height - 24.dp, 120.dp, size.width * 0.4f)

  Row(
    modifier =
      GlanceModifier.fillMaxSize()
        .background(Color(0xFF1E293B))
        .cornerRadius(24.dp)
        .padding(12.dp)
        .clickable(openApp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (data == null) {
      Text(
        "Solar Sentinel: waiting for first refresh…",
        style = TextStyle(color = dimColor, fontSize = 13.sp),
      )
      return@Row
    }

    if (showArt) {
      val bitmap = BitmapFactory.decodeFile(artPath)
      if (bitmap != null) {
        Image(
          provider = ImageProvider(bitmap),
          contentDescription = data.artLabel ?: "Weather art",
          modifier = GlanceModifier.size(artSize).cornerRadius(16.dp),
          contentScale = ContentScale.Crop,
        )
        Spacer(modifier = GlanceModifier.size(12.dp))
      }
    }

    if (compact) {
      Column(verticalAlignment = Alignment.CenterVertically) {
        Text(
          "${formatTemp(data.tempHigh)}/${formatTemp(data.tempLow)} now ${formatTemp(data.tempNow)} · UV ${formatUv(data.uvNow)}/${formatUv(data.uvMax)}",
          style = TextStyle(color = textColor, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        )
        Spacer(modifier = GlanceModifier.height(2.dp))
        Text(
          "${data.rain.label} · upd ${formatUpdatedTime(data.metadata?.lastUpdated)}",
          style = TextStyle(color = dimColor, fontSize = 11.sp),
        )
      }
    } else {
      Column(verticalAlignment = Alignment.CenterVertically) {
        Text(
          "${formatTemp(data.tempHigh)} / ${formatTemp(data.tempLow)}  now ${formatTemp(data.tempNow)}",
          style = TextStyle(color = textColor, fontSize = 16.sp, fontWeight = FontWeight.Bold),
        )
        Spacer(modifier = GlanceModifier.height(4.dp))
        Text(
          "UV ${formatUv(data.uvNow)} now · max ${formatUv(data.uvMax)}",
          style = TextStyle(color = textColor, fontSize = 14.sp),
        )
        Spacer(modifier = GlanceModifier.height(4.dp))
        Text(data.rain.label, style = TextStyle(color = textColor, fontSize = 14.sp))
        Spacer(modifier = GlanceModifier.height(4.dp))
        Text(
          "updated ${formatUpdatedTime(data.metadata?.lastUpdated)}",
          style = TextStyle(color = dimColor, fontSize = 11.sp),
        )
      }
    }
  }
}
```

Note: `size.width * 0.4f` on a `Dp` — use `(size.width.value * 0.4f).dp` if the operator doesn't resolve; `minOf` over Dp works via Comparable.

- [ ] **Step 5: Version bump**

`android/app/build.gradle.kts`: `versionCode = 2`, `versionName = "1.1"`.

- [ ] **Step 6: Build + tests**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL, 5/5 tests.

- [ ] **Step 7: Commit**

```bash
git add android/app
git commit -m "Harden widget refresh triggers and make summary layout responsive"
```

---

### Task 3: Android — graph widget

**Files:**
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/data/WidgetData.kt` (add `HourlySeries`)
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/graph/GraphRenderer.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/GraphWidget.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/GraphWidgetReceiver.kt`
- Create: `android/app/src/main/res/xml/graph_widget_info.xml`
- Modify: `android/app/src/main/AndroidManifest.xml` (register receiver)
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/refresh/RefreshWorker.kt` (update both widgets)
- Modify: `android/app/src/main/res/values/strings.xml` (graph description)
- Test: extend `android/app/src/test/kotlin/com/solarsentinel/widget/data/WidgetDataTest.kt`

**Interfaces:**
- Consumes: `WidgetData` payload with the Task 1 `hourly` object; `WidgetStore.load`; `RefreshWorker`.
- Produces: `HourlySeries` model; `GraphWidget.updateAll(context)` (companion, same shape as `SolarWidget.updateAll`); `GraphRenderer.render(hourly, nowHour, widthPx, heightPx, densityScale): Bitmap`.

- [ ] **Step 1: Model + failing tests**

Add to `WidgetData.kt`:

```kotlin
@Serializable
data class HourlySeries(
  val hours: List<Int> = emptyList(),
  val temp: List<Double> = emptyList(),
  val precipProb: List<Double> = emptyList(),
  val cloudCover: List<Double> = emptyList(),
  val uv: List<Double> = emptyList(),
)
```

and to `WidgetData` the field `val hourly: HourlySeries? = null,` (after `rain`).

Extend `WidgetDataTest.kt`: in the full-payload test, add an `"hourly"` object to the sample JSON (`{"hours":[10,14],"temp":[75.0,84.1],"precipProb":[10,72],"cloudCover":[10,40],"uv":[3.0,6.2]}`) and assert `data.hourly?.hours == listOf(10, 14)` and `data.hourly?.precipProb == listOf(10.0, 72.0)`; in the minimal test assert `assertNull(data.hourly)` (old cached JSON compatibility).

Run: `cd android && ./gradlew :app:testDebugUnitTest` → compilation/assertion FAIL first, then implement, then green.

- [ ] **Step 2: `GraphRenderer.kt`**

```kotlin
package com.solarsentinel.widget.graph

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import com.solarsentinel.widget.data.HourlySeries
import kotlin.math.max

object GraphRenderer {
  fun render(
    hourly: HourlySeries,
    nowHour: Int,
    widthPx: Int,
    heightPx: Int,
    densityScale: Float,
  ): Bitmap {
    val bitmap = Bitmap.createBitmap(max(widthPx, 1), max(heightPx, 1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    if (hourly.hours.isEmpty()) return bitmap

    val labelPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(0xB3, 0xFF, 0xFF, 0xFF)
        textSize = 11f * densityScale
      }
    val axisPad = 16f * densityScale
    val chartTop = 4f * densityScale
    val chartBottom = heightPx - axisPad
    val chartHeight = chartBottom - chartTop
    val slot = widthPx.toFloat() / hourly.hours.size
    fun xFor(index: Int) = index * slot

    val cloudPaint = Paint()
    hourly.cloudCover.forEachIndexed { i, cover ->
      cloudPaint.color =
        Color.argb((cover.coerceIn(0.0, 100.0) / 100.0 * 46).toInt(), 0xFF, 0xFF, 0xFF)
      canvas.drawRect(xFor(i), chartTop, xFor(i) + slot, chartBottom, cloudPaint)
    }

    val rainPaint = Paint().apply { color = Color.argb(0xCC, 0x38, 0xBD, 0xF8) }
    hourly.precipProb.forEachIndexed { i, prob ->
      val h = (prob.coerceIn(0.0, 100.0) / 100.0 * chartHeight * 0.55).toFloat()
      if (h > 0f) {
        canvas.drawRect(xFor(i) + slot * 0.15f, chartBottom - h, xFor(i) + slot * 0.85f, chartBottom, rainPaint)
      }
    }

    if (hourly.temp.isNotEmpty()) {
      val lo = hourly.temp.min() - 2.0
      val hi = hourly.temp.max() + 2.0
      val span = max(hi - lo, 1.0)
      val path = Path()
      hourly.temp.forEachIndexed { i, t ->
        val x = xFor(i) + slot / 2
        val y = chartTop + ((hi - t) / span * chartHeight).toFloat()
        if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      }
      val tempPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(0xFB, 0xBF, 0x24)
          style = Paint.Style.STROKE
          strokeWidth = 2.5f * densityScale
        }
      canvas.drawPath(path, tempPaint)
    }

    val nowIndex = hourly.hours.indexOf(nowHour)
    if (nowIndex >= 0) {
      val nowPaint =
        Paint().apply {
          color = Color.argb(0xE6, 0xFF, 0xFF, 0xFF)
          strokeWidth = 1.5f * densityScale
        }
      val x = xFor(nowIndex) + slot / 2
      canvas.drawLine(x, chartTop, x, chartBottom, nowPaint)
    }

    listOf(6 to "6a", 12 to "12p", 18 to "6p").forEach { (hour, label) ->
      val i = hourly.hours.indexOf(hour)
      if (i >= 0) {
        canvas.drawText(
          label,
          xFor(i) + slot / 2 - labelPaint.measureText(label) / 2,
          heightPx - 4f * densityScale,
          labelPaint,
        )
      }
    }

    return bitmap
  }
}
```

- [ ] **Step 3: `GraphWidget.kt`**

```kotlin
package com.solarsentinel.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.solarsentinel.widget.data.WidgetData
import com.solarsentinel.widget.data.WidgetStore
import com.solarsentinel.widget.data.formatTemp
import com.solarsentinel.widget.graph.GraphRenderer
import java.util.Calendar

class GraphWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val data = WidgetStore.load(context)
    val density = context.resources.displayMetrics.density
    provideContent { GraphContent(data, density) }
  }

  companion object {
    suspend fun updateAll(context: Context) = GraphWidget().updateAll(context)
  }
}

private val textColor = ColorProvider(Color.White)
private val dimColor = ColorProvider(Color(0xB3FFFFFF))

@Composable
private fun GraphContent(data: WidgetData?, density: Float) {
  val size = LocalSize.current
  val openApp =
    actionStartActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )

  Column(
    modifier =
      GlanceModifier.fillMaxSize()
        .background(Color(0xFF1E293B))
        .cornerRadius(24.dp)
        .padding(12.dp)
        .clickable(openApp),
  ) {
    val hourly = data?.hourly
    if (data == null || hourly == null || hourly.hours.isEmpty()) {
      Text(
        "Solar Sentinel: waiting for hourly data…",
        style = TextStyle(color = dimColor, fontSize = 13.sp),
      )
      return@Column
    }

    val showHeader = size.height >= 90.dp
    if (showHeader) {
      Text(
        "${formatTemp(data.tempHigh)} / ${formatTemp(data.tempLow)} · ${data.rain.label}",
        style = TextStyle(color = textColor, fontSize = 13.sp, fontWeight = FontWeight.Bold),
      )
      Spacer(modifier = GlanceModifier.height(4.dp))
    }

    val headerDp = if (showHeader) 24 else 0
    val chartWidthPx = ((size.width.value - 24) * density).toInt()
    val chartHeightPx = ((size.height.value - 24 - headerDp) * density).toInt()
    val nowHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val bitmap = GraphRenderer.render(hourly, nowHour, chartWidthPx, chartHeightPx, density)
    Image(
      provider = ImageProvider(bitmap),
      contentDescription = "Today: temperature, rain probability, and cloud cover by hour",
      modifier = GlanceModifier.fillMaxSize(),
      contentScale = ContentScale.Fit,
    )
  }
}
```

- [ ] **Step 4: Receiver, widget info, manifest, strings**

`GraphWidgetReceiver.kt`:

```kotlin
package com.solarsentinel.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import com.solarsentinel.widget.refresh.RefreshWorker

class GraphWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = GraphWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    RefreshWorker.schedule(context)
    RefreshWorker.refreshNow(context)
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    super.onUpdate(context, appWidgetManager, appWidgetIds)
    RefreshWorker.schedule(context)
    RefreshWorker.refreshNow(context)
  }
}
```

`res/xml/graph_widget_info.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:description="@string/graph_widget_description"
  android:minWidth="250dp"
  android:minHeight="90dp"
  android:minResizeWidth="180dp"
  android:minResizeHeight="60dp"
  android:targetCellWidth="4"
  android:targetCellHeight="2"
  android:resizeMode="horizontal|vertical"
  android:updatePeriodMillis="1800000"
  android:widgetCategory="home_screen"
  android:initialLayout="@layout/glance_default_loading_layout" />
```

Manifest (inside `<application>`, next to the existing receiver):

```xml
    <receiver
      android:name=".GraphWidgetReceiver"
      android:exported="true"
      android:label="@string/graph_widget_name">
      <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
      </intent-filter>
      <meta-data
        android:name="android.appwidget.provider"
        android:resource="@xml/graph_widget_info" />
    </receiver>
```

`strings.xml` additions:

```xml
  <string name="graph_widget_name">Solar Sentinel Graph</string>
  <string name="graph_widget_description">Today\'s temperature, rain, and cloud curves</string>
</resources>
```

- [ ] **Step 5: RefreshWorker updates both widgets**

In `RefreshWorker.doWork`, after `SolarWidget.updateAll(applicationContext)` add:

```kotlin
        GraphWidget.updateAll(applicationContext)
```

(import `com.solarsentinel.widget.GraphWidget`).

- [ ] **Step 6: Build + tests**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL; unit tests green (7+ with the new assertions).

- [ ] **Step 7: Commit**

```bash
git add android/app
git commit -m "Add today-graph widget with Canvas-rendered chart"
```

---

### Task 4: Ship (main session)

- [ ] Docker rebuild + `/api/widget` smoke test (hourly block present)
- [ ] `scripts/build-widget-apk`; verify signature; refresh the tailnet-served copies
- [ ] Notify David (ntfy): upgrade link + reminder to set Battery → Unrestricted
- [ ] Final whole-branch review; merge to master + push per repo convention

## Final verification

- [ ] `pnpm exec vitest run && pnpm run typecheck && pnpm run format:check` green
- [ ] `cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease` green
- [ ] Deployed `/api/widget` returns `hourly` arrays; old widget (v1) still renders against the new payload (unknown keys ignored)
- [ ] On-device after upgrade: summary widget fills its cells at 3×1 and 4×2; graph widget renders curves; refresh cadence visible in server logs
