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
