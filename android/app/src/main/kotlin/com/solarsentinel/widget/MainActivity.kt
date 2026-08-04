package com.solarsentinel.widget

import android.Manifest
import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateUtils
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.WorkInfo
import com.solarsentinel.widget.data.WidgetStore
import com.solarsentinel.widget.refresh.RefreshWorker
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
  private var systemState by mutableStateOf(SystemState())
  private var lastUpdatedAt by mutableStateOf<Long?>(null)
  private var refreshState by mutableStateOf(RefreshState.CHECKING)
  private var pinMessage by mutableStateOf<String?>(null)

  private val locationPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      updateSystemState()
      if (granted) requestRefresh()
    }

  private val backgroundLocationPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      updateSystemState()
      if (granted) requestRefresh()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.Transparent.toArgb()),
      navigationBarStyle = SystemBarStyle.dark(Slate900.toArgb()),
    )
    updateSystemState()

    setContent {
      SolarSentinelTheme {
        CompanionScreen(
          systemState = systemState,
          lastUpdatedAt = lastUpdatedAt,
          refreshState = refreshState,
          pinMessage = pinMessage,
          onOpenWebApp = ::openProductionWebApp,
          onLocationAction = ::handleLocationAction,
          onBackgroundLocationAction = ::handleBackgroundLocationAction,
          onBatteryAction = ::requestBatteryExemption,
          onPinSummary = { requestPin(SolarWidgetReceiver::class.java, "Summary") },
          onPinGraph = { requestPin(GraphWidgetReceiver::class.java, "Today Graph") },
          onRefresh = ::requestRefresh,
        )
      }
    }

    // Keep periodic work registered without forcing a one-time refresh when this screen opens.
    RefreshWorker.schedule(this)
    observeManualRefresh()
  }

  override fun onResume() {
    super.onResume()
    updateSystemState()
  }

  private fun updateSystemState() {
    val powerManager = getSystemService(POWER_SERVICE) as PowerManager
    systemState =
      SystemState(
        coarseLocationGranted =
          checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED,
        backgroundLocationGranted =
          Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
              PackageManager.PERMISSION_GRANTED,
        batteryUnrestricted = powerManager.isIgnoringBatteryOptimizations(packageName),
        directPinSupported =
          AppWidgetManager.getInstance(this).isRequestPinAppWidgetSupported,
      )
    lastUpdatedAt = WidgetStore.lastUpdatedMillis(this)
  }

  private fun handleLocationAction() {
    val requestedBefore =
      getPreferences(MODE_PRIVATE).getBoolean(LOCATION_REQUESTED_KEY, false)
    if (
      requestedBefore &&
        !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)
    ) {
      openAppSettings()
      return
    }

    getPreferences(MODE_PRIVATE).edit().putBoolean(LOCATION_REQUESTED_KEY, true).apply()
    locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
  }

  private fun handleBackgroundLocationAction() {
    when {
      !systemState.coarseLocationGranted -> handleLocationAction()
      Build.VERSION.SDK_INT == Build.VERSION_CODES.Q ->
        backgroundLocationPermission.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> openAppSettings()
    }
  }

  @SuppressLint("BatteryLife")
  private fun requestBatteryExemption() {
    val directRequest =
      Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:$packageName"),
      )
    try {
      startActivity(directRequest)
    } catch (_: ActivityNotFoundException) {
      try {
        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      } catch (_: ActivityNotFoundException) {
        showMessage("Battery optimization settings are not available on this device.")
      }
    }
  }

  private fun openAppSettings() {
    startActivity(
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
    )
  }

  private fun openProductionWebApp() {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL)))
    } catch (_: ActivityNotFoundException) {
      showMessage("No browser is available to open the full forecast.")
    }
  }

  private fun requestPin(receiver: Class<*>, displayName: String) {
    val manager = AppWidgetManager.getInstance(this)
    if (!manager.isRequestPinAppWidgetSupported) {
      pinMessage = PIN_FALLBACK
      return
    }

    val requested = manager.requestPinAppWidget(ComponentName(this, receiver), null, null)
    pinMessage =
      if (requested) {
        "$displayName widget request sent to your launcher."
      } else {
        PIN_FALLBACK
      }
  }

  private fun requestRefresh() {
    refreshState = RefreshState.CHECKING
    RefreshWorker.refreshNow(this)
  }

  private fun observeManualRefresh() {
    RefreshWorker.manualRefreshWork(this).observe(this) { work ->
      refreshState =
        when {
          work.any { it.state == WorkInfo.State.RUNNING } -> RefreshState.RUNNING
          work.any { it.state == WorkInfo.State.ENQUEUED && it.runAttemptCount > 0 } ->
            RefreshState.RETRYING
          work.any {
            it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED
          } -> RefreshState.QUEUED
          work.any { it.state == WorkInfo.State.SUCCEEDED } -> RefreshState.SUCCEEDED
          work.any {
            it.state == WorkInfo.State.FAILED || it.state == WorkInfo.State.CANCELLED
          } -> RefreshState.FAILED
          else -> RefreshState.IDLE
        }
      if (refreshState == RefreshState.SUCCEEDED) {
        lastUpdatedAt = WidgetStore.lastUpdatedMillis(this)
      }
    }
  }

  private fun showMessage(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
  }

  private companion object {
    const val LOCATION_REQUESTED_KEY = "location_requested"
    const val PIN_FALLBACK =
      "Press and hold an empty area on your home screen, choose Widgets, then " +
        "Solar Sentinel Widgets."
  }
}

private data class SystemState(
  val coarseLocationGranted: Boolean = false,
  val backgroundLocationGranted: Boolean = false,
  val batteryUnrestricted: Boolean = false,
  val directPinSupported: Boolean = false,
)

private enum class RefreshState {
  CHECKING,
  IDLE,
  QUEUED,
  RETRYING,
  RUNNING,
  SUCCEEDED,
  FAILED,
}

private data class StatusItem(
  val title: String,
  val status: String,
  val detail: String,
  val ready: Boolean,
  val action: String? = null,
  val onAction: (() -> Unit)? = null,
)

private val Slate900 = Color(0xFF0F172A)
private val Slate800 = Color(0xFF1E293B)
private val Slate700 = Color(0xFF334155)
private val Amber = Color(0xFFFBBF24)
private val Cyan = Color(0xFF38BDF8)
private val Ink = Color(0xFFF8FAFC)
private val Muted = Color(0xFFCBD5E1)
private val Error = Color(0xFFFF9B91)

private val SolarColors =
  darkColorScheme(
    primary = Amber,
    onPrimary = Slate900,
    secondary = Cyan,
    onSecondary = Slate900,
    background = Slate900,
    onBackground = Ink,
    surface = Slate800,
    onSurface = Ink,
    surfaceVariant = Slate700,
    onSurfaceVariant = Muted,
    error = Error,
  )

@Composable
private fun SolarSentinelTheme(content: @Composable () -> Unit) {
  MaterialTheme(colorScheme = SolarColors, content = content)
}

@Composable
private fun CompanionScreen(
  systemState: SystemState,
  lastUpdatedAt: Long?,
  refreshState: RefreshState,
  pinMessage: String?,
  onOpenWebApp: () -> Unit,
  onLocationAction: () -> Unit,
  onBackgroundLocationAction: () -> Unit,
  onBatteryAction: () -> Unit,
  onPinSummary: () -> Unit,
  onPinGraph: () -> Unit,
  onRefresh: () -> Unit,
) {
  val statuses =
    buildStatusItems(
      systemState,
      onLocationAction,
      onBackgroundLocationAction,
      onBatteryAction,
    )

  Scaffold(
    containerColor = Slate900,
    contentWindowInsets = WindowInsets.safeDrawing,
  ) { safePadding ->
    Box(
      modifier = Modifier.fillMaxSize().padding(safePadding),
      contentAlignment = Alignment.TopCenter,
    ) {
      LazyColumn(
        modifier = Modifier.fillMaxWidth().widthIn(max = 720.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
          start = 16.dp,
          top = 20.dp,
          end = 16.dp,
          bottom = 32.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        item { Hero(onOpenWebApp) }
        item { SectionTitle("SETUP STATUS", "Keep widget updates useful in the background") }
        items(statuses) { item -> StatusCard(item) }
        item { WindhamFallback(systemState.coarseLocationGranted) }
        item { SectionTitle("HOME SCREEN", "Choose either widget or add both") }
        item {
          WidgetCard(
            eyebrow = "SUMMARY / FLEXIBLE",
            title = "Summary",
            description = "Current UV, temperature, rain chance, and weather art at a glance.",
            accent = Amber,
            directPinSupported = systemState.directPinSupported,
            pinAction = "Add Summary widget",
            onPin = onPinSummary,
          )
        }
        item {
          WidgetCard(
            eyebrow = "TODAY GRAPH / WIDE",
            title = "Today Graph",
            description = "Temperature, rain, and cloud curves across the day.",
            accent = Cyan,
            directPinSupported = systemState.directPinSupported,
            pinAction = "Add Today Graph widget",
            onPin = onPinGraph,
          )
        }
        if (pinMessage != null) {
          item { InlineNotice(pinMessage) }
        }
        item { RefreshCard(lastUpdatedAt, refreshState, onRefresh) }
      }
    }
  }
}

private fun buildStatusItems(
  state: SystemState,
  onLocationAction: () -> Unit,
  onBackgroundLocationAction: () -> Unit,
  onBatteryAction: () -> Unit,
): List<StatusItem> {
  val location =
    if (state.coarseLocationGranted) {
      StatusItem(
        title = "Approximate location",
        status = "Allowed",
        detail = "Widgets can use your device area instead of the Windham fallback.",
        ready = true,
      )
    } else {
      StatusItem(
        title = "Approximate location",
        status = "Not allowed",
        detail = "Optional. Solar Sentinel only needs your approximate area.",
        ready = false,
        action = "Allow location",
        onAction = onLocationAction,
      )
    }

  val background =
    when {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ->
        StatusItem(
          title = "Background location",
          status = "Not required",
          detail = "This Android version uses the location permission above for widget refreshes.",
          ready = state.coarseLocationGranted,
        )
      state.backgroundLocationGranted ->
        StatusItem(
          title = "Background location",
          status = "Allowed all the time",
          detail = "Scheduled refreshes can use your approximate location when the app is closed.",
          ready = true,
        )
      !state.coarseLocationGranted ->
        StatusItem(
          title = "Background location",
          status = "Location needed first",
          detail = "Allow approximate location before enabling background access.",
          ready = false,
          action = "Allow location",
          onAction = onBackgroundLocationAction,
        )
      Build.VERSION.SDK_INT == Build.VERSION_CODES.Q ->
        StatusItem(
          title = "Background location",
          status = "While in use only",
          detail = "Allow background access so scheduled widget refreshes can use your area.",
          ready = false,
          action = "Allow in background",
          onAction = onBackgroundLocationAction,
        )
      else ->
        StatusItem(
          title = "Background location",
          status = "While in use only",
          detail = "In Location permissions, choose 'Allow all the time.'",
          ready = false,
          action = "Open location settings",
          onAction = onBackgroundLocationAction,
        )
    }

  val battery =
    if (state.batteryUnrestricted) {
      StatusItem(
        title = "Battery optimization",
        status = "Unrestricted",
        detail = "Android is less likely to pause scheduled widget updates.",
        ready = true,
      )
    } else {
      StatusItem(
        title = "Battery optimization",
        status = "Optimized",
        detail =
          "Allow unrestricted use for reliable updates. On Samsung, also choose " +
            "Battery > Unrestricted.",
        ready = false,
        action = "Allow unrestricted use",
        onAction = onBatteryAction,
      )
    }

  return listOf(location, background, battery)
}

@Composable
private fun Hero(onOpenWebApp: () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Surface(
        color = Slate700,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.size(64.dp),
      ) {
        Image(
          painter = painterResource(R.drawable.ic_solar_mark),
          contentDescription = null,
          modifier = Modifier.padding(8.dp),
        )
      }
      Spacer(Modifier.width(14.dp))
      Column(modifier = Modifier.weight(1f)) {
        Text(
          text = "WIDGET COMPANION",
          color = Cyan,
          fontSize = 12.sp,
          fontWeight = FontWeight.Bold,
          letterSpacing = 1.4.sp,
        )
        Text(
          text = "Solar Sentinel Widgets",
          style = MaterialTheme.typography.headlineSmall,
          fontWeight = FontWeight.Bold,
        )
      }
    }
    Text(
      text =
        "Configure and check Solar Sentinel home-screen widgets here. " +
          "This companion is not the full forecast app.",
      color = Muted,
      style = MaterialTheme.typography.bodyLarge,
    )
    Button(
      onClick = onOpenWebApp,
      modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
      colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Slate900),
      shape = RoundedCornerShape(14.dp),
    ) {
      Text("Open full Solar Sentinel forecast", fontWeight = FontWeight.Bold)
    }
  }
}

@Composable
private fun SectionTitle(title: String, subtitle: String) {
  Column(modifier = Modifier.padding(top = 12.dp)) {
    Text(
      text = title,
      color = Amber,
      fontSize = 12.sp,
      fontWeight = FontWeight.Bold,
      letterSpacing = 1.5.sp,
    )
    Text(text = subtitle, color = Muted, style = MaterialTheme.typography.bodyMedium)
  }
}

@Composable
private fun StatusCard(item: StatusItem) {
  Card(
    colors = CardDefaults.cardColors(containerColor = Slate800),
    shape = RoundedCornerShape(16.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(item.title, fontWeight = FontWeight.SemiBold)
        StatusPill(item.status, item.ready)
      }
      Text(item.detail, color = Muted, style = MaterialTheme.typography.bodyMedium)
      if (item.action != null && item.onAction != null) {
        OutlinedButton(
          onClick = item.onAction,
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Cyan),
          modifier = Modifier.fillMaxWidth(),
          shape = RoundedCornerShape(12.dp),
        ) {
          Text(item.action, fontWeight = FontWeight.SemiBold)
        }
      }
    }
  }
}

@Composable
private fun StatusPill(text: String, ready: Boolean) {
  Surface(
    color = (if (ready) Cyan else Amber).copy(alpha = 0.14f),
    contentColor = if (ready) Cyan else Amber,
    shape = RoundedCornerShape(50),
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Box(
        modifier =
          Modifier.size(6.dp)
            .background(if (ready) Cyan else Amber, RoundedCornerShape(50))
      )
      Spacer(Modifier.width(6.dp))
      Text(text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
  }
}

@Composable
private fun WindhamFallback(hasLocation: Boolean) {
  Surface(
    color = Cyan.copy(alpha = 0.08f),
    shape = RoundedCornerShape(14.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Text(
      text =
        if (hasLocation) {
          "If Android cannot provide a recent location, widgets safely fall back to Windham, NH."
        } else {
          "Location is optional. Until it is available, widgets show the Windham, NH forecast."
        },
      color = Cyan,
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(14.dp),
    )
  }
}

@Composable
private fun WidgetCard(
  eyebrow: String,
  title: String,
  description: String,
  accent: Color,
  directPinSupported: Boolean,
  pinAction: String,
  onPin: () -> Unit,
) {
  Card(
    colors = CardDefaults.cardColors(containerColor = Slate800),
    shape = RoundedCornerShape(16.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
      Box(Modifier.width(5.dp).fillMaxHeight().background(accent))
      Column(
        modifier = Modifier.weight(1f).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Text(
          eyebrow,
          color = accent,
          fontSize = 11.sp,
          fontWeight = FontWeight.Bold,
          letterSpacing = 1.2.sp,
        )
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(description, color = Muted, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(2.dp))
        if (directPinSupported) {
          Button(
            onClick = onPin,
            colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = Slate900),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
          ) {
            Text(pinAction, fontWeight = FontWeight.Bold)
          }
        } else {
          Text(
            "Press and hold your home screen, choose Widgets, then Solar Sentinel Widgets.",
            color = Ink,
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
    }
  }
}

@Composable
private fun InlineNotice(message: String) {
  Surface(
    color = Amber.copy(alpha = 0.1f),
    shape = RoundedCornerShape(14.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Text(
      message,
      color = Amber,
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(14.dp),
    )
  }
}

@Composable
private fun RefreshCard(
  lastUpdatedAt: Long?,
  refreshState: RefreshState,
  onRefresh: () -> Unit,
) {
  val buttonDisabled =
    refreshState == RefreshState.CHECKING || refreshState == RefreshState.RUNNING
  Card(
    colors = CardDefaults.cardColors(containerColor = Slate800),
    shape = RoundedCornerShape(16.dp),
    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
  ) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("WIDGET DATA", color = Cyan, fontSize = 12.sp, fontWeight = FontWeight.Bold)
      Text("Last successful update", color = Muted, style = MaterialTheme.typography.bodyMedium)
      Text(
        formatLastUpdate(lastUpdatedAt),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
      )
      if (refreshState == RefreshState.FAILED) {
        Text(
          "Refresh could not complete. Check the connection and try again.",
          color = Error,
          style = MaterialTheme.typography.bodySmall,
        )
      }
      if (refreshState == RefreshState.QUEUED) {
        Text(
          "Waiting for a network connection or an available background slot.",
          color = Muted,
          style = MaterialTheme.typography.bodySmall,
        )
      }
      if (refreshState == RefreshState.RETRYING) {
        Text(
          "The last attempt failed. Android will retry, or you can try again now.",
          color = Amber,
          style = MaterialTheme.typography.bodySmall,
        )
      }
      HorizontalDivider(color = Slate700)
      OutlinedButton(
        onClick = onRefresh,
        enabled = !buttonDisabled,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Cyan),
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
      ) {
        if (buttonDisabled) {
          CircularProgressIndicator(
            color = Cyan,
            strokeWidth = 2.dp,
            modifier = Modifier.size(18.dp),
          )
          Spacer(Modifier.width(9.dp))
        }
        Text(
          when (refreshState) {
            RefreshState.CHECKING -> "Checking refresh status"
            RefreshState.RUNNING -> "Refreshing widgets"
            RefreshState.QUEUED,
            RefreshState.RETRYING -> "Retry refresh now"
            else -> "Refresh widgets now"
          },
          fontWeight = FontWeight.SemiBold,
        )
      }
    }
  }
}

private fun formatLastUpdate(timestamp: Long?): String {
  if (timestamp == null) return "No successful update yet"
  val absolute =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(timestamp))
  val relative =
    DateUtils.getRelativeTimeSpanString(
      timestamp,
      System.currentTimeMillis(),
      DateUtils.MINUTE_IN_MILLIS,
      DateUtils.FORMAT_ABBREV_RELATIVE,
    )
  return "$absolute / $relative"
}
