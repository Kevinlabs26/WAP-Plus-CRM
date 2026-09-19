# Baileys Bridge 协议 v4

实现基线：Baileys `7.0.0-rc14`。共享类型位于 `shared/baileysProtocol.ts` 与 `shared/protocol.ts`。

**版本数字 SSOT：** [`shared/baileys-versions.json`](../shared/baileys-versions.json)  
（`baileysProtocol.ts` 与 `desktop/baileys-bridge/protocol.mjs` 均从此文件读取；改版本先改 JSON，再更新本文与库依赖。）

## 版本协商

`GET /status`、`GET /events` 和 `POST /sync` 均返回：

- `protocolVersion: 4`（与 `baileys-versions.json` 一致）
- `baileysVersion: "7.0.0-rc14"`

桌面端发现协议版本不一致时停止消费并显示明确错误，避免用旧结构静默解析新事件。

## 事件

事件统一包含 `seq`、`protocolVersion`、`type`、`ts`、`deviceId: "baileys"` 和 `payload`。

- `device.hello`
- `contacts.sync`
- `messages.sync`
- `messages.ack`
- `presence.update`
- `baileys.error`

联系人显式支持 PN/LID 双地址；消息显式支持媒体、引用操作 key、表情回应和投递回执。

v2 增加群聊：群以 `@g.us` 地址复用联系人/会话同步，消息携带 `isGroup`、`groupJid`、`senderJid` 和 `senderName`，发送接口直接接受群 JID。

v3 增加静态贴纸发送：`POST /send` 接受 `mediaType: "sticker"` 和 WebP `stickerDataUrl`。Emoji 继续作为普通 Unicode 文本发送，无需单独协议类型。

v4 增加动态 GIF：`POST /send` 接受 `mediaType: "gif"` 和 `gifDataUrl`。桥接会将 GIF 转为 MP4，并以 WhatsApp `gifPlayback` 视频消息发送。

## HTTP 接口

- 状态与同步：`/status`、`/events`、`/sync`、`/avatar`
- 会话：`/restart`、`/logout`、`/presence`、`/chat/modify`
- 消息：`/send`、`/messages/read`、`/message/delete`、`/message/react`、`/message/media`

所有接口只监听 `127.0.0.1`，并要求 `X-Wap-Token`。错误使用非 2xx 状态和 `{ "error": "..." }`。
