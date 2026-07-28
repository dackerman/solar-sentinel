package com.solarsentinel.widget.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

fun formatTemp(value: Double): String = "${value.roundToInt()}°"

fun formatUv(value: Double): String =
  if (value >= 10) value.roundToInt().toString() else String.format(Locale.US, "%.1f", value)

fun formatUpdatedTime(iso: String?, zoneId: String = ZoneId.systemDefault().id): String {
  if (iso == null) return "?"
  return try {
    val formatter = DateTimeFormatter.ofPattern("h:mm a", Locale.US).withZone(ZoneId.of(zoneId))
    formatter.format(Instant.parse(iso))
  } catch (_: Exception) {
    "?"
  }
}
