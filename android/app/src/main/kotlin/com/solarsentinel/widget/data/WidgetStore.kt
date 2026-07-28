package com.solarsentinel.widget.data

import android.content.Context
import java.io.File
import java.security.MessageDigest

object WidgetStore {
  private const val DATA_FILE = "widget-data.json"
  private const val ART_DIR = "art-cache"

  fun save(context: Context, body: String) {
    File(context.filesDir, DATA_FILE).writeText(body)
  }

  fun load(context: Context): WidgetData? {
    val file = File(context.filesDir, DATA_FILE)
    if (!file.exists()) return null
    return try {
      WidgetData.fromJson(file.readText())
    } catch (_: Exception) {
      null
    }
  }

  // Art URLs are path-versioned and immutable, so cached files never expire.
  fun artFile(context: Context, url: String): File {
    val dir = File(context.filesDir, ART_DIR).apply { mkdirs() }
    val digest = MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
    val name = digest.joinToString("") { "%02x".format(it) }
    return File(dir, "$name.webp")
  }
}
