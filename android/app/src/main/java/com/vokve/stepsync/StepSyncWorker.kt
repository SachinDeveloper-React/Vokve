package com.vokve.stepsync

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The second leg under the step upload (RULES A28d).
 *
 * Counting is native and survives the app being closed; uploading had one
 * route, and only one: the server's silent FCM push (A28). That route is
 * good but it is a single thread — Play Services on the device, a token
 * that has to be current, the standby bucket's quota for high-priority
 * wake-ups. Counting itself has a watchdog, a sticky restart and a boot
 * receiver behind it; uploading had nothing.
 *
 * So this: Android's own scheduler, once a day, running **the same JS sync
 * as the push does** — not a second uploader. What goes up is the same
 * signed snapshot with the same nonce, the same motion windows and the same
 * Health Connect records, so a day that arrives this way verifies and pays
 * exactly as one that arrived by push. (The tracker library's own
 * `remoteSyncUrl` uploader was rejected for precisely the opposite reason:
 * its payload carries none of that, and a day it sent would score worse.)
 *
 * Deliberately cheap when there is nothing to do. The JS task answers
 * `no_owner` on a phone nobody is signed in on and `signed_out` on one
 * whose account has left, and `shouldSend` drops every day whose figures
 * the server already has before a single request is made — so a run that
 * the push beat to it costs a few local reads.
 *
 * **Force-stop is outside all of this.** A force-stopped app receives no
 * push, runs no worker and counts no steps, and only the member opening it
 * can undo that. Nothing on a server can.
 */
class StepSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    val application = applicationContext as? ReactApplication
    if (application == null) {
      Log.w(TAG, "No ReactApplication; nothing to run")
      return Result.success()
    }

    val finished = CountDownLatch(1)
    // The React instance may not exist at all: WorkManager will have started
    // the process for this. Both the lookup and the start have to happen on
    // the UI thread, which is where React's own lifecycle lives.
    UiThreadUtil.runOnUiThread {
      try {
        // Nullable in the new architecture until the host has been built.
        val host = application.reactHost
        if (host == null) {
          Log.w(TAG, "No ReactHost yet; the next run will try again")
          finished.countDown()
          return@runOnUiThread
        }
        val existing = host.currentReactContext
        if (existing != null) {
          startTask(existing, finished)
        } else {
          host.addReactInstanceEventListener(
            object : ReactInstanceEventListener {
              override fun onReactContextInitialized(context: ReactContext) {
                host.removeReactInstanceEventListener(this)
                startTask(context, finished)
              }
            },
          )
          host.start()
        }
      } catch (error: Throwable) {
        Log.w(TAG, "Step sync could not start", error)
        finished.countDown()
      }
    }

    // A Worker is allowed ten minutes; this waits for a fraction of that and
    // then gives the run up rather than holding a thread. A sync that was
    // still going is not cancelled — the JS task finishes on its own, and the
    // next run would find nothing left to send anyway.
    if (!finished.await(TASK_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      Log.w(TAG, "Step sync did not finish in time")
    }
    // Always success: a periodic worker that fails is retried with backoff,
    // and there is nothing here worth retrying sooner than tomorrow. The
    // days are still on the phone, and the window is a fortnight (A8).
    return Result.success()
  }

  private fun startTask(context: ReactContext, finished: CountDownLatch) {
    try {
      val taskContext = HeadlessJsTaskContext.getInstance(context)
      taskContext.addTaskEventListener(
        object : HeadlessJsTaskEventListener {
          override fun onHeadlessJsTaskStart(taskId: Int) = Unit

          override fun onHeadlessJsTaskFinish(taskId: Int) {
            taskContext.removeTaskEventListener(this)
            finished.countDown()
          }
        },
      )
      taskContext.startTask(
        HeadlessJsTaskConfig(
          TASK_NAME,
          // The task reads nothing from its arguments: what to send is the
          // phone's own queue and the window (A28c).
          Arguments.createMap(),
          TimeUnit.SECONDS.toMillis(TASK_TIMEOUT_SECONDS),
          // Allowed in the foreground too: the task is harmless there — the
          // running session owns the queue and the JS answers `session`.
          true,
        ),
      )
    } catch (error: Throwable) {
      Log.w(TAG, "Step sync task would not start", error)
      finished.countDown()
    }
  }

  companion object {
    /** Registered in `index.js` with `AppRegistry.registerHeadlessTask`. */
    private const val TASK_NAME = "VokveStepSync"
    private const val TAG = "VokveStepSync"
    private const val TASK_TIMEOUT_SECONDS = 120L
    private const val WORK_NAME = "vokve.stepSync.daily"

    /**
     * Schedules the daily run, once per install.
     *
     * `KEEP` rather than `UPDATE`: the first launch after an update must not
     * reset the period and push the next run a whole day out. WorkManager
     * keeps the schedule across reboots and across app updates by itself,
     * which is the reason for using it rather than an alarm.
     *
     * A day is the right cadence because the push is the primary route and
     * this is the net under it — and because an app nobody opens is in
     * Android's `rare` standby bucket, where wake-ups are rationed. Running
     * this hourly would spend that ration on a phone that has nothing to
     * say.
     */
    @JvmStatic
    fun schedule(context: Context) {
      try {
        val request =
          PeriodicWorkRequestBuilder<StepSyncWorker>(1, TimeUnit.DAYS)
            // Flexed, so Android can run it alongside whatever else it is
            // already waking up for rather than at a time of our choosing.
            .setConstraints(
              Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .build()
        WorkManager.getInstance(context)
          .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
      } catch (error: Throwable) {
        // A build without WorkManager initialised must not fail to launch
        // over a sync that is itself only a fallback.
        Log.w(TAG, "The daily step sync could not be scheduled", error)
      }
    }
  }
}
