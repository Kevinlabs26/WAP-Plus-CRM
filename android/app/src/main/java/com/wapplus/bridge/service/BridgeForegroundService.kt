package com.wapplus.bridge.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.wapplus.bridge.BridgeApp
import com.wapplus.bridge.a11y.WaAssistService
import com.wapplus.bridge.dispatch.MessageDispatcher
import com.wapplus.bridge.net.BridgeServer
import com.wapplus.bridge.overlay.CustomerCardOverlay
import com.wapplus.bridge.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 前台服务：TCP Bridge + 消息分发。
 */
class BridgeForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    private var server: BridgeServer? = null
    private var dispatcher: MessageDispatcher? = null
    private var overlay: CustomerCardOverlay? = null
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            server?.let {
                it.broadcast(if (intent?.action == Intent.ACTION_BATTERY_CHANGED) it.deviceBattery() else it.deviceStatus())
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        registerReceiver(batteryReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_SCREEN_ON)
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        if (dispatcher == null) {
            overlay = runCatching { CustomerCardOverlay(this) }.getOrNull()
            dispatcher = MessageDispatcher(this, overlay)
        }
        if (server == null) {
            val d = dispatcher!!
            val bridge = BridgeServer(
                this,
                BridgeApp.DEFAULT_WS_PORT,
                BridgeApp.authToken(this),
                onClientConnected = { WaAssistService.flushPendingMedia() },
                onClientDisconnected = { main.post { overlay?.hide() } },
            ) { envelope, isConnected, reply ->
                android.util.Log.d(TAG, "recv bytes=${envelope.length}")
                d.handle(envelope, isConnected, reply)
            }
            server = bridge
            WaAssistService.eventSink = { bridge.broadcast(it) }
            WaAssistService.statusSink = { bridge.broadcast(bridge.deviceStatus()) }
            scope.launch {
                runCatching { bridge.start { main.post { if (server === bridge) listening.value = true } } }
                    .onFailure { android.util.Log.e(TAG, "server failed", it) }
                main.post { if (server === bridge) stopSelf() }
            }
        } else {
            server?.let {
                it.broadcast(it.deviceStatus())
                it.broadcast(it.deviceBattery())
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        listening.value = false
        WaAssistService.eventSink = null
        WaAssistService.statusSink = null
        server?.let { it.broadcast(it.deviceStatus(online = false)) }
        server?.stop()
        server = null
        overlay?.hide()
        runCatching { unregisterReceiver(batteryReceiver) }
        scope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, BridgeApp.CHANNEL_BRIDGE)
            .setContentTitle("WAP Plus Bridge")
            .setContentText("TCP :${BridgeApp.DEFAULT_WS_PORT} · 等待桌面连接")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    companion object {
        private val listening = MutableStateFlow(false)
        val isRunning = listening.asStateFlow()

        private const val TAG = "BridgeService"
        private const val NOTIF_ID = 1001
    }
}
