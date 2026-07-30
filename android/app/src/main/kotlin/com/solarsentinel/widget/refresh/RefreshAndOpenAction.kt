package com.solarsentinel.widget.refresh

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.solarsentinel.widget.BuildConfig

/** Tap = strongest "user is looking at the widget" signal: refresh, then open the app. */
class RefreshAndOpenAction : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    RefreshWorker.refreshNow(context)
    context.startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
  }
}
