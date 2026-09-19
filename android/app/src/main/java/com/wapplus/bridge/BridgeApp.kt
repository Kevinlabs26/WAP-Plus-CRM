package com.wapplus.bridge

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import java.util.UUID

class BridgeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_BRIDGE,
                "WAP Plus Bridge",
                NotificationManager.IMPORTANCE_LOW
            )
            val overlay = NotificationChannel(
                CHANNEL_OVERLAY,
                getString(R.string.overlay_channel),
                NotificationManager.IMPORTANCE_LOW
            )
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
            nm.createNotificationChannel(overlay)
        }
    }

    companion object {
        const val CHANNEL_BRIDGE = "bridge_service"
        const val CHANNEL_OVERLAY = "overlay_card"
        const val DEFAULT_WS_PORT = 17890

        private const val SECURITY_PREFS = "bridge_security"
        private const val AUTH_TOKEN_KEY = "auth_token"

        fun authToken(context: Context): String {
            val prefs = context.getSharedPreferences(SECURITY_PREFS, Context.MODE_PRIVATE)
            prefs.getString(AUTH_TOKEN_KEY, null)?.takeIf { it.isNotBlank() }?.let { return it }
            return UUID.randomUUID().toString().replace("-", "").also {
                prefs.edit().putString(AUTH_TOKEN_KEY, it).apply()
            }
        }
    }
}
