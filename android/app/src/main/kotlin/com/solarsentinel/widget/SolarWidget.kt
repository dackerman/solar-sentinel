package com.solarsentinel.widget

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
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
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.solarsentinel.widget.data.WidgetData
import com.solarsentinel.widget.data.WidgetStore
import com.solarsentinel.widget.data.formatTemp
import com.solarsentinel.widget.data.formatUpdatedTime
import com.solarsentinel.widget.data.formatUv

class SolarWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val data = WidgetStore.load(context)
    val artPath = data?.let { WidgetStore.artFile(context, it.artUrl) }
    provideContent { WidgetContent(data, artPath?.takeIf { it.exists() }?.absolutePath) }
  }

  companion object {
    suspend fun updateAll(context: Context) = SolarWidget().updateAll(context)
  }
}

private val textColor = ColorProvider(Color.White)
private val dimColor = ColorProvider(Color(0xB3FFFFFF))

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
  val artSize = minOf(size.height - 24.dp, 120.dp, (size.width.value * 0.4f).dp)

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
