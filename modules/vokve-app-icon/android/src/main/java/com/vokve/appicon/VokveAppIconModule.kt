package com.vokve.appicon

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/** The JavaScript face of [IconSwitcher]; see there for when a swap happens. */
class VokveAppIconModule(reactContext: ReactApplicationContext) : NativeVokveAppIconSpec(reactContext) {

    init {
        IconSwitcher.attach(reactContext, reactContext.currentActivity)
    }

    override fun getName(): String = NAME

    override fun getState(promise: Promise) {
        try {
            val context = reactApplicationContext
            val aliases = IconSwitcher.aliases(context)
            val state = Arguments.createMap().apply {
                putBoolean("supported", aliases.isNotEmpty())
                putString("current", IconSwitcher.current(context) ?: "")
                val pending = IconSwitcher.pending
                if (pending == null) putNull("pending") else putString("pending", pending)
                putArray("available", Arguments.createArray().apply { aliases.forEach { pushString(it.key) } })
            }
            promise.resolve(state)
        } catch (error: Exception) {
            promise.reject("STATE_FAILED", error.message, error)
        }
    }

    override fun setIcon(key: String, promise: Promise) {
        try {
            when (val outcome = IconSwitcher.request(reactApplicationContext, key)) {
                IconSwitcher.Outcome.UNKNOWN ->
                    promise.reject("UNKNOWN_ICON", "This build carries no icon called '$key'")
                IconSwitcher.Outcome.UNSUPPORTED ->
                    promise.reject("UNSUPPORTED", "This build has no launcher aliases to switch between")
                else -> promise.resolve(outcome.wire)
            }
        } catch (error: Exception) {
            promise.reject("SET_FAILED", error.message, error)
        }
    }

    companion object {
        const val NAME = "VokveAppIcon"
    }
}
