package com.wapplus.bridge.a11y

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.app.Notification
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.wapplus.bridge.net.MediaSharePolicy
import android.provider.Settings
import android.provider.ContactsContract
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * WhatsApp / WhatsApp Business 辅助操作（需用户在系统设置中开启）。
 *
 * - openChat: wa.me deep link
 * - openChatAndType: 核验目标会话后输入并发送
 */
class WaAssistService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var textSendInProgress = false
    private var lastNotification = ""
    private var lastNotificationAt = 0L
    private var syncInProgress = false
    private var searchInProgress = false
    private var navigationConnected: (() -> Boolean)? = null
    val whatsappBusy: Boolean
        get() = textSendInProgress || syncInProgress || searchInProgress

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg != PACKAGE_WAB && pkg != PACKAGE_WA) return

        if (event.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            reportNotification(event)
        }
    }

    override fun onInterrupt() {}

    private fun reportNotification(event: AccessibilityEvent) {
        val notification = event.parcelableData as? Notification ?: return
        val title =
            notification.extras.getCharSequence(Notification.EXTRA_TITLE)
                ?.toString()?.trim().orEmpty()
        val body =
            notification.extras.getCharSequence(Notification.EXTRA_TEXT)
                ?.toString()?.trim().orEmpty()
        if (title.isBlank() || body.isBlank()) return

        val now = System.currentTimeMillis()
        val fingerprint = "$title\u0000$body"
        if (fingerprint == lastNotification && now - lastNotificationAt < 3000) return
        lastNotification = fingerprint
        lastNotificationAt = now

        val deviceId =
            Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
                ?: "android-bridge"
        val phone =
            title.replace(" ", "").takeIf { it.matches(Regex("^\\+?\\d{7,15}$")) }.orEmpty()
        val contact =
            JSONObject()
                .put("displayName", title.take(200))
                .put("phoneE164", phone)
        // ponytail: live-only capture; add an Android queue if offline collection becomes required.
        eventSink?.invoke(
            envelope(
                "contacts.sync",
                deviceId,
                JSONObject().put("items", JSONArray().put(contact))
            )
        )
        val message =
            JSONObject(contact.toString())
                .put("id", "wa-notification-$deviceId-$now")
                .put("body", body.take(10_000))
                .put("direction", "in")
                .put("sentAt", now)
        val voice = Regex("(语音消息|语音|voice message|voice note)", RegexOption.IGNORE_CASE)
            .containsMatchIn(body)
        if (voice) {
            val seconds = Regex("(\\d+(?:[.,]\\d+)?)\\s*(?:秒|s|sec)", RegexOption.IGNORE_CASE)
                .find(body)
                ?.groupValues
                ?.getOrNull(1)
                ?.replace(',', '.')
                ?.toDoubleOrNull()
                ?.toInt()
                ?: 0
            message
                .put("mediaType", "audio")
                .put("mediaPtt", true)
                .put("mediaSeconds", seconds)
                .put("mediaPending", true)
                .put("mediaSource", "android-notification")
        }
        eventSink?.invoke(
            envelope(
                "messages.sync",
                deviceId,
                JSONObject().put("items", JSONArray().put(message))
            )
        )
    }

    private fun envelope(type: String, deviceId: String, payload: JSONObject): String =
        JSONObject()
            .put("id", "$type-${System.currentTimeMillis()}")
            .put("type", type)
            .put("ts", System.currentTimeMillis())
            .put("deviceId", deviceId)
            .put("payload", payload)
            .toString()

    fun syncConversations(isConnected: () -> Boolean, onComplete: (Boolean, String?, JSONArray?) -> Unit) {
        if (whatsappBusy) {
            onComplete(false, "手机正在操作 WhatsApp", null)
            return
        }
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            onComplete(false, "请先解锁手机", null)
            return
        }
        val targetPackage =
            listOf(PACKAGE_WAB, PACKAGE_WA)
                .firstOrNull { packageManager.getLaunchIntentForPackage(it) != null }
        if (targetPackage == null) {
            onComplete(false, "未安装 WhatsApp", null)
            return
        }
        val launch = packageManager.getLaunchIntentForPackage(targetPackage)
        if (launch == null) {
            onComplete(false, "无法打开 WhatsApp", null)
            return
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        if (runCatching { startActivity(launch) }.isFailure) {
            onComplete(false, "无法打开 WhatsApp", null)
            return
        }
        syncInProgress = true
        navigationConnected = isConnected
        mainHandler.postDelayed({
            scanConversationPage(
                targetPackage,
                linkedMapOf(),
                lastSignature = "",
                page = 0,
                retries = 0,
                onComplete = onComplete,
            )
        }, 1200L)
    }

    private fun scanConversationPage(
        targetPackage: String,
        contacts: LinkedHashMap<String, JSONObject>,
        lastSignature: String,
        page: Int,
        retries: Int,
        onComplete: (Boolean, String?, JSONArray?) -> Unit,
    ) {
        if (navigationConnected?.invoke() != true) {
            finishConversationSync(contacts, onComplete, "Bridge 已断开")
            return
        }
        val root = rootInActiveWindow
        if (root == null || root.packageName?.toString() != targetPackage) {
            root?.recycle()
            if (retries < 5) {
                mainHandler.postDelayed({
                    scanConversationPage(
                        targetPackage,
                        contacts,
                        lastSignature,
                        page,
                        retries + 1,
                        onComplete,
                    )
                }, 700L)
            } else {
                finishConversationSync(contacts, onComplete, "请保持 WhatsApp 聊天列表在前台")
            }
            return
        }

        val rowId = "$targetPackage:id/contact_row_container"
        val nameId = "$targetPackage:id/conversations_row_contact_name"
        val previewId = "$targetPackage:id/single_msg_tv"
        val namesOnPage = mutableListOf<String>()
        val rows = root.findAccessibilityNodeInfosByViewId(rowId).orEmpty()
        for (row in rows) {
            val name = nodeText(row, nameId)
            if (
                name.isNotBlank() &&
                !name.contains("（你）") &&
                !name.endsWith("(You)", ignoreCase = true)
            ) {
                namesOnPage += name
                val compactPhone = name.replace(Regex("[\\s()\\-]"), "")
                val phone =
                    compactPhone.takeIf { it.matches(Regex("^\\+?\\d{7,15}$")) }
                        ?: phoneForContact(name)
                contacts.putIfAbsent(
                    name.lowercase(),
                    JSONObject()
                        .put("displayName", name.take(200))
                        .put("phoneE164", phone)
                        .put("lastMessage", nodeText(row, previewId).take(500))
                )
            }
            row.recycle()
        }

        val signature = namesOnPage.joinToString("\u0000")
        val lists = root.findAccessibilityNodeInfosByViewId("android:id/list").orEmpty()
        val scrolled =
            signature.isNotBlank() &&
                signature != lastSignature &&
                contacts.size < 500 &&
                page < 80 &&
                lists.firstOrNull()?.performAction(
                    AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                ) == true
        lists.forEach { it.recycle() }
        root.recycle()

        if (!scrolled) {
            finishConversationSync(contacts, onComplete)
            return
        }
        mainHandler.postDelayed({
            scanConversationPage(
                targetPackage,
                contacts,
                signature,
                page + 1,
                retries = 0,
                onComplete,
            )
        }, 650L)
    }

    private fun nodeText(node: AccessibilityNodeInfo, viewId: String): String {
        val matches = node.findAccessibilityNodeInfosByViewId(viewId).orEmpty()
        val text = matches.firstNotNullOfOrNull { it.text?.toString()?.trim() }.orEmpty()
        matches.forEach { it.recycle() }
        return text
    }

    private fun phoneForContact(name: String): String {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED)
            return ""
        return contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER, ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} = ?",
            arrayOf(name),
            null,
        )?.use { cursor ->
            var confirmed = ""
            while (cursor.moveToNext()) {
                val raw = cursor.getString(0) ?: cursor.getString(1).orEmpty()
                val number = raw.replace(Regex("[\\s()\\-]"), "")
                if (!number.matches(Regex("^\\+[1-9][0-9]{6,14}$"))) return@use ""
                if (confirmed.isNotEmpty() && confirmed != number) return@use ""
                confirmed = number
            }
            confirmed
        }.orEmpty()
    }

    private fun finishConversationSync(
        contacts: LinkedHashMap<String, JSONObject>,
        onComplete: (Boolean, String?, JSONArray?) -> Unit,
        error: String? = null,
    ) {
        syncInProgress = false
        navigationConnected = null
        if (error != null) {
            onComplete(false, error, null)
            return
        }
        if (contacts.isEmpty()) {
            onComplete(false, "未读取到会话，请解锁手机并停留在 WhatsApp 聊天列表", null)
            return
        }
        val items = JSONArray()
        contacts.values.forEach { items.put(it) }
        Log.i(TAG, "synced conversations=${contacts.size}")
        onComplete(true, null, items)
    }

    fun searchContact(
        query: String,
        isConnected: () -> Boolean,
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        if (whatsappBusy) {
            onComplete(false, "手机正在操作 WhatsApp", null, false)
            return
        }
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            onComplete(false, "请先解锁手机", null, false)
            return
        }
        val targetPackage =
            listOf(PACKAGE_WAB, PACKAGE_WA)
                .firstOrNull { packageManager.getLaunchIntentForPackage(it) != null }
        if (targetPackage == null) {
            onComplete(false, "未安装 WhatsApp", null, false)
            return
        }
        val launch = packageManager.getLaunchIntentForPackage(targetPackage)
        if (launch == null) {
            onComplete(false, "无法打开 WhatsApp", null, false)
            return
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (runCatching { startActivity(launch) }.isFailure) {
            onComplete(false, "无法打开 WhatsApp", null, false)
            return
        }
        searchInProgress = true
        navigationConnected = isConnected
        mainHandler.postDelayed(
            { openContactSearch(targetPackage, query, 0, onComplete) },
            1000L,
        )
    }

    private fun openContactSearch(
        targetPackage: String,
        query: String,
        retries: Int,
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        if (navigationConnected?.invoke() != true) {
            finishContactSearch(false, "Bridge 已断开", null, false, onComplete)
            return
        }
        val root = rootInActiveWindow
        if (root == null || root.packageName?.toString() != targetPackage) {
            root?.recycle()
            if (retries < 4) {
                mainHandler.postDelayed(
                    { openContactSearch(targetPackage, query, retries + 1, onComplete) },
                    500L,
                )
            } else {
                finishContactSearch(false, "无法打开 WhatsApp 搜索", null, false, onComplete)
            }
            return
        }

        val existingInput = findFirstEditable(root)
            ?.takeIf { it.viewIdResourceName?.contains("search", ignoreCase = true) == true }
        if (existingInput != null) {
            setSearchText(existingInput, query, targetPackage, onComplete)
            root.recycle()
            return
        }

        val ids = listOf(
            "$targetPackage:id/menuitem_search",
            "$targetPackage:id/search",
            "$targetPackage:id/search_action",
        )
        val search = ids.firstNotNullOfOrNull { id ->
            root.findAccessibilityNodeInfosByViewId(id).orEmpty()
                .firstOrNull { it.isClickable && it.isEnabled }
        } ?: findByContentDesc(root) { desc ->
            val value = desc.lowercase()
            value == "搜索" || value == "search" || value == "rechercher" || value == "buscar"
        }
        val clicked = search?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true ||
            (search != null && clickParent(search))
        root.recycle()
        if (!clicked) {
            finishContactSearch(false, "未找到 WhatsApp 搜索按钮", null, false, onComplete)
            return
        }
        mainHandler.postDelayed({
            if (navigationConnected?.invoke() != true) {
                finishContactSearch(false, "Bridge 已断开", null, false, onComplete)
                return@postDelayed
            }
            val searchRoot = rootInActiveWindow
            val input = searchRoot?.takeIf { it.packageName?.toString() == targetPackage }
                ?.let { findFirstEditable(it) }
            if (searchRoot == null || input == null) {
                searchRoot?.recycle()
                finishContactSearch(false, "未找到 WhatsApp 搜索框", null, false, onComplete)
                return@postDelayed
            }
            // 安全护栏：必须确认当前可编辑节点真的是搜索框，才能写入联系人名。
            // 否则（搜索按钮点击没生效时）会把名字打进正打开的聊天的消息输入框——
            // 桌面端随后的发送命令会把这段文字当消息发出去。
            val looksLikeSearch = input.viewIdResourceName?.contains("search", ignoreCase = true) == true
            if (!looksLikeSearch && retries < 4) {
                searchRoot.recycle()
                mainHandler.postDelayed(
                    { openContactSearch(targetPackage, query, retries + 1, onComplete) },
                    500L,
                )
                return@postDelayed
            }
            if (!looksLikeSearch) {
                searchRoot.recycle()
                finishContactSearch(false, "未能确认 WhatsApp 搜索框已打开", null, false, onComplete)
                return@postDelayed
            }
            setSearchText(input, query, targetPackage, onComplete)
            searchRoot.recycle()
        }, 500L)
    }

    private fun setSearchText(
        input: AccessibilityNodeInfo,
        query: String,
        targetPackage: String,
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, query)
        }
        if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            finishContactSearch(false, "无法输入联系人名称", null, false, onComplete)
            return
        }
        mainHandler.postDelayed(
            { readContactSearchResults(targetPackage, query, onComplete) },
            900L,
        )
    }

    private fun readContactSearchResults(
        targetPackage: String,
        query: String,
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        if (navigationConnected?.invoke() != true) {
            finishContactSearch(false, "Bridge 已断开", null, false, onComplete)
            return
        }
        val root = rootInActiveWindow
        if (root == null || root.packageName?.toString() != targetPackage) {
            root?.recycle()
            finishContactSearch(false, "WhatsApp 搜索页不可用", null, false, onComplete)
            return
        }
        val hits = mutableListOf<AccessibilityNodeInfo>()
        val seen = mutableSetOf<String>()
        collectExactContactHits(root, query, hits, seen)
        val items = JSONArray()
        hits.forEachIndexed { index, node ->
            items.put(
                JSONObject()
                    .put("displayName", node.text?.toString()?.trim().orEmpty())
                    .put("resultIndex", index)
            )
        }
        val opened = hits.size == 1 && navigationConnected?.invoke() == true && (
            hits[0].performAction(AccessibilityNodeInfo.ACTION_CLICK) || clickParent(hits[0])
        )
        hits.forEach { it.recycle() }
        root.recycle()
        when {
            hits.isEmpty() ->
                finishContactSearch(false, "未找到完整名称为“$query”的联系人", null, false, onComplete)
            hits.size == 1 && !opened ->
                finishContactSearch(false, "找到联系人但无法打开聊天", null, false, onComplete)
            else -> finishContactSearch(true, null, items, opened, onComplete)
        }
    }

    private fun collectExactContactHits(
        node: AccessibilityNodeInfo,
        query: String,
        hits: MutableList<AccessibilityNodeInfo>,
        seen: MutableSet<String>,
    ) {
        val text = node.text?.toString()?.trim().orEmpty()
        val viewId = node.viewIdResourceName.orEmpty().lowercase()
        val isContactName =
            viewId.contains("contact_name") ||
                viewId.contains("contactpicker_row_name") ||
                viewId.contains("conversations_row_contact_name")
        if (isContactName && !node.isEditable && text.equals(query.trim(), ignoreCase = true)) {
            val bounds = Rect().also { node.getBoundsInScreen(it) }
            if (bounds.width() > 0 && bounds.height() > 0 && seen.add(bounds.flattenToString())) {
                hits += node
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectExactContactHits(it, query, hits, seen) }
        }
    }

    private fun finishContactSearch(
        ok: Boolean,
        error: String?,
        items: JSONArray?,
        opened: Boolean,
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        searchInProgress = false
        navigationConnected = null
        onComplete(ok, error, items, opened)
    }

    fun openChat(phoneE164: String): Boolean = launchChat(phoneE164) != null

    private fun launchChat(phoneE164: String, challenge: String? = null): String? {
        val digits = phoneE164.filter { it in '0'..'9' }
        if (digits.isBlank()) return null
        val link = Uri.parse("https://wa.me/$digits").buildUpon()
        if (challenge != null) link.appendQueryParameter("text", challenge)
        val uri = link.build()
        return listOf(PACKAGE_WAB, PACKAGE_WA).firstOrNull { pkg ->
            runCatching {
                startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(pkg)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }.isSuccess
        }
    }

    fun openChatAndType(
        phoneE164: String,
        text: String,
        confirmSent: Boolean,
        isConnected: () -> Boolean,
        onComplete: (code: String?, message: String?, confirmed: Boolean) -> Unit,
    ) {
        if (whatsappBusy) {
            onComplete("whatsapp_busy", "手机正在操作 WhatsApp", false)
            return
        }
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            onComplete("phone_locked", "请先解锁手机", false)
            return
        }

        // WhatsApp 按深链号码把一次性字符串填入目标会话。联系人标题不能证明号码。
        val challenge = "WAP-" + UUID.randomUUID()
        val targetPackage = launchChat(phoneE164, challenge)
        if (targetPackage == null) {
            onComplete("whatsapp_not_installed", "无法打开手机上的 WhatsApp", false)
            return
        }
        textSendInProgress = true
        val deadline = SystemClock.elapsedRealtime() + 5_000L

        fun finish(code: String?, message: String?, confirmed: Boolean = false) {
            textSendInProgress = false
            onComplete(code, message, confirmed)
        }

        fun awaitReceipt(window: Int, composer: Int, title: String, previous: Set<Int>, until: Long) {
            if (!isConnected() || keyguard.isKeyguardLocked || SystemClock.elapsedRealtime() >= until) {
                finish(null, null)
                return
            }
            val root = rootInActiveWindow
            val input = root?.let { conversationInput(it, targetPackage) }
            val sameChat = root != null && input != null && input.hashCode() == composer && root.windowId == window &&
                nodeText(root, "$targetPackage:id/conversation_contact_name") == title
            val matches = if (sameChat && (input?.isShowingHintText == true || input?.text.isNullOrEmpty()))
                messageMatches(checkNotNull(root), targetPackage, text) else emptyMap()
            input?.recycle()
            root?.recycle()
            if (matches.size > previous.size && matches.any { (id, sent) -> sent && id !in previous }) {
                finish(null, null, confirmed = true)
            } else if (!sameChat) finish(null, null)
            else mainHandler.postDelayed({ awaitReceipt(window, composer, title, previous, until) }, 250L)
        }

        fun trySend() {
            if (!isConnected()) {
                finish("bridge_disconnected", "Bridge 已断开")
                return
            }
            if (keyguard.isKeyguardLocked) {
                finish("phone_locked", "请先解锁手机")
                return
            }
            if (SystemClock.elapsedRealtime() >= deadline) {
                finish("chat_unverified", "未能核验 WhatsApp 目标会话，请在手机检查号码与界面")
                return
            }

            val root = rootInActiveWindow
            val input = root?.let { conversationInput(it, targetPackage) }
            if (root == null || input == null || input.text?.toString() != challenge) {
                input?.recycle()
                root?.recycle()
                mainHandler.postDelayed({ trySend() }, 200L)
                return
            }
            val readyButton = findSendNode(root, targetPackage)
            if (readyButton == null) {
                input.recycle()
                root.recycle()
                mainHandler.postDelayed({ trySend() }, 200L)
                return
            }
            readyButton.recycle()
            val title = if (confirmSent) nodeText(root, "$targetPackage:id/conversation_contact_name") else ""
            val previous = if (title.isNotBlank()) messageMatches(root, targetPackage, text).keys else emptySet()
            val window = root.windowId
            val composer = input.hashCode()

            var clickAttempted = false
            var clickAccepted = false
            val failure = runCatching {
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                }
                if (input.refresh() && input.text?.toString() == challenge &&
                    input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                ) {
                    val active = rootInActiveWindow
                    val currentInput = active?.let { conversationInput(it, targetPackage) }
                    try {
                        if (active != null && active == root && currentInput != null && currentInput == input) {
                            findSendNode(active, targetPackage)?.let { button ->
                                try {
                                    if (currentInput.refresh() && currentInput.text?.toString() == text &&
                                        !keyguard.isKeyguardLocked && SystemClock.elapsedRealtime() < deadline && isConnected()
                                    ) {
                                        clickAttempted = true
                                        clickAccepted = button.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                    }
                                } finally {
                                    button.recycle()
                                }
                            }
                        }
                    } finally {
                        currentInput?.recycle()
                        active?.recycle()
                    }
                }
            }.exceptionOrNull()
            input.recycle()
            root.recycle()

            if (clickAttempted) {
                // 一旦调用点击操作，返回值不能作为重发依据。
                if (clickAccepted && title.isNotBlank()) {
                    val until = SystemClock.elapsedRealtime() + 3_000L
                    mainHandler.postDelayed({ awaitReceipt(window, composer, title, previous, until) }, 250L)
                } else finish(null, null)
            } else {
                if (failure != null) Log.w(TAG, "Verified text send stopped before click", failure)
                finish("chat_unverified", "未能核验输入内容或发送按钮，请在手机检查会话")
            }
        }

        mainHandler.postDelayed({ trySend() }, 200L)
    }

    private fun messageMatches(root: AccessibilityNodeInfo, pkg: String, text: String): Map<Int, Boolean> {
        val textId = "$pkg:id/message_text"
        val matches = mutableMapOf<Int, Boolean>()
        for (node in root.findAccessibilityNodeInfosByViewId(textId).orEmpty()) {
            if (node.isVisibleToUser && node.text?.toString() == text) {
                var ancestor = node.parent
                var sent = false
                repeat(3) {
                    val row = ancestor ?: return@repeat
                    val bodies = row.findAccessibilityNodeInfosByViewId(textId).orEmpty()
                    val singleBody = bodies.size == 1
                    bodies.forEach { it.recycle() }
                    if (singleBody) for (statusId in listOf("status", "message_status")) {
                        val statuses = row.findAccessibilityNodeInfosByViewId("$pkg:id/$statusId").orEmpty()
                        sent = sent || statuses.any {
                            it.isVisibleToUser && it.contentDescription?.toString()?.trim()?.lowercase() in SENT_LABELS
                        }
                        statuses.forEach { it.recycle() }
                    }
                    ancestor = if (sent || !singleBody || it == 2) null else row.parent
                    row.recycle()
                }
                matches[node.hashCode()] = sent
            }
            node.recycle()
        }
        return matches
    }

    private fun conversationInput(root: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
        if (root.packageName?.toString() != pkg) return null
        for (id in listOf("entry", "conversation_entry")) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$pkg:id/$id").orEmpty()
            val input = nodes.singleOrNull { it.isEditable && it.isEnabled && it.isVisibleToUser }
            nodes.forEach { if (it !== input) it.recycle() }
            if (input != null) return input
        }
        return null
    }

    private fun clickParent(node: AccessibilityNodeInfo): Boolean {
        var p = node.parent
        var depth = 0
        while (p != null && depth < 5) {
            if (p.isClickable && p.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return true
            }
            val next = p.parent
            p.recycle()
            p = next
            depth++
        }
        return false
    }


    private fun findFirstEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable) return node
        val cn = node.className?.toString().orEmpty()
        if (cn.contains("EditText", ignoreCase = true)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findFirstEditable(child)
            if (found != null) return found
            child.recycle()
        }
        return null
    }

    private fun findSendNode(root: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
        for (id in listOf("send", "send_button")) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$pkg:id/$id").orEmpty()
            val button = nodes.singleOrNull { it.isClickable && it.isEnabled && it.isVisibleToUser }
            nodes.forEach { if (it !== button) it.recycle() }
            if (button != null) return button
        }
        return null
    }

    private fun findByContentDesc(
        node: AccessibilityNodeInfo,
        pred: (String) -> Boolean,
    ): AccessibilityNodeInfo? {
        val desc = node.contentDescription?.toString()
        if (!desc.isNullOrBlank() && pred(desc)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findByContentDesc(child, pred)
            if (found != null) return found
            child.recycle()
        }
        return null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        statusSink?.invoke()
        Log.i(TAG, "accessibility connected")
    }

    override fun onDestroy() {
        instance = null
        statusSink?.invoke()
        // 服务销毁时清掉所有挂起的重试/超时回调，避免它们在服务重建后
        // 对着过期的状态触发。
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private val SENT_LABELS = setOf("sent", "delivered", "read", "已发送", "已送达", "已读", "envoyé", "distribué", "lu")
        private const val TAG = "WaAssist"
        const val PACKAGE_WAB = "com.whatsapp.w4b"
        const val PACKAGE_WA = "com.whatsapp"

        @Volatile
        var instance: WaAssistService? = null

        @Volatile
        var eventSink: ((String) -> Boolean)? = null

        @Volatile
        var statusSink: (() -> Unit)? = null

        private fun envelope(type: String, deviceId: String, payload: JSONObject): String =
            JSONObject()
                .put("id", "$type-${System.currentTimeMillis()}")
                .put("type", type)
                .put("ts", System.currentTimeMillis())
                .put("deviceId", deviceId)
                .put("payload", payload)
                .toString()

        private var pendingMedia: JSONObject? = null
        private var pendingMediaEvent: String? = null
        private var pendingMediaPreparedAt = 0L
        private var pendingMediaGeneration = 0L

        @Synchronized
        fun pendingMediaShareTicket(): Long? {
            if (pendingMedia == null) return null
            if (instance == null || !MediaSharePolicy.isFresh(pendingMediaPreparedAt, SystemClock.elapsedRealtime())) {
                pendingMedia = null
                return null
            }
            return pendingMediaGeneration
        }

        @Synchronized
        fun prepareMediaShare(
            messageId: String,
            jid: String,
            phoneE164: String,
            displayName: String,
            body: String,
            sentAt: Long,
        ): Boolean {
            if (instance == null || pendingMediaEvent != null) return false
            if (pendingMediaShareTicket() != null) return pendingMedia?.optString("messageId") == messageId
            pendingMediaGeneration++
            pendingMediaPreparedAt = SystemClock.elapsedRealtime()
            pendingMedia = JSONObject()
                .put("messageId", messageId)
                .put("jid", jid)
                .put("phoneE164", phoneE164)
                .put("displayName", displayName)
                .put("body", body)
                .put("sentAt", sentAt)
            return true
        }

        @Synchronized
        fun acceptSharedMedia(ticket: Long, mime: String, fileName: String, dataUrl: String): Boolean {
            // Capture the ticket before reading the URI so a late result cannot attach to a newer request.
            if (pendingMediaShareTicket() == null || !MediaSharePolicy.isCurrentRequest(
                    ticket, pendingMediaGeneration, pendingMediaPreparedAt, SystemClock.elapsedRealtime()
                )) return false
            val target = pendingMedia ?: return false
            val deviceId = instance?.let {
                Settings.Secure.getString(it.contentResolver, Settings.Secure.ANDROID_ID)
            } ?: "android-bridge"
            val item = JSONObject(target.toString())
                .put("id", "shared-media-$deviceId-${System.currentTimeMillis()}")
                .put("targetMessageId", target.optString("messageId"))
                .put("mediaType", "audio")
                .put("mediaMime", mime.ifBlank { "audio/ogg" })
                .put("mediaFileName", fileName.ifBlank { "voice.ogg" })
                .put("mediaUrl", dataUrl)
                .put("mediaPtt", true)
                .put("mediaPending", false)
                .put("direction", "in")
            val event = envelope(
                "messages.sync",
                deviceId,
                JSONObject().put("items", JSONArray().put(item)).put("source", "android-media-share")
            )
            pendingMedia = null
            if (eventSink?.invoke(event) != true) pendingMediaEvent = event
            return true
        }

        @Synchronized
        fun flushPendingMedia() {
            val event = pendingMediaEvent ?: return
            if (eventSink?.invoke(event) == true) pendingMediaEvent = null
        }
    }
}
