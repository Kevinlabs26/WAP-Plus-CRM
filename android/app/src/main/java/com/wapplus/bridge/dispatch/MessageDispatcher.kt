package com.wapplus.bridge.dispatch

import android.content.ClipData
import android.app.KeyguardManager
import android.content.ContentProviderOperation
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.provider.Settings
import android.util.Log
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import com.wapplus.bridge.BridgeApp
import com.wapplus.bridge.a11y.WaAssistService
import com.wapplus.bridge.overlay.CustomerCardOverlay
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 解析桌面 JSON envelope → A11y / Overlay。
 *
 * 协议对照（无 codegen，改 type 时请同步）：
 * - shared/protocol.ts → MESSAGE_TYPES / ANDROID_DISPATCH_MESSAGE_TYPES
 * - shared/fixtures/android-bridge JSON fixtures
 * - desktop/tests/protocol-contract.test.mjs（扫描本文件 when 分支）
 *
 * 组合命令：
 * - wa.open_chat
 * - wa.open_and_send { phoneE164, text } 一键打开并发送
 */
class MessageDispatcher(
    private val context: Context,
    private val overlay: CustomerCardOverlay? = null,
) {
    private val main = Handler(Looper.getMainLooper())

    fun handle(raw: String, isConnected: () -> Boolean, reply: (String) -> Unit) {
        if (!isConnected()) return
        try {
            val root = JSONObject(raw)
            val id = root.optString("id")
            val type = root.optString("type")
            val payload = root.optJSONObject("payload") ?: JSONObject()
            val requestedDevice = root.optString("deviceId")
            if (!root.isNull("deviceId") && requestedDevice != BridgeApp.deviceId(context)) {
                return reply(error(id, "device_mismatch", "所选手机与实际连接的手机不匹配"))
            }
            Log.i(TAG, "dispatch type=$type")

            when (type) {
                "contacts.save" -> {
                    val name = payload.optString("name").trim()
                    val phone = payload.optString("phoneE164").trim()
                    if (name.isBlank() || !phone.matches(Regex("^\\+?[0-9]{7,15}$"))) {
                        return reply(error(id, "invalid_payload", "联系人姓名或号码无效"))
                    }
                    if (
                        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED ||
                        ContextCompat.checkSelfPermission(context, android.Manifest.permission.WRITE_CONTACTS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        return reply(error(id, "contacts_permission_denied", "请在手机端授予通讯录写入权限"))
                    }
                    runCatching { saveContact(name, phone) }
                        .onSuccess { created -> reply(ack(id, status = if (created) "saved" else "exists")) }
                        .onFailure { reply(error(id, "contact_save_failed", it.message ?: "保存联系人失败")) }
                }
                "contacts.save_batch" -> {
                    val items = payload.optJSONArray("items")
                    if (items == null || items.length() == 0 || items.length() > 500) {
                        return reply(error(id, "invalid_payload", "联系人批次应包含 1 至 500 项"))
                    }
                    if (
                        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED ||
                        ContextCompat.checkSelfPermission(context, android.Manifest.permission.WRITE_CONTACTS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        return reply(error(id, "contacts_permission_denied", "请在手机端授予通讯录写入权限"))
                    }
                    val results = JSONArray()
                    var okCount = 0
                    var failedCount = 0
                    for (index in 0 until items.length()) {
                        if (!isConnected()) return
                        val item = items.optJSONObject(index) ?: JSONObject()
                        val name = item.optString("name").trim()
                        val phone = item.optString("phoneE164").trim()
                        val result = JSONObject().put("phoneE164", phone)
                        if (name.isBlank() || name.length > 100 || !phone.matches(Regex("^\\+?[0-9]{7,15}$"))) {
                            results.put(result.put("status", "failed").put("error", "姓名或号码无效"))
                            failedCount++
                            continue
                        }
                        runCatching { saveContact(name, phone) }
                            .onSuccess { created ->
                                results.put(result.put("status", if (created) "saved" else "exists"))
                                okCount++
                            }
                            .onFailure { error ->
                                results.put(result.put("status", "failed").put("error", error.message ?: "保存失败"))
                                failedCount++
                            }
                    }
                    // 诚实汇报：部分失败不能整体报 saved。ok 保持 true，
                    // 桌面端按逐项 status 统计并向用户展示失败数。
                    val batchStatus = when {
                        failedCount == 0 -> "saved"
                        okCount == 0 -> "failed"
                        else -> "partial"
                    }
                    reply(ack(id, items = results, status = batchStatus))
                }
                "wa.open_chat" -> {
                    val phone = payload.optString("phoneE164")
                    if (!phone.matches(INTERNATIONAL_PHONE)) return reply(error(id, "invalid_payload", "需要完整国际手机号"))
                    val svc = requireA11y(id, reply) ?: return
                    main.post {
                        if (!isConnected()) return@post
                        if (phoneLocked()) reply(error(id, "phone_locked", "请先解锁手机"))
                        else if (svc.whatsappBusy) reply(error(id, "whatsapp_busy", "手机正在操作 WhatsApp"))
                        else if (svc.openChat(phone)) reply(ack(id))
                        else reply(error(id, "whatsapp_not_installed", "WhatsApp 未安装或手机号无效"))
                    }
                }
                "wa.type_text" -> {
                    reply(error(id, "unsupported_message_type", "请通过已核验号码的文本发送命令操作"))
                }
                "wa.send" -> {
                    reply(error(id, "unsupported_message_type", "请通过已核验号码的文本发送命令操作"))
                }
                "wa.open_and_send" -> {
                    val deviceId = BridgeApp.deviceId(context)
                    if (id.isBlank() || deviceId == "android-bridge" || requestedDevice != deviceId) {
                        return reply(error(id, "device_mismatch", "连接的手机与发送任务不匹配，请更新两端并核对手机"))
                    }
                    val phone = payload.optString("phoneE164")
                    val text = payload.optString("text")
                    if (!phone.matches(INTERNATIONAL_PHONE) || text.isBlank()) {
                        reply(error(id, "invalid_payload", "需要完整国际手机号及非空消息"))
                        return
                    }
                    val svc = requireA11y(id, reply) ?: return
                    main.post {
                        if (svc !== WaAssistService.instance) {
                            reply(error(id, "accessibility_disabled", "Accessibility 未开启"))
                        } else if (isConnected()) svc.openChatAndType(phone, text, payload.optBoolean("confirmSent"), isConnected) { code, message, confirmed ->
                            reply(if (confirmed) ack(id, status = "phone_sent")
                            else if (code == null) ack(id, status = "clicked") else error(id, code, checkNotNull(message)))
                        }
                    }
                }
                "wa.sync_conversations" -> {
                    val svc = requireA11y(id, reply) ?: return
                    main.post {
                        if (!isConnected()) return@post
                        svc.syncConversations(isConnected) { ok, message, items ->
                            reply(if (ok) ack(id, items) else error(id, "ui_element_not_found", message ?: "同步失败"))
                        }
                    }
                }
                "wa.prepare_media" -> {
                    val messageId = payload.optString("messageId").trim()
                    if (messageId.isBlank()) {
                        reply(error(id, "invalid_payload", "缺少消息 ID"))
                        return
                    }
                    requireA11y(id, reply) ?: return
                    val prepared = WaAssistService.prepareMediaShare(
                        messageId = messageId,
                        jid = payload.optString("jid"),
                        phoneE164 = payload.optString("phoneE164"),
                        displayName = payload.optString("displayName"),
                        body = payload.optString("body"),
                        sentAt = payload.optLong("sentAt", System.currentTimeMillis()),
                    )
                    if (prepared) reply(ack(id, status = "ready"))
                    else reply(error(id, "media_share_busy", "请先完成手机上待分享的语音，或等待该请求过期"))
                }
                "wa.send_media" -> {
                    if (!payload.optString("phoneE164").matches(INTERNATIONAL_PHONE)) {
                        return reply(error(id, "invalid_payload", "需要完整国际手机号"))
                    }
                    val svc = requireA11y(id, reply) ?: return
                    if (phoneLocked()) return reply(error(id, "phone_locked", "请先解锁手机"))
                    val file = runCatching { prepareMedia(payload) }.getOrElse {
                        reply(error(id, "invalid_payload", it.message ?: "媒体文件无效"))
                        return
                    }
                    main.post {
                        if (!isConnected()) return@post
                        if (svc !== WaAssistService.instance) {
                            return@post reply(error(id, "accessibility_disabled", "Accessibility 未开启"))
                        }
                        if (phoneLocked()) return@post reply(error(id, "phone_locked", "请先解锁手机"))
                        if (svc.whatsappBusy) {
                            return@post reply(error(id, "whatsapp_busy", "手机正在操作 WhatsApp"))
                        }
                        runCatching { openMediaShare(svc, file, payload) }
                            .onSuccess { reply(ack(id, status = "opened")) }
                            .onFailure {
                                val code = if ((it.message ?: "").contains("WhatsApp"))
                                    "whatsapp_not_installed" else "invalid_payload"
                                reply(error(id, code, it.message ?: "无法打开媒体分享"))
                            }
                    }
                }
                "wa.search_contact" -> {
                    val query = payload.optString("query").trim()
                    if (query.isBlank()) return reply(error(id, "invalid_payload", "搜索名称为空"))
                    val svc = requireA11y(id, reply) ?: return
                    main.post {
                        if (!isConnected()) return@post
                        svc.searchContact(query, isConnected) { ok, message, items, opened ->
                            if (ok) reply(ack(id, items, if (opened) "opened" else "sent", opened))
                            else {
                                val code = if (message?.startsWith("未找到完整名称") == true)
                                    "contact_not_found" else "ui_element_not_found"
                                reply(error(id, code, message ?: "联系人搜索失败"))
                            }
                        }
                    }
                }
                "overlay.show_card" -> {
                    if (payload.optString("contactName").isBlank())
                        return reply(error(id, "invalid_payload", "客户名称为空"))
                    if (!Settings.canDrawOverlays(context))
                        return reply(error(id, "overlay_permission_denied", "请开启悬浮窗权限"))
                    main.post {
                        if (!isConnected()) return@post
                        runCatching {
                            requireNotNull(overlay).show(
                                CustomerCardOverlay.Card(
                                    contactName = payload.optString("contactName"),
                                    tags = jsonArrayToList(payload.optJSONArray("tags")),
                                    stage = payload.optString("stage"),
                                    nextFollowUp = payload.optString("nextFollowUp").ifBlank { null },
                                    aiSummary = payload.optString("aiSummary").ifBlank { null },
                                )
                            )
                        }.onSuccess { reply(ack(id)) }
                            .onFailure { reply(error(id, "overlay_permission_denied", it.message ?: "悬浮窗不可用")) }
                    }
                }
                "overlay.hide" -> main.post {
                    if (!isConnected()) return@post
                    overlay?.hide()
                    reply(ack(id))
                }
                "ping" -> reply(ack(id))
                "ack" -> Log.d(TAG, "ack received")
                else -> reply(error(id, "unsupported_message_type", "不支持的消息类型：$type"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "bad envelope", e)
            reply(error("", "invalid_payload", e.message ?: "JSON envelope 无效"))
        }
    }

    private fun ack(
        refId: String,
        items: org.json.JSONArray? = null,
        status: String = "sent",
        opened: Boolean? = null,
    ): String =
        JSONObject()
            .put("id", "ack-$refId")
            .put("type", "ack")
            .put("ts", System.currentTimeMillis())
            .put(
                "payload",
                JSONObject()
                    .put("refId", refId)
                    .put("ok", true)
                    .put("status", status)
                    .apply { if (items != null) put("items", items) }
                    .apply { if (opened != null) put("opened", opened) }
            )
            .toString()

    private fun error(refId: String, code: String, message: String): String =
        JSONObject()
            .put("id", "error-$refId")
            .put("type", "error")
            .put("ts", System.currentTimeMillis())
            .put("payload", JSONObject().put("refId", refId).put("code", code).put("message", message))
            .toString()

    private fun requireA11y(refId: String, reply: (String) -> Unit): WaAssistService? =
        WaAssistService.instance ?: run {
            reply(error(refId, "accessibility_disabled", "Accessibility 未开启"))
            null
        }

    private fun phoneLocked(): Boolean = context.getSystemService(KeyguardManager::class.java).isKeyguardLocked

    @Synchronized
    private fun saveContact(name: String, rawPhone: String): Boolean {
        val phone = "+" + rawPhone.filter(Char::isDigit)
        val lookupUri = android.net.Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            android.net.Uri.encode(phone),
        )
        context.contentResolver.query(
            lookupUri,
            arrayOf(ContactsContract.PhoneLookup._ID),
            null,
            null,
            null,
        )?.use { if (it.moveToFirst()) return false }

        val operations = arrayListOf<ContentProviderOperation>()
        operations += ContentProviderOperation
            .newInsert(ContactsContract.RawContacts.CONTENT_URI)
            .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
            .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
            .build()
        operations += ContentProviderOperation
            .newInsert(ContactsContract.Data.CONTENT_URI)
            .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
            .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
            .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, name)
            .build()
        operations += ContentProviderOperation
            .newInsert(ContactsContract.Data.CONTENT_URI)
            .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
            .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
            .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone)
            .withValue(ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
            .build()
        context.contentResolver.applyBatch(ContactsContract.AUTHORITY, operations)
        return true
    }

    private fun prepareMedia(payload: JSONObject): File {
        val mime = payload.optString("mime")
        require(mime.isNotBlank()) { "缺少 MIME 类型" }
        val dir = File(context.cacheDir, "shared-media").apply { mkdirs() }
        val requestedName = payload.optString("fileName").ifBlank { "media" }
        val safeName = requestedName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
        val dataUrl = payload.optString("dataUrl")
        if (dataUrl.isNotBlank()) {
            val comma = dataUrl.indexOf(',')
            require(comma > 0 && dataUrl.substring(0, comma).contains(";base64")) {
                "dataUrl 必须是 base64"
            }
            // shortcut: 单行协议限 14 MiB 原始数据，支持大文件时改为分块传输。
            val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            require(bytes.isNotEmpty() && bytes.size <= 14 * 1024 * 1024) { "文件为空或超过 14 MiB" }
            val expiredBefore = System.currentTimeMillis() - java.util.concurrent.TimeUnit.DAYS.toMillis(1)
            dir.listFiles { entry -> entry.isDirectory && entry.name.startsWith("out-") && entry.lastModified() < expiredBefore }
                ?.forEach { it.deleteRecursively() }
            val cache = java.nio.file.Files.createTempDirectory(dir.toPath(), "out-").toFile()
            val name = safeName.takeUnless { it.isBlank() || it == "." || it == ".." } ?: "media"
            return File(cache, name).apply { writeBytes(bytes) }
        }
        val local = File(payload.optString("localPath")).canonicalFile
        require(local.path.startsWith(dir.canonicalPath + File.separator) && local.isFile &&
            local.length() in 1L..(14 * 1024 * 1024L)) {
            "手机缓存文件不存在"
        }
        return local
    }

    private fun openMediaShare(service: WaAssistService, file: File, payload: JSONObject) {
        val pkg = listOf("com.whatsapp.w4b", "com.whatsapp")
            .firstOrNull { context.packageManager.getLaunchIntentForPackage(it) != null }
            ?: throw IllegalStateException("WhatsApp 未安装")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = payload.optString("mime")
            setPackage(pkg)
            putExtra(Intent.EXTRA_STREAM, uri)
            payload.optString("caption").takeIf { it.isNotBlank() }
                ?.let { putExtra(Intent.EXTRA_TEXT, it) }
            payload.optString("phoneE164").filter { it.isDigit() }.takeIf { it.isNotBlank() }
                ?.let { putExtra("jid", "$it@s.whatsapp.net") }
            clipData = ClipData.newRawUri("media", uri)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        service.startActivity(intent)
    }

    private fun jsonArrayToList(arr: org.json.JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return buildList {
            for (i in 0 until arr.length()) add(arr.optString(i))
        }
    }

    companion object {
        private val INTERNATIONAL_PHONE = Regex("^\\+?[1-9][0-9]{6,14}$")
        private const val TAG = "MsgDispatch"
    }
}
