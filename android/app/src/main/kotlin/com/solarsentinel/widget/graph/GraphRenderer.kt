package com.solarsentinel.widget.graph

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import com.solarsentinel.widget.data.HourlySeries
import kotlin.math.max
import kotlin.math.roundToInt

object GraphRenderer {
  fun render(
    hourly: HourlySeries,
    nowHour: Int,
    widthPx: Int,
    heightPx: Int,
    densityScale: Float,
  ): Bitmap {
    val bitmap = Bitmap.createBitmap(max(widthPx, 1), max(heightPx, 1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    if (hourly.hours.isEmpty()) return bitmap

    val labelPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(0xB3, 0xFF, 0xFF, 0xFF)
        textSize = 11f * densityScale
      }
    val axisPad = 16f * densityScale
    val chartTop = 4f * densityScale
    val chartBottom = heightPx - axisPad
    val chartHeight = chartBottom - chartTop
    val gutter = 28f * densityScale
    val slot = max(widthPx - gutter, 0f) / hourly.hours.size
    fun xFor(index: Int) = gutter + index * slot

    val cloudPaint = Paint()
    hourly.cloudCover.forEachIndexed { i, cover ->
      cloudPaint.color =
        Color.argb((cover.coerceIn(0.0, 100.0) / 100.0 * 46).toInt(), 0xFF, 0xFF, 0xFF)
      canvas.drawRect(xFor(i), chartTop, xFor(i) + slot, chartBottom, cloudPaint)
    }

    val rainPaint = Paint().apply { color = Color.argb(0xCC, 0x38, 0xBD, 0xF8) }
    hourly.precipProb.forEachIndexed { i, prob ->
      val h = (prob.coerceIn(0.0, 100.0) / 100.0 * chartHeight).toFloat()
      if (h > 0f) {
        canvas.drawRect(xFor(i) + slot * 0.15f, chartBottom - h, xFor(i) + slot * 0.85f, chartBottom, rainPaint)
      }
    }

    if (hourly.temp.isNotEmpty()) {
      val lo = hourly.temp.min() - 2.0
      val hi = hourly.temp.max() + 2.0
      val span = max(hi - lo, 1.0)
      val path = Path()
      hourly.temp.forEachIndexed { i, t ->
        val x = xFor(i) + slot / 2
        val y = chartTop + ((hi - t) / span * chartHeight).toFloat()
        if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      }
      val tempPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(0xFB, 0xBF, 0x24)
          style = Paint.Style.STROKE
          strokeWidth = 2.5f * densityScale
        }
      canvas.drawPath(path, tempPaint)

      val axisLabelPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.argb(0xE6, 0xFB, 0xBF, 0x24)
          textSize = labelPaint.textSize
          textAlign = Paint.Align.RIGHT
        }
      val gridPaint =
        Paint().apply {
          color = Color.argb(30, 0xFF, 0xFF, 0xFF)
          strokeWidth = 1f
        }
      val labelX = gutter - 4f * densityScale
      val maxTemp = hourly.temp.max()
      val minTemp = hourly.temp.min()
      listOf(maxTemp, minTemp).forEach { t ->
        val y = chartTop + ((hi - t) / span * chartHeight).toFloat()
        val baseline = y.coerceIn(axisLabelPaint.textSize, chartBottom)
        canvas.drawText("${t.roundToInt()}°", labelX, baseline, axisLabelPaint)
        canvas.drawLine(gutter, y, widthPx.toFloat(), y, gridPaint)
      }
    }

    val nowIndex = hourly.hours.indexOf(nowHour)
    if (nowIndex >= 0) {
      val nowPaint =
        Paint().apply {
          color = Color.argb(0xE6, 0xFF, 0xFF, 0xFF)
          strokeWidth = 1.5f * densityScale
        }
      val x = xFor(nowIndex) + slot / 2
      canvas.drawLine(x, chartTop, x, chartBottom, nowPaint)
    }

    listOf(6 to "6a", 12 to "12p", 18 to "6p").forEach { (hour, label) ->
      val i = hourly.hours.indexOf(hour)
      if (i >= 0) {
        canvas.drawText(
          label,
          xFor(i) + slot / 2 - labelPaint.measureText(label) / 2,
          heightPx - 4f * densityScale,
          labelPaint,
        )
      }
    }

    return bitmap
  }
}
