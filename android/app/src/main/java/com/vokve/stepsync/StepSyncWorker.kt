package com.vokve.stepsync

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.Calendar
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.random.Random

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
 * So this: Android's own scheduler, running **the same JS sync as the push
 * does** — not a second uploader. What goes up is the same signed snapshot
 * with the same nonce, the same motion windows and the same Health Connect
 * records, so a day that arrives this way verifies and pays exactly as one
 * that arrived by push. (The tracker library's own `remoteSyncUrl` uploader
 * was rejected for precisely the opposite reason: its payload carries none
 * of that, and a day it sent would score worse.)
 *
 * It is scheduled twice, for two different jobs:
 *
 *  * **The nightly run** (`scheduleNightly`, RULES A28e) — one run between
 *    23:30 and 00:20 in the phone's own time, which is the most valuable
 *    minute of the day to own: the day is about to close, so what goes up
 *    is as near to that day's final count as the phone will ever have, and
 *    a phone that then stays shut for a week has already banked it. Each
 *    install draws its own minute of that window and keeps it, so a whole
 *    country's phones spread themselves across fifty minutes without
 *    anything coordinating them.
 *  * **The daily period** (`schedule`) — the floor under everything,
 *    including under the nightly run: it is what picks the nightly chain
 *    back up if a run is ever dropped.
 *
 * Neither is hourly, and that is deliberate: an app nobody opens is in
 * Android's `rare` standby bucket where wake-ups are rationed, every run
 * here starts a React instance, and a phone with nothing new to say costs
 * the server nothing anyway (`shouldSend`). Spending the ration on the one
 * run that closes the day buys more than nine runs that each find the same
 * figures already sent.
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
    val nightly = inputData.getBoolean(INPUT_NIGHTLY, false)
    // The daily run is also where a nightly chain that was broken is picked
    // back up — a slot the OS dropped, an install updated in that minute.
    // `KEEP`, so a slot already waiting is left exactly where it is.
    if (!nightly) scheduleNightly(applicationContext)
    try {
      runSync()
    } finally {
      // Armed from here whatever this run managed, and from here rather than
      // from a launch, because the phone this is for is the one nobody
      // opens: a one-time request is spent once it has run.
      if (nightly) armNextNightly(applicationContext)
    }
    // Always success: a periodic worker that fails is retried with backoff,
    // and there is nothing here worth retrying sooner than tonight. The days
    // are still on the phone, and the window is three weeks (A8).
    return Result.success()
  }

  private fun runSync() {
    val application = applicationContext as? ReactApplication
    if (application == null) {
      Log.w(TAG, "No ReactApplication; nothing to run")
      return
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
    private const val NIGHTLY_WORK_NAME = "vokve.stepSync.nightly"
    /** Set on the nightly request, so a run knows to arm the next one. */
    private const val INPUT_NIGHTLY = "nightly"
    /** Where this install's own minute of the window is kept. */
    private const val PREFS_NAME = "vokve.stepSync"
    private const val OFFSET_KEY = "nightlyOffsetMinutes"
    /** The window opens at 23:30 in the phone's own time… */
    private const val NIGHTLY_HOUR = 23
    private const val NIGHTLY_MINUTE = 30
    /**
     * …and each install takes one minute out of the fifty after it. Fifty
     * rather than sixty leaves ten minutes of slack before 00:30 for a run
     * the OS defers into its next maintenance window.
     */
    private const val NIGHTLY_SPREAD_MINUTES = 50

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

    /**
     * Arms the next nightly run unless one is already waiting (RULES A28e).
     *
     * Safe to call from anywhere, as often as anything likes: `KEEP` leaves
     * a slot that is still waiting exactly where it is, and once a slot has
     * run its request is finished, so the next call arms the one after it.
     */
    @JvmStatic
    fun scheduleNightly(context: Context) {
      enqueueNightly(context, ExistingWorkPolicy.KEEP, await = false)
    }

    /**
     * Tomorrow's slot, armed by tonight's run.
     *
     * `REPLACE` and not `KEEP`, because the caller *is* the nightly work and
     * its own state is still `RUNNING` — `KEEP` would keep that and arm
     * nothing at all. Replacing cancels this run, which by then has already
     * done everything it was woken for, and the enqueue is waited on so the
     * next slot is in WorkManager's database before the process can be taken
     * away.
     */
    private fun armNextNightly(context: Context) {
      enqueueNightly(context, ExistingWorkPolicy.REPLACE, await = true)
    }

    private fun enqueueNightly(context: Context, policy: ExistingWorkPolicy, await: Boolean) {
      try {
        val request =
          OneTimeWorkRequestBuilder<StepSyncWorker>()
            .setInitialDelay(millisUntilNextSlot(context), TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(INPUT_NIGHTLY to true))
            .setConstraints(
              Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .build()
        val enqueued =
          WorkManager.getInstance(context).enqueueUniqueWork(NIGHTLY_WORK_NAME, policy, request)
        if (await) enqueued.result.get()
      } catch (error: Throwable) {
        Log.w(TAG, "The nightly step sync could not be scheduled", error)
      }
    }

    /**
     * How long until this install's own minute of the next window, measured
     * on the phone's own clock — the same clock the day boundary is drawn on
     * (RULES A3), which is the whole point: the run has to land inside the
     * day it is closing, wherever the phone is.
     */
    private fun millisUntilNextSlot(context: Context): Long {
      val now = Calendar.getInstance()
      val slot =
        (now.clone() as Calendar).apply {
          set(Calendar.HOUR_OF_DAY, NIGHTLY_HOUR)
          // Past 59 this rolls into the next hour and carries the date with
          // it: an install holding minute 45 runs at 00:15.
          set(Calendar.MINUTE, NIGHTLY_MINUTE + offsetMinutes(context))
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
        }
      if (slot.timeInMillis <= now.timeInMillis) slot.add(Calendar.DAY_OF_MONTH, 1)
      return slot.timeInMillis - now.timeInMillis
    }

    /**
     * This install's minute of the window, drawn once and kept for good.
     *
     * Drawn here and nowhere else, out of nothing but a local random number:
     * every install picking its own minute spreads a whole country's phones
     * evenly across the window with nothing coordinating them, which is the
     * cheapest possible answer to the only real cost of a nightly sync —
     * every phone asking in the same minute. A phone that is asleep then
     * runs when Android next wakes it, which spreads the tail further still.
     */
    private fun offsetMinutes(context: Context): Int {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val kept = prefs.getInt(OFFSET_KEY, -1)
      if (kept in 0 until NIGHTLY_SPREAD_MINUTES) return kept
      val drawn = Random.nextInt(NIGHTLY_SPREAD_MINUTES)
      prefs.edit().putInt(OFFSET_KEY, drawn).apply()
      return drawn
    }
  }
}
