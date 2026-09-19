# 阶段 3：ACK 与标准错误

## 目标

所有桌面发往 Android 的命令都有成功、失败或超时结果。

## 修改范围

- `android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt`
- `desktop/src-tauri/src/bridge.rs`
- `desktop/src-tauri/src/commands.rs`
- `desktop/src/lib/bridge.ts`

## 任务

1. 为下列命令返回带 `refId` 的 ACK：
   - `wa.open_chat`
   - `wa.type_text`
   - `wa.send`
   - `wa.open_and_send`
   - `wa.sync_conversations`
   - `overlay.show_card`
   - `overlay.hide`
2. 参数缺失、权限关闭、找不到控件和执行异常统一返回 `error` envelope。
3. 未知消息类型返回 `unsupported_message_type`，不再只写日志。
4. 修复 `withA11y` 的静默返回，让调用者拿到失败原因。
5. 桌面端按 `refId` 匹配响应，并区分成功、失败和超时。

## 最小错误码

- `invalid_payload`
- `accessibility_disabled`
- `overlay_permission_denied`
- `whatsapp_not_installed`
- `ui_element_not_found`
- `unsupported_message_type`
- `command_timeout`

## 验收标准

- 关闭 Accessibility 后发送消息，桌面端显示具体原因。
- 发送空号码或空文本时收到 `invalid_payload`。
- 未知命令不会让桌面端一直等待。
- 成功执行时 ACK 的 `refId` 与原命令 ID 一致。
