# 发送通道架构（MessageChannel）

## 原则

| 通道 | 定位 | 状态 |
|------|------|------|
| **baileys** | **产品默认主路径**。桌面壳内嵌扫码；自建聊天气泡工作台 | ✅ 收发、历史、群、反应、媒体等主能力 |
| **android_bridge** | **真机备用**。经手机 WhatsApp Business 真实操作发出；能力**不对等** Baileys | ✅ 基础发送/设备状态 |

- **产品身份是 WAP Plus CRM（WhatsApp 销售工作台 + CRM）**；通道是连接引擎，不是首页。
- **默认体验 = Baileys 扫码 + 自建 UI**（不是手机投屏）。
- **防封主叙事只绑定真机 Bridge + 行为限速**，不把 Baileys 说成「更防封」。
- **不做 Cloud API**；**不做 WAHA**（已从代码库移除）。
- CRM、AI、队列、限速与通道实现解耦；文本发送统一 `dispatchSendText`（内含 `assertSendGate`）。
- **行为门闸（非官方防封）**：按 `accountId` 限速 · 新号 72h warmup 降额 · 成功后间隔抖动 · 跨号冷却 · 过热 red 拦截 · 监测页号级暂停 · 限速状态 localStorage 短持久化；文本 / 队列 / 媒体 / **克制群发**同一套。**不承诺不封号**。
- **克制群发**：CRM「群发」→ 单号 ≤50 · 仅 `{name}` `{company}` · `CampaignRunner` + `dispatchSendText`；新号 warmup 禁开；刷新后 running→paused。
- **能力边界（诚实）**：历史同步、表情回应（含群多人名单展开）、编辑/撤回、群管理、冷历史上滑、全局消息搜索磁盘侧等，均以 **Baileys** 为准；切到真机后上述能力可能缺失或降级——设置页「能做 / 不做」已写明。
- **真机预览**（ChatPanel 侧栏 screencap）仅排障，不是投屏主 UI。
- **账号监测** UI：顶栏「监测」→ `AccountMonitorView`。

## 代码位置

```
desktop/src/channels/
  types.ts           # ChannelId、SendTextResult、CHANNEL_META、限速类型
  rateLimit.ts       # 按 accountId 分钟/小时/间隔 + 跨号冷却
  sendGate.ts        # 暂停 / 过热 / 限速统一门闸
  baileys.ts         # 默认：invoke baileys_send / status
  androidBridge.ts   # 真机（Tauri type_and_send）
  index.ts           # normalizeChannelId + getChannel + dispatchSendText

desktop/src/lib/baileys.ts
desktop/src/components/bridge/BaileysWatcher.tsx
desktop/src/components/settings/BaileysConnectCard.tsx
desktop/baileys-bridge/          # Node 子进程
desktop/src-tauri/src/baileys.rs # 进程托管与命令
```

## 发送流程

```
ChatPanel 点发送
  → dispatchSendText(input, config)
       → normalizeChannelId（非 android_bridge → baileys）
       → checkRateLimit（行为层）
       → channel.sendText
            → baileys: baileys_send（已连接会话）
            → android_bridge: invoke type_and_send
  → 成功则乐观写入本地消息 + toast
```

## 通道归一化

`normalizeChannelId`（`channels/index.ts`）：

| 存盘 / 传入 | 实际使用 |
|-------------|----------|
| `baileys` | `baileys` |
| `android_bridge` | `android_bridge` |
| 历史 `waha` / `cloud_api` / 其它 | **`baileys`** |
| 缺省 | **`baileys`** |

设置里可选：`baileys` | `android_bridge`。

加载设置时会丢弃历史字段 `wahaBaseUrl` / `wahaApiKey` / `wahaSession`。

## Baileys 约定

- 仅 **`npm run tauri dev` / 打包桌面壳** 可启动子进程；纯浏览器 `npm run dev` 不能扫码发送。
- 状态 / 扫码 / 登出：设置页或顶栏「连接」→ `BaileysConnectCard`。
- 入站：`BaileysWatcher` 轮询事件并写入本地会话（cursor 持久化）。
- 未连接时发送入队（`queued` + `baileys_not_connected`），连上后由 `SendQueueWatcher` 冲刷。
- 发送目标：`resolveSendTarget` 优先 E.164，其次 PN jid，最后 `@lid`（bridge 会尝试 LID→PN）。
- 风控：与真机不同，话术上保持「正常人工频率 + 全局限速」，勿宣传官方或同等防封。

### Baileys 手工验收（MVP 闭环）

1. `cd desktop && npm run tauri dev`（不要只开浏览器 dev）
2. 顶栏 / 设置 → 扫码，状态变为已连接，自动同步联系人 toast
3. 侧栏点会话，右侧能看到历史/入站气泡（可先用手机给本号发一条）
4. 输入文本发送 → toast 成功，气泡 `sent`；对方手机收到
5. 点「退出登录」或断网后再发 → 应入队并提示；重新连上后自动发出（或点重试）
6. 限速：连续狂发 → 提示分钟/间隔限制，消息 `queued` 后自动重试
7. 无号码且仅有坏数据的联系人 → 明确错误，不静默失败

## 真机 Bridge 约定

- TCP（默认 `127.0.0.1:17890`）+ 可选 ADB forward。
- 详见 [`BRIDGE_SETUP.md`](BRIDGE_SETUP.md)、[`../android/README.md`](../android/README.md)。
- 联系人绑定 `deviceId`、切换手机等能力主要服务此通道。

## 设置项（AppSettings）

- `sendChannel`: `baileys`（默认）| `android_bridge`
- Bridge: `bridgeHost`, `bridgePort`, `autoConnectBridge`
- 限速: `ratePerMinute`, `ratePerHour`, `rateMinIntervalSec`

## 后续清单

### Baileys（优先）

1. 发送队列与断线重试体验打磨  
2. 入站与 CRM 字段（阶段、未读）进一步对齐  
3. 媒体发送（若协议侧支持再开）  
4. 多账号 / 会话隔离（若产品需要）

### 真机增强

1. 发送队列与失败重试  
2. 手机侧确认「气泡已出现」回执  
3. 按号码 warmup 策略  
4. 多设备实连

## 产品话术建议

- **对外默认**：**WhatsApp 销售 CRM；电脑扫码即可收发（Baileys）；也可绑定真实手机经 Bridge 发出**  
- **防封**：**仅在真机 + 限速语境下表述**；Baileys 说明为便捷通道，需自律频率  
- **不要说**：Baileys「比官方更防封」或与 Cloud API 混谈  
