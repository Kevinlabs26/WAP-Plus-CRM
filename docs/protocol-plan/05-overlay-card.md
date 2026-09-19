# 阶段 5：悬浮客户卡片联动

## 目标

桌面端选中客户时，手机显示对应 CRM 悬浮卡片。

## 修改范围

- `desktop/src/components/chat/ChatPanel.tsx`
- `desktop/src/lib/bridge.ts`
- `android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt`
- `android/app/src/main/java/com/wapplus/bridge/overlay/CustomerCardOverlay.kt`

## 任务

1. 选中 Android Bridge 客户时发送 `overlay.show_card`。
2. payload 包含：
   - 客户名称
   - 标签
   - 销售阶段
   - 下次跟进日期
   - AI 摘要
3. 切换客户时覆盖旧卡片。
4. 离开聊天、断开 Bridge 或切到非 Android 通道时发送 `overlay.hide`。
5. Android 检查悬浮窗权限；无权限时返回标准错误。
6. 相同内容不重复刷新，减少手机界面闪动。

## 验收标准

- 桌面切换客户后手机卡片内容同步变化。
- 离开聊天后卡片隐藏。
- 没有悬浮窗权限时桌面端提示如何处理。
- 标签、阶段和跟进日期与 CRM 当前数据一致。
