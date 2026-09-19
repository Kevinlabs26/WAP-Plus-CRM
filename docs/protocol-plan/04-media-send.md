# 阶段 4：图片和文件发送

## 目标

通过 Android Bridge 完成 `wa.send_media` 的真机发送闭环。

## 修改范围

- `android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt`
- Android 媒体分享所需的 Manifest/FileProvider 配置
- `desktop/src-tauri/src/commands.rs`
- `desktop/src/lib/bridge.ts`
- `desktop/src/components/chat/Composer.tsx`
- 现有消息媒体展示与发送状态代码

## Android 任务

1. 校验 `localPath`、`mime`、文件存在性和合理大小。
2. 使用 Android 原生 `ACTION_SEND` 与安全内容 URI 交给 WhatsApp。
3. 支持图片、视频、PDF 和普通文件。
4. 支持可选 `caption`；平台不能可靠预填时返回明确说明。
5. 返回 ACK 或标准错误，不把打开分享页当成已送达。

## 桌面端任务

1. 增加 `send_whatsapp_media` Tauri 命令。
2. Composer 附件按钮按当前通道分发：
   - Baileys 使用现有媒体发送能力。
   - Android Bridge 发送 `wa.send_media`。
3. 消息气泡显示发送中、失败和可重试状态。

## 验收标准

- Android Bridge 能发送一张图片。
- Android Bridge 能发送一个 PDF。
- 文件不存在或权限不足时桌面端得到明确错误。
- Baileys 原有媒体发送不受影响。
