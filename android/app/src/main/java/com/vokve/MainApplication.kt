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
    // The daily net under the step upload (RULES A28d). Scheduled from here
    // rather than from JavaScript on purpose: it has to exist on a phone
    // whose app is never opened, which is the only phone it is for, and
    // WorkManager keeps it across reboots and updates by itself. It is
    // `KEEP`, so a launch never resets the period, and the task it runs is
    // a no-op when nobody is signed in.
    StepSyncWorker.schedule(this)
  }
}
