package com.solarsentinel.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import com.solarsentinel.widget.refresh.RefreshWorker

class SolarWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SolarWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    RefreshWorker.schedule(context)
    RefreshWorker.refreshNow(context)
  }
}
