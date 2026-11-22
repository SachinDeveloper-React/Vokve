package com.vokve.appicon

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * The launcher icon on Android: one `<activity-alias>` per icon in the app's
 * manifest, each pointing at MainActivity with its own icon and a
 * `com.vokve.appicon.KEY` meta-data naming it. Exactly one is enabled; the
 * launcher shows that one.
 *
 * **When** the swap happens is the whole subtlety. Disabling the launcher
 * entry a running task was started from can close the app on some Android
 * versions, so a swap asked for while the app is on screen is kept as
 * `pending` and made on the way out: once none of the app's activities is
 * started any more. Except when another app's activity sits on top of ours
 * in our own task — the camera, the photo picker, Health Connect's
 * permission screen — because then the app has not been left, it is waiting
 * for an answer, and closing it would lose that answer. The swap then waits
 * for the next time the member really leaves.
 *
 * One rule for whoever edits the manifest: **never remove an alias** a
 * shipped build had. A phone whose enabled alias disappears in an update
 * has no launcher icon at all, and nothing can fix it from inside an app
 * that cannot be opened. Retire an icon by leaving its alias in place.
 */
internal object IconSwitcher : Application.ActivityLifecycleCallbacks {
    const val META_KEY = "com.vokve.appicon.KEY"
    private const val TAG = "VokveAppIcon"

    /** Long enough for an activity-to-activity hand-over to finish starting the next one. */
    private const val SETTLE_MS = 700L

    data class Alias(val component: ComponentName, val key: String, val enabledByManifest: Boolean)

    private val main = Handler(Looper.getMainLooper())
    private val started = mutableSetOf<Int>()
    private var app: Application? = null

    @Volatile
    var pending: String? = null
        private set

    /**
     * Starts watching the app's activities. The module is made lazily, on
     * JavaScript's first call, by which time MainActivity has long been
     * started — so the activity on screen is counted here, or the first
     * request would think the app was in the background and swap at once.
     */
    @Synchronized
    fun attach(context: Context, onScreen: Activity?) {
        if (app != null) return
        val application = context.applicationContext as Application
        app = application
        if (onScreen != null && !onScreen.isFinishing) started.add(System.identityHashCode(onScreen))
        application.registerActivityLifecycleCallbacks(this)
        heal(application)
    }

    /** Every launcher alias in this build, disabled ones included. */
    fun aliases(context: Context): List<Alias> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(context.packageName)
        val flags = PackageManager.GET_META_DATA or PackageManager.MATCH_DISABLED_COMPONENTS
        val found = if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, flags)
        }
        return found.mapNotNull { info ->
            val activity = info.activityInfo ?: return@mapNotNull null
            val key = activity.metaData?.getString(META_KEY) ?: return@mapNotNull null
            Alias(ComponentName(activity.packageName, activity.name), key, activity.enabled)
        }
    }

    private fun isEnabled(pm: PackageManager, alias: Alias): Boolean =
        when (pm.getComponentEnabledSetting(alias.component)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> alias.enabledByManifest
            else -> false
        }

    /** The key on the home screen now, or the manifest's default where none is enabled. */
    fun current(context: Context): String? {
        val aliases = aliases(context)
        val pm = context.packageManager
        return aliases.firstOrNull { isEnabled(pm, it) }?.key
            ?: aliases.firstOrNull { it.enabledByManifest }?.key
    }

    /**
     * Asks for `key`. Returns false for a key no alias carries; otherwise
     * true, with the swap either made now (the app is not on screen) or kept
     * as pending until it leaves. Asking for the icon already showing clears
     * whatever was pending.
     */
    @Synchronized
    fun request(context: Context, key: String): Outcome {
        val aliases = aliases(context)
        if (aliases.isEmpty()) return Outcome.UNSUPPORTED
        if (aliases.none { it.key == key }) return Outcome.UNKNOWN
        if (current(context) == key) {
            pending = null
            return Outcome.UNCHANGED
        }
        pending = key
        if (started.isEmpty()) {
            applyPending()
            return if (pending == null) Outcome.APPLIED else Outcome.PENDING
        }
        return Outcome.PENDING
    }

    enum class Outcome(val wire: String) {
        APPLIED("applied"),
        PENDING("pending"),
        UNCHANGED("unchanged"),
        UNKNOWN("unknown"),
        UNSUPPORTED("unsupported"),
    }

    /** One alias enabled, every other one disabled — in one call where Android has one. */
    private fun enableOnly(context: Context, key: String): Boolean {
        val aliases = aliases(context)
        val target = aliases.firstOrNull { it.key == key } ?: return false
        val pm = context.packageManager
        val flag = PackageManager.DONT_KILL_APP
        if (Build.VERSION.SDK_INT >= 33) {
            // One broadcast, so the launcher sees the old entry replaced
            // rather than removed and then a new one added — which is what
            // lets it move the home-screen icon instead of dropping it.
            pm.setComponentEnabledSettings(
                aliases.map { alias ->
                    PackageManager.ComponentEnabledSetting(
                        alias.component,
                        if (alias == target) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        flag,
                    )
                },
            )
        } else {
            // The new entry first, so there is never a moment with none.
            pm.setComponentEnabledSetting(target.component, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, flag)
            for (alias in aliases) {
                if (alias != target) {
                    pm.setComponentEnabledSetting(alias.component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, flag)
                }
            }
        }
        return true
    }

    /** A phone left with no launcher entry gets the default back. */
    private fun heal(context: Context) {
        try {
            val pm = context.packageManager
            val aliases = aliases(context)
            if (aliases.isNotEmpty() && aliases.none { isEnabled(pm, it) }) {
                aliases.firstOrNull { it.enabledByManifest }?.let { enableOnly(context, it.key) }
            }
        } catch (error: Exception) {
            Log.w(TAG, "Could not check the launcher entries", error)
        }
    }

    @Synchronized
    private fun applyPending() {
        val context = app ?: return
        val key = pending ?: return
        if (started.isNotEmpty() || anotherAppOnTop(context)) return
        try {
            if (current(context) != key) enableOnly(context, key)
            pending = null
        } catch (error: Exception) {
            // Left pending: the next time the app is left, it is tried again.
            Log.w(TAG, "Could not switch the launcher icon to $key", error)
        }
    }

    /**
     * Whether one of our tasks has another app's activity on top — the
     * camera, a picker, a permission screen — which means the app is
     * waiting for a result rather than being left.
     */
    private fun anotherAppOnTop(context: Context): Boolean =
        try {
            context.getSystemService(ActivityManager::class.java).appTasks.any { task ->
                val top = task.taskInfo?.topActivity
                top != null && top.packageName != context.packageName
            }
        } catch (error: Exception) {
            false
        }

    override fun onActivityStarted(activity: Activity) {
        synchronized(this) { started.add(System.identityHashCode(activity)) }
    }

    override fun onActivityStopped(activity: Activity) {
        val empty = synchronized(this) {
            started.remove(System.identityHashCode(activity))
            started.isEmpty()
        }
        if (empty && !activity.isChangingConfigurations && pending != null) {
            main.postDelayed({ applyPending() }, SETTLE_MS)
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
