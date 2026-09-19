package com.wapplus.bridge.a11y

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.app.Notification
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.provider.ContactsContract
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * WhatsApp / WhatsApp Business 辅助操作（需用户在系统设置中开启）。
 *
 * - openChat: wa.me deep link
 * - typeText: 定位输入框 → ACTION_SET_TEXT，失败则剪贴板 + 粘贴
 * - clickSend: 按文案/描述/viewId 启发式点击发送
 */
class WaAssistService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingText: String? = null
    private var pendingSend: Boolean = false
    private var pendingCompletion: ((Boolean, String?) -> Unit)? = null
    private var lastNotification = ""
    private var lastNotificationAt = 0L
    private var syncInProgress = false
    private var searchInProgress = false
    // 命令代次：每次新的打字/发送命令自增。此前 postDelayed 的重试与超时回调
    // 从不取消——上一条命令遗留的超时会在新命令进行中触发，把新命令误判为
    // 「未找到输入框/发送按钮」而失败（桌面端随即标记失败并可能重发＝重复消息）。
    private var assistOpGeneration = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg != PACKAGE_WAB && pkg != PACKAGE_WA) return

        if (event.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            reportNotification(event)
            return
        }

        // 聊天界面就绪后消化排队动作
        if (pendingText != null || pendingSend) {
            mainHandler.postDelayed({ flushPending() }, 400)
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

    fun syncConversations(onComplete: (Boolean, String?, JSONArray?) -> Unit) {
        if (syncInProgress) {
            onComplete(false, "会话同步正在进行", null)
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
        val launch = packageManager.getLaunchIntentForPackage(targetPackage) ?: return
        syncInProgress = true
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        startActivity(launch)
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
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} = ?",
            arrayOf(name),
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use ""
            cursor.getString(0).orEmpty().replace(Regex("[\\s()\\-]"), "")
        }.orEmpty()
    }

    private fun finishConversationSync(
        contacts: LinkedHashMap<String, JSONObject>,
        onComplete: (Boolean, String?, JSONArray?) -> Unit,
        error: String? = null,
    ) {
        syncInProgress = false
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
        onComplete: (Boolean, String?, JSONArray?, Boolean) -> Unit,
    ) {
        if (searchInProgress) {
            onComplete(false, "联系人搜索正在进行", null, false)
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
        searchInProgress = true
        val launch = packageManager.getLaunchIntentForPackage(targetPackage)!!
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        startActivity(launch)
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
            val searchRoot = rootInActiveWindow
            val input = searchRoot?.let { findFirstEditable(it) }
            if (input == null) {
                searchRoot?.recycle()
                finishContactSearch(false, "未找到 WhatsApp 搜索框", null, false, onComplete)
                return@postDelayed
            }
            // 安全护栏：必须确认当前可编辑节点真的是搜索框，才能写入联系人名。
            // 否则（搜索按钮点击没生效时）会把名字打进正打开的聊天的消息输入框——
            // 桌面端随后的发送命令会把这段文字当消息发出去。
            val looksLikeSearch =
                input.viewIdResourceName?.contains("search", ignoreCase = true) == true ||
                    findByContentDesc(searchRoot) { desc ->
                        val value = desc.lowercase()
                        value.contains("search") || value.contains("搜索") ||
                            value.contains("clear") || value.contains("清除")
                    } != null
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
        val opened = hits.size == 1 && (
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
        onComplete(ok, error, items, opened)
    }

    fun openChat(phoneE164: String): Boolean {
        val digits = phoneE164.filter { it.isDigit() }
        if (digits.isBlank()) return false
        val uri = Uri.parse("https://wa.me/$digits")
        fun launch(pkg: String) {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                data = uri
                setPackage(pkg)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }
        try {
            launch(PACKAGE_WAB)
            Log.i(TAG, "openChat WAB $digits")
            return true
        } catch (e: Exception) {
            Log.w(TAG, "WAB missing, fallback WA", e)
            return runCatching { launch(PACKAGE_WA) }.isSuccess
        }
    }

    /**
     * 打开聊天并在界面就绪后输入（可选自动发送）。
     */
    fun openChatAndType(
        phoneE164: String,
        text: String,
        send: Boolean,
        onComplete: (Boolean, String?) -> Unit,
    ) {
        if (pendingCompletion != null) {
            onComplete(false, "已有消息正在发送")
            return
        }
        pendingText = text
        pendingSend = send
        pendingCompletion = onComplete
        if (!openChat(phoneE164)) {
            pendingText = null
            pendingSend = false
            finishPending(false, "WhatsApp 未安装或手机号无效")
            return
        }
        val gen = ++assistOpGeneration
        // 多次重试，适配 WA 启动慢
        listOf(350L, 700L, 1300L, 2200L).forEach { delay ->
            mainHandler.postDelayed({ if (gen == assistOpGeneration) flushPending() }, delay)
        }
        mainHandler.postDelayed({
            if (gen != assistOpGeneration) return@postDelayed
            if (pendingCompletion != null) {
                pendingText = null
                pendingSend = false
                finishPending(false, "未找到 WhatsApp 输入框或发送按钮")
            }
        }, 3200L)
    }

    fun typeText(text: String, onComplete: ((Boolean, String?) -> Unit)? = null) {
        if (onComplete != null && pendingCompletion != null) {
            onComplete(false, "已有命令正在执行")
            return
        }
        if (onComplete != null) pendingCompletion = onComplete
        pendingText = text
        val gen = ++assistOpGeneration
        if (tryTypeNow(text)) {
            pendingText = null
            if (!pendingSend) finishPending(true, null)
        } else {
            Log.i(TAG, "typeText queued")
            mainHandler.postDelayed({ if (gen == assistOpGeneration) flushPending() }, 600)
            mainHandler.postDelayed({ if (gen == assistOpGeneration) flushPending() }, 1500)
            if (onComplete != null) {
                mainHandler.postDelayed({
                    if (gen != assistOpGeneration) return@postDelayed
                    if (pendingCompletion != null && pendingText != null) {
                        pendingText = null
                        finishPending(false, "未找到 WhatsApp 输入框")
                    }
                }, 2500)
            }
        }
    }

    fun clickSend(onComplete: ((Boolean, String?) -> Unit)? = null) {
        if (onComplete != null && pendingCompletion != null) {
            onComplete(false, "已有命令正在执行")
            return
        }
        if (onComplete != null) pendingCompletion = onComplete
        pendingSend = true
        val gen = ++assistOpGeneration
        if (tryClickSendNow()) {
            pendingSend = false
            finishPending(true, null)
        } else {
            Log.i(TAG, "clickSend queued")
            mainHandler.postDelayed({ if (gen == assistOpGeneration) flushPending() }, 500)
            mainHandler.postDelayed({ if (gen == assistOpGeneration) flushPending() }, 1200)
            if (onComplete != null) {
                mainHandler.postDelayed({
                    if (gen != assistOpGeneration) return@postDelayed
                    if (pendingCompletion != null && pendingSend) {
                        pendingSend = false
                        finishPending(false, "未找到 WhatsApp 发送按钮")
                    }
                }, 2200)
            }
        }
    }

    private fun flushPending() {
        val text = pendingText
        if (text != null && tryTypeNow(text)) {
            pendingText = null
            // 仅打字（不发送）模式：文本就位即算完成。否则完成回调永远悬空，
            // 只能等超时误报「未找到输入框」——桌面端据此把气泡标成失败并
            // 重试，实际却已把文字打进聊天框＝重复输入。
            if (!pendingSend) finishPending(true, null)
        }
        if (pendingSend && pendingText == null && tryClickSendNow()) {
            pendingSend = false
            finishPending(true, null)
        }
    }

    private fun finishPending(ok: Boolean, error: String?) {
        val completion = pendingCompletion ?: return
        pendingCompletion = null
        completion(ok, error)
    }

    private fun tryTypeNow(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        try {
            val input = findInputNode(root) ?: return false
            input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)

            val args = Bundle().apply {
                putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    text
                )
            }
            if (input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                Log.i(TAG, "SET_TEXT ok len=${text.length}")
                return true
            }

            // 回退：剪贴板 + PASTE
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("wap_plus", text))
            if (input.performAction(AccessibilityNodeInfo.ACTION_PASTE)) {
                Log.i(TAG, "PASTE ok")
                return true
            }
            Log.w(TAG, "type failed on node ${input.className}")
            return false
        } finally {
            root.recycle()
        }
    }

    private fun tryClickSendNow(): Boolean {
        val root = rootInActiveWindow ?: return false
        try {
            val btn = findSendNode(root) ?: return false
            val clicked = btn.performAction(AccessibilityNodeInfo.ACTION_CLICK) ||
                clickParent(btn)
            Log.i(TAG, "clickSend=$clicked desc=${btn.contentDescription}")
            return clicked
        } finally {
            root.recycle()
        }
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

    private fun findInputNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        // 常见 WA 输入框 id（不同版本可能变化，配合 class 兜底）
        val idHints = listOf(
            "com.whatsapp.w4b:id/entry",
            "com.whatsapp:id/entry",
            "com.whatsapp.w4b:id/conversation_entry",
            "com.whatsapp:id/conversation_entry",
        )
        for (id in idHints) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            val hit = list?.firstOrNull { it.isEditable || it.className?.contains("EditText") == true }
            if (hit != null) return hit
        }

        // 文案提示
        for (hint in listOf("消息", "Message", "Type a message", "发消息")) {
            val list = root.findAccessibilityNodeInfosByText(hint)
            val hit = list?.firstOrNull {
                it.isEditable || it.className?.toString()?.contains("EditText") == true
            }
            if (hit != null) return hit
        }

        return findFirstEditable(root)
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

    private fun findSendNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val idHints = listOf(
            "com.whatsapp.w4b:id/send",
            "com.whatsapp:id/send",
            "com.whatsapp.w4b:id/conversation_entry_action_button",
            "com.whatsapp:id/conversation_entry_action_button",
            "com.whatsapp.w4b:id/send_button",
            "com.whatsapp:id/send_button",
        )
        for (id in idHints) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            val hit = list?.firstOrNull { it.isClickable || it.isEnabled }
            if (hit != null) return hit
        }

        for (label in listOf("发送", "Send", "Envoyer", "Enviar")) {
            val list = root.findAccessibilityNodeInfosByText(label)
            val hit = list?.firstOrNull { it.isClickable || it.parent?.isClickable == true }
            if (hit != null) return hit
        }

        // contentDescription 含 send
        return findByContentDesc(root) { desc ->
            val d = desc.lowercase()
            d.contains("send") || d.contains("发送") || d == "send"
        }
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
        private const val TAG = "WaAssist"
        const val PACKAGE_WAB = "com.whatsapp.w4b"
        const val PACKAGE_WA = "com.whatsapp"

        @Volatile
        var instance: WaAssistService? = null

        @Volatile
        var eventSink: ((String) -> Unit)? = null

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

        @Synchronized
        fun prepareMediaShare(
            messageId: String,
            jid: String,
            phoneE164: String,
            displayName: String,
            body: String,
            sentAt: Long,
        ) {
            pendingMedia = JSONObject()
                .put("messageId", messageId)
                .put("jid", jid)
                .put("phoneE164", phoneE164)
                .put("displayName", displayName)
                .put("body", body)
                .put("sentAt", sentAt)
        }

        @Synchronized
        fun acceptSharedMedia(mime: String, fileName: String, dataUrl: String): Boolean {
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
            val sink = eventSink
            if (sink == null) pendingMediaEvent = event else sink.invoke(event)
            return true
        }

        @Synchronized
        fun flushPendingMedia() {
            val event = pendingMediaEvent ?: return
            pendingMediaEvent = null
            eventSink?.invoke(event)
        }
    }
}
