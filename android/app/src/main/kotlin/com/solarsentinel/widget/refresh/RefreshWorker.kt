package com.solarsentinel.widget.refresh

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.solarsentinel.widget.GraphWidget
import com.solarsentinel.widget.SolarWidget
import com.solarsentinel.widget.data.WidgetApi
import com.solarsentinel.widget.data.WidgetData
import com.solarsentinel.widget.data.WidgetStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RefreshWorker(context: Context, params: WorkerParameters) :
  CoroutineWorker(context, params) {

  override suspend fun doWork(): Result =
    withContext(Dispatchers.IO) {
      try {
        val (lat, lon) = LocationSource.getLatLon(applicationContext)
        val body = WidgetApi.fetchWidgetJson(lat, lon)
        val data = WidgetData.fromJson(body) // validate before persisting
        WidgetStore.save(applicationContext, body)
        WidgetApi.downloadArtIfMissing(data.artUrl, WidgetStore.artFile(applicationContext, data.artUrl))
        SolarWidget.updateAll(applicationContext)
        GraphWidget.updateAll(applicationContext)
        Result.success()
      } catch (error: kotlinx.coroutines.CancellationException) {
        throw error
      } catch (error: Exception) {
        // Keep the last good render; WorkManager retries with backoff.
        Log.w("RefreshWorker", "widget refresh failed", error)
        Result.retry()
      }
    }

  companion object {
    private const val PERIODIC_WORK = "widget-refresh"
    private const val ONE_TIME_WORK = "widget-refresh-now"

    private val constraints =
      Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
      val request =
        PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES)
          .setConstraints(constraints)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
          .build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun refreshNow(context: Context) {
      val request =
        OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(constraints).build()
      WorkManager.getInstance(context)
        .enqueueUniqueWork(ONE_TIME_WORK, ExistingWorkPolicy.REPLACE, request)
    }
  }
}
