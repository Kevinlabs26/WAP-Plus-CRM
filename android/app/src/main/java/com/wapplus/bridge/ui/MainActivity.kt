package com.wapplus.bridge.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.wapplus.bridge.service.BridgeForegroundService
import com.wapplus.bridge.a11y.WaAssistService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Android Bridge 主界面：连接状态、授权入口、启动前台服务。
 */
class MainActivity : ComponentActivity() {
    private val requestContacts =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val missingContactPermissions = listOf(
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.WRITE_CONTACTS,
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missingContactPermissions.isNotEmpty()) {
            requestContacts.launch(missingContactPermissions.toTypedArray())
        }
        startForegroundService(Intent(this, BridgeForegroundService::class.java))
        consumeSharedMedia(intent)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    BridgeHome(
                        authToken = BridgeApp.authToken(this),
                        onStartBridge = {
                            startForegroundService(
                                Intent(this, BridgeForegroundService::class.java)
                            )
                        },
                        onOpenAccessibility = {
                            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                        onOpenOverlay = {
                            val intent = Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:$packageName")
                            )
                            startActivity(intent)
                        }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        startForegroundService(Intent(this, BridgeForegroundService::class.java))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeSharedMedia(intent)
    }

    private fun consumeSharedMedia(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        val mime = intent.type.orEmpty().ifBlank { contentResolver.getType(uri).orEmpty() }
        lifecycleScope.launch(Dispatchers.IO) {
            val bytes = runCatching {
                contentResolver.openInputStream(uri)?.use { input ->
                    input.readBytes().takeIf { it.size <= 8 * 1024 * 1024 }
                }
            }.getOrNull() ?: return@launch
            val dataUrl = "data:${mime.ifBlank { "audio/ogg" }};base64," +
                Base64.encodeToString(bytes, Base64.NO_WRAP)
            WaAssistService.acceptSharedMedia(
                mime = mime,
                fileName = "voice.ogg",
                dataUrl = dataUrl,
            )
        }
    }
}

@Composable
private fun BridgeHome(
    authToken: String,
    onStartBridge: () -> Unit,
    onOpenAccessibility: () -> Unit,
    onOpenOverlay: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("WAP Plus Bridge", style = MaterialTheme.typography.headlineSmall)
        Text(
            "连接电脑 · 同步联系人 · 悬浮客户卡 · 控制 WhatsApp Business",
            style = MaterialTheme.typography.bodyMedium
        )
        Text("桌面端连接 Token（仅在本机显示）", style = MaterialTheme.typography.labelMedium)
        SelectionContainer {
            Text(authToken, style = MaterialTheme.typography.bodySmall)
        }
        var bridgeStarted by remember { mutableStateOf(BridgeForegroundService.isRunning) }
        Button(
            enabled = !bridgeStarted,
            onClick = {
                onStartBridge()
                bridgeStarted = true
            }
        ) {
            Text(if (bridgeStarted) "Bridge 服务已启动" else "启动 Bridge 服务")
        }
        Button(onClick = onOpenAccessibility) { Text("授权无障碍（辅助操作）") }
        Button(onClick = onOpenOverlay) { Text("授权悬浮窗") }
        Text(
            "Accessibility 仅在用户明确授权后用于打开聊天/输入/发送。",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
