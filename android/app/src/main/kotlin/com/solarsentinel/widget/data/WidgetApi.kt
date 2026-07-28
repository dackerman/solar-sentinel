package com.solarsentinel.widget.data

import com.solarsentinel.widget.BuildConfig
import java.io.File
import java.io.IOException
import java.util.Locale
import okhttp3.OkHttpClient
import okhttp3.Request

object WidgetApi {
  private val client = OkHttpClient()

  private fun request(url: String): Request =
    Request.Builder()
      .url(url)
      .header("CF-Access-Client-Id", BuildConfig.CF_ACCESS_CLIENT_ID)
      .header("CF-Access-Client-Secret", BuildConfig.CF_ACCESS_CLIENT_SECRET)
      .build()

  fun fetchWidgetJson(lat: Double, lon: Double): String {
    val url =
      String.format(Locale.US, "%s/api/widget?lat=%.4f&lon=%.4f", BuildConfig.BASE_URL, lat, lon)
    client.newCall(request(url)).execute().use { response ->
      if (!response.isSuccessful) throw IOException("Widget API returned ${response.code}")
      return response.body?.string() ?: throw IOException("Widget API returned an empty body")
    }
  }

  fun downloadArtIfMissing(url: String, destination: File) {
    if (destination.exists()) return
    val temp = File(destination.parentFile, destination.name + ".tmp")
    try {
      client.newCall(request(url)).execute().use { response ->
        if (!response.isSuccessful) throw IOException("Art download returned ${response.code}")
        val body = response.body ?: throw IOException("Art download returned an empty body")
        temp.outputStream().use { body.byteStream().copyTo(it) }
      }
      if (!temp.renameTo(destination)) {
        temp.delete()
        throw IOException("Failed to move downloaded art into place")
      }
    } catch (error: Exception) {
      temp.delete()
      throw error
    }
  }
}
