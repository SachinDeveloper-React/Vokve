package com.vokve

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.vokve.stepsync.StepSyncWorker

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // The two scheduled legs under the step upload: the daily net (RULES
    // A28d) and the run that closes the day between 23:30 and 00:20 in the
    // phone's own time (A28e). Scheduled from here rather than from
    // JavaScript on purpose: they have to exist on a phone whose app is
    // never opened, which is the only phone they are for, and WorkManager
    // keeps them across reboots and updates by itself. Both are `KEEP`, so
    // a launch neither resets the period nor moves tonight's slot, and the
    // task they run is a no-op when nobody is signed in.
    StepSyncWorker.schedule(this)
    StepSyncWorker.scheduleNightly(this)
  }
}
