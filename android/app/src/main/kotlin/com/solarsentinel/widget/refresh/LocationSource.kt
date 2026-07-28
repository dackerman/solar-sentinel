package com.solarsentinel.widget.refresh

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

object LocationSource {
  // Windham, NH — the server's prewarmed home path.
  const val HOME_LAT = 42.8006
  const val HOME_LON = -71.3048

  @SuppressLint("MissingPermission")
  suspend fun getLatLon(context: Context): Pair<Double, Double> {
    val granted =
      context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) return HOME_LAT to HOME_LON

    val client = LocationServices.getFusedLocationProviderClient(context)
    val location =
      withTimeoutOrNull(10_000) {
        client.lastLocation.await()
          ?: client
            .getCurrentLocation(
              Priority.PRIORITY_BALANCED_POWER_ACCURACY,
              CancellationTokenSource().token,
            )
            .await()
      }
    return if (location != null) location.latitude to location.longitude else HOME_LAT to HOME_LON
  }
}
