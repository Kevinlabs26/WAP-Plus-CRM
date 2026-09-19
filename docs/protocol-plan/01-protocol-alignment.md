# 阶段 1：统一共享协议

## 目标

让 `shared/protocol.ts` 描述当前真实通信内容，先修协议，再补功能。

## 修改范围

- `shared/protocol.ts`
- `desktop/src/lib/bridge.ts`
- 仅在类型需要落地时调整对应 ingest 文件

## 任务

1. 把代码已使用的消息加入 `MessageType`：
   - `messages.ack`
   - `presence.update`
   - `baileys.error`
   - `ping`
   - `pong`
2. 增加现有 payload 类型：
   - `ContactsSyncPayload`
   - `MessagesSyncPayload`
   - `MessageAckPayload`
   - `AckPayload`
   - `PresenceUpdatePayload`
   - `WaSyncConversations`
3. 修正 `DeviceHello`，加入实际已有的 `id`、`battery`、`accessibilityEnabled`。
4. 为 `Envelope` 和桌面端 `BridgeEvent` 复用同一套消息类型。
5. 保留 `wa.type_text`、`wa.send` 等已有类型，不做破坏性重命名。

## 验收标准

- TypeScript 类型检查通过。
- 源码中使用的协议消息都能在 `MessageType` 找到。
- payload 不再全部退化为无约束的 `Record<string, unknown>`。
- 现有发送和同步行为不变。
