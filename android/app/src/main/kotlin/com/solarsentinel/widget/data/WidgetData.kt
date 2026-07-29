package com.solarsentinel.widget.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RainOutlook(
  val label: String,
  val startsAt: String? = null,
  val probability: Double = 0.0,
)

@Serializable
data class WidgetMetadata(val lastUpdated: String? = null)

@Serializable
data class HourlySeries(
  val hours: List<Int> = emptyList(),
  val temp: List<Double> = emptyList(),
  val precipProb: List<Double> = emptyList(),
  val cloudCover: List<Double> = emptyList(),
  val uv: List<Double> = emptyList(),
)

@Serializable
data class WidgetData(
  val date: String,
  val tempNow: Double,
  val feelsLike: Double,
  val tempHigh: Double,
  val tempLow: Double,
  val uvNow: Double,
  val uvMax: Double,
  val rain: RainOutlook,
  val hourly: HourlySeries? = null,
  val weatherCode: Int? = null,
  val artUrl: String,
  val artLabel: String? = null,
  val metadata: WidgetMetadata? = null,
) {
  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    fun fromJson(body: String): WidgetData = json.decodeFromString(serializer(), body)
  }
}
