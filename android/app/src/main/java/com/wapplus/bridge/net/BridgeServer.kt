package com.wapplus.bridge.net

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.provider.Settings
import android.util.Log
import com.wapplus.bridge.a11y.WaAssistService
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * TCP 行协议：每行一条 JSON envelope（与 shared/protocol.ts 对齐）。
 */
class BridgeServer(
    private val context: Context,
    private val port: Int,
    private val authToken: String,
    private val onClientDisconnected: () -> Unit = {},
    private val onMessage: (String, (String) -> Unit) -> Unit,
) {
    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private val clients = CopyOnWriteArrayList<Socket>()

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val ss = ServerSocket(port, 4, InetAddress.getLoopbackAddress())
        serverSocket = ss
        Log.i(TAG, "listening on $port")
        while (running.get()) {
            try {
                val client = ss.accept()
                Log.i(TAG, "client ${client.inetAddress}")
                Thread { handleClient(client) }.start()
            } catch (e: Exception) {
                if (running.get()) Log.e(TAG, "accept", e)
                break
            }
        }
    }

    fun stop() {
        running.set(false)
        clients.forEach { runCatching { it.close() } }
        clients.clear()
        runCatching { serverSocket?.close() }
    }

    fun broadcast(jsonLine: String) {
        val line = if (jsonLine.endsWith("\n")) jsonLine else "$jsonLine\n"
        clients.forEach { socket ->
            runCatching {
                synchronized(socket) {
                    val w = PrintWriter(socket.getOutputStream(), true)
                    w.print(line)
                    w.flush()
                }
            }
        }
    }

    private fun handleClient(socket: Socket) {
        var authenticated = false
        try {
            val writer = PrintWriter(socket.getOutputStream(), true)
            socket.soTimeout = AUTH_TIMEOUT_MS
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            val authLine = reader.readLine()
            val auth = authLine?.let { runCatching { JSONObject(it) }.getOrNull() }
            val providedToken = auth?.optJSONObject("payload")?.optString("token").orEmpty()
            authenticated = auth?.optString("type") == "bridge.auth" &&
                MessageDigest.isEqual(
                    providedToken.toByteArray(Charsets.UTF_8),
                    authToken.toByteArray(Charsets.UTF_8),
                )
            if (!authenticated) {
                writer.println(authError(auth?.optString("id").orEmpty()))
                return
            }
            socket.soTimeout = 0
            clients.add(socket)
            writer.println(authAck(auth.optString("id")))
            writer.println(deviceHello())
            writer.println(deviceStatus())
            writer.println(deviceBattery())

            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val msg = line ?: continue
                if (msg.isNotBlank()) {
                    onMessage(msg) { response ->
                        Thread {
                            synchronized(socket) {
                                writer.println(response)
                            }
                        }.start()
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "client closed: ${e.message}")
        } finally {
            clients.remove(socket)
            runCatching { socket.close() }
            if (authenticated && clients.isEmpty()) onClientDisconnected()
        }
    }

    private fun authAck(refId: String): String =
        JSONObject()
            .put("id", "ack-$refId")
            .put("type", "ack")
            .put("ts", System.currentTimeMillis())
            .put("payload", JSONObject().put("refId", refId).put("ok", true).put("status", "authenticated"))
            .toString()

    private fun authError(refId: String): String =
        JSONObject()
            .put("id", "error-$refId")
            .put("type", "error")
            .put("ts", System.currentTimeMillis())
            .put(
                "payload",
                JSONObject()
                    .put("refId", refId)
                    .put("code", "auth_failed")
                    .put("message", "Bridge Token 无效"),
            )
            .toString()

    private fun deviceId(): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            ?: "android-bridge"

    private fun batteryState(): Pair<Int, Boolean> {
        val batteryIntent =
            context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) ?: 0
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val battery = if (scale > 0) level * 100 / scale else 0
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        return battery to
            (status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL)
    }

    private fun envelope(type: String, payload: JSONObject): String =
        JSONObject()
            .put("id", "$type-${System.currentTimeMillis()}")
            .put("type", type)
            .put("ts", System.currentTimeMillis())
            .put("deviceId", deviceId())
            .put("payload", payload)
            .toString()

    private fun deviceHello(): String {
        val battery = batteryState().first
        val deviceId = deviceId()
        return JSONObject()
            .put("id", "hello-$deviceId")
            .put("type", "device.hello")
            .put("ts", System.currentTimeMillis())
            .put("deviceId", deviceId)
            .put(
                "payload",
                JSONObject()
                    .put("id", deviceId)
                    .put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                    .put("model", android.os.Build.MODEL)
                    .put("androidVersion", android.os.Build.VERSION.RELEASE)
                    .put("bridgeVersion", "0.1.0")
                    .put("battery", battery)
                    .put("accessibilityEnabled", WaAssistService.instance != null)
            )
            .toString()
    }

    fun deviceStatus(online: Boolean = true): String =
        envelope(
            "device.status",
            JSONObject()
                .put("online", online)
                .put(
                    "whatsappInstalled",
                    context.packageManager.getLaunchIntentForPackage("com.whatsapp.w4b") != null ||
                        context.packageManager.getLaunchIntentForPackage("com.whatsapp") != null
                )
                .put("accessibilityEnabled", WaAssistService.instance != null)
                .put("overlayEnabled", Settings.canDrawOverlays(context))
        )

    fun deviceBattery(): String {
        val (level, charging) = batteryState()
        return envelope(
            "device.battery",
            JSONObject().put("level", level).put("charging", charging)
        )
    }

    companion object {
        private const val TAG = "BridgeServer"
        private const val AUTH_TIMEOUT_MS = 10_000
    }
}

class DesktopWsListener(
    private val onText: (String) -> Unit,
) : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) = onText(text)
    override fun onMessage(webSocket: WebSocket, bytes: ByteString) = onText(bytes.utf8())
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.e("DesktopWs", "failure", t)
    }
}
