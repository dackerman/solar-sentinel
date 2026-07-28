package com.solarsentinel.widget.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WidgetDataTest {
  private val sample =
    """
    {
      "date": "2026-07-28",
      "tempNow": 84.1, "feelsLike": 88.0, "tempHigh": 91.2, "tempLow": 68.0,
      "uvNow": 6.2, "uvMax": 9.1,
      "rain": { "label": "Rain likely ~2 PM", "startsAt": "14:00", "probability": 72 },
      "weatherCode": 3,
      "artUrl": "https://example.com/weather-art/v2/day-hot-partly-high-uv.webp",
      "artLabel": "day hot partly cloudy, high UV",
      "metadata": { "cached": true, "cacheAge": 1234, "lastUpdated": "2026-07-28T15:40:12.000Z" }
    }
    """.trimIndent()

  @Test
  fun `parses the widget payload`() {
    val data = WidgetData.fromJson(sample)
    assertEquals("2026-07-28", data.date)
    assertEquals(91.2, data.tempHigh, 0.0001)
    assertEquals(6.2, data.uvNow, 0.0001)
    assertEquals("Rain likely ~2 PM", data.rain.label)
    assertEquals("14:00", data.rain.startsAt)
    assertEquals(3, data.weatherCode)
    assertEquals("2026-07-28T15:40:12.000Z", data.metadata?.lastUpdated)
  }

  @Test
  fun `tolerates missing optional fields and unknown keys`() {
    val minimal =
      """
      {
        "date": "2026-07-28", "tempNow": 80.0, "feelsLike": 80.0,
        "tempHigh": 90.0, "tempLow": 60.0, "uvNow": 1.0, "uvMax": 5.0,
        "rain": { "label": "No rain expected", "probability": 10 },
        "artUrl": "https://example.com/a.webp", "someFutureField": 42
      }
      """.trimIndent()
    val data = WidgetData.fromJson(minimal)
    assertNull(data.rain.startsAt)
    assertNull(data.weatherCode)
    assertNull(data.metadata)
  }
}
