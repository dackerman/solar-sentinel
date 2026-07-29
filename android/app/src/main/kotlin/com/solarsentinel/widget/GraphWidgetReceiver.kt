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
