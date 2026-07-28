package com.solarsentinel.widget.data

import kotlin.test.Test
import kotlin.test.assertEquals

class WidgetFormatTest {
  @Test
  fun `rounds temperatures to whole degrees`() {
    assertEquals("91°", formatTemp(91.2))
    assertEquals("68°", formatTemp(67.5))
    assertEquals("-4°", formatTemp(-3.6))
  }

  @Test
  fun `formats uv with one decimal below 10`() {
    assertEquals("6.2", formatUv(6.24))
    assertEquals("0.0", formatUv(0.0))
    assertEquals("11", formatUv(10.6))
  }

  @Test
  fun `formats the updated timestamp as local time`() {
    // Rendered in the device zone; test pins a zone for determinism.
    assertEquals("11:40 AM", formatUpdatedTime("2026-07-28T15:40:12.000Z", zoneId = "America/New_York"))
    assertEquals("?", formatUpdatedTime(null, zoneId = "America/New_York"))
    assertEquals("?", formatUpdatedTime("garbage", zoneId = "America/New_York"))
  }
}
