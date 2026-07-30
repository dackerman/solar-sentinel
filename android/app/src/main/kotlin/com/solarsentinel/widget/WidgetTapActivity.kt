package com.solarsentinel.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.solarsentinel.widget.refresh.RefreshWorker

/**
 * Widget-tap trampoline: a tap is the strongest "user is looking" signal, so kick a
 * refresh, then forward to the web app. An Activity (not a Glance ActionCallback)
 * because background activity-launch restrictions on Android 14+ can block
 * startActivity from a broadcast-delivered callback.
 */
class WidgetTapActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    RefreshWorker.refreshNow(this)
    startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
    finish()
  }
}
