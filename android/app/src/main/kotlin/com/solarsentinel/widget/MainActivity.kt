package com.solarsentinel.widget

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val message = TextView(this)
    message.setPadding(48, 96, 48, 48)
    message.text =
      "Solar Sentinel widget\n\n" +
        "1. Grant location (While using the app)\n" +
        "2. In app settings, change location to 'Allow all the time' so the widget can " +
        "refresh in the background\n" +
        "3. Add the widget to your home screen\n\n" +
        "Without location, the widget shows Windham, NH."
    setContentView(message)

    val granted =
      checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) {
      requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION), 1)
    }
  }
}
