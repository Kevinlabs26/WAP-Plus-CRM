package com.wapplus.bridge.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.wapplus.bridge.R

/**
 * 手机端悬浮客户卡：
 * 客户名 / 标签 / 阶段 / 下次跟进
 * 需 SYSTEM_ALERT_WINDOW 授权。
 */
class CustomerCardOverlay(private val context: Context) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var view: LinearLayout? = null

    data class Card(
        val contactName: String,
        val tags: List<String>,
        val stage: String,
        val nextFollowUp: String? = null,
        val aiSummary: String? = null,
    )

    fun show(card: Card) {
        hide()
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 24, 28, 24)
            setBackgroundColor(0xCC111827.toInt())
            addView(TextView(context).apply {
                text = "客户：${card.contactName}"
                textSize = 16f
                setTextColor(0xFFFFFFFF.toInt())
            })
            addView(TextView(context).apply {
                text = card.tags.joinToString(" · ")
                textSize = 12f
                setTextColor(0xFF25D366.toInt())
            })
            addView(TextView(context).apply {
                text = card.stage
                textSize = 13f
                setTextColor(0xFFE5E7EB.toInt())
            })
            if (!card.nextFollowUp.isNullOrBlank()) {
                addView(TextView(context).apply {
                    text = "跟进：${card.nextFollowUp}"
                    textSize = 12f
                    setTextColor(0xFF9CA3AF.toInt())
                })
            }
            if (!card.aiSummary.isNullOrBlank()) {
                addView(TextView(context).apply {
                    text = card.aiSummary
                    textSize = 12f
                    setTextColor(0xFFD1D5DB.toInt())
                })
            }
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 24
            y = 120
        }
        wm.addView(layout, params)
        view = layout
    }

    fun hide() {
        view?.let { runCatching { wm.removeView(it) } }
        view = null
    }
}
