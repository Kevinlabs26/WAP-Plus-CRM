# WAP Plus CRM — 技术架构

## 1. 仓库布局

```
BridgeCRM/
├── desktop/                 # Tauri 2 桌面端
│   ├── src/                 # React + TypeScript 前端
│   ├── src/channels/        # baileys（默认）· android_bridge
│   ├── baileys-bridge/      # 内嵌 Baileys Node 子进程
│   ├── src-tauri/           # Rust（Baileys 托管 / ADB / Bridge TCP / SQLite）
│   └── package.json
├── android/                 # Android Bridge（备用通道）
│   └── app/src/main/        # Kotlin + Compose
├── shared/                  # 协议与共享类型（JSON Schema / TS types）
└── docs/                    # 含 CHANNELS.md
```

## 2. 通信链路

### 2.1 默认：内嵌 Baileys

```
[Desktop UI]
    │  Tauri Commands / Events
    ▼
[Rust Core] ──spawn/manage──► [baileys-bridge Node]
    │                              │
    └──── status / send / events ──┘
                    │
                    ▼
            [WhatsApp 会话（扫码）]
```

详见 [`CHANNELS.md`](CHANNELS.md)。

### 2.2 备用：真机 Android Bridge

```
[Desktop UI]
    │  Tauri Commands / Events
    ▼
[Rust Core]
    │  ADB forward / TCP
    ▼
[Android Bridge Service]
    │  Accessibility / Intent / Overlay
    ▼
[WhatsApp Business]
```

### 消息类型（shared/protocol · 真机）
- `device.hello` / `device.status` / `device.battery`
- `wa.open_chat` / `wa.type_text` / `wa.send` / `wa.send_media`
- `contacts.sync` / `messages.sync`
- `overlay.show_card` / `overlay.hide`

## 3. 数据流

### Baileys（默认）
1. 用户扫码连接；`BaileysWatcher` 拉事件
2. Desktop 写入 SQLite / 本地存储
3. 用户确认回复 → `dispatchSendText` → `baileys_send`
4. 回写 Messages / FollowUps / AIHistory

### 真机 Bridge
1. Android 上报设备状态与新 WhatsApp 通知
2. Desktop 写入 SQLite（Drizzle）
3. 用户在 CRM 点联系人 → 查绑定手机 → 发 `wa.open_chat`
4. AI 模块读 Messages + Contact 生成建议 → 用户确认后 `wa.type_text` + `wa.send`
5. 回写 Messages / FollowUps / AIHistory

## 4. 安全边界
- Accessibility 仅在用户明确授权后启用
- Windows 桌面版 API Key 使用当前用户绑定的 DPAPI 加密，保存到 `secrets.dpapi`；SQLite、IndexedDB 快照和数据导出均不写入明文 Key
- ADB / Bridge 端口仅本机，不开放公网（默认）
- CRM 消息库和 Baileys 会话凭证留在当前用户的应用数据目录，不进 Git；当前依赖 Windows 用户目录权限，尚未做内容级静态加密
- 多租户 / 云同步留给 Business 版

## 5. MVP 范围边界
- 单机；默认单 Baileys 会话（或单台真机）
- 文本消息为主
- 仅 baileys + android_bridge 两通道（见 CHANNELS.md）
- **主聊天 UX = 自建气泡工作台**（见 REQUIREMENTS.md）；不是中间嵌手机投屏
- 真机通道下可选的 ADB screencap / 调试预览若存在，仅为排障辅助，**不构成产品主路径**，也不与 scrcpy 投屏控制方案等同

## 6. 前端代码分层（desktop/src）

依赖方向严格单向，不反向引用：

```
App.tsx / main.tsx        装配层（lazy 路由重模块，启动闪屏）
components/               纯 UI + 与 UI 内聚的逻辑
├── ui/                   最底层原子组件（Avatar / primitives / Toast / Confirm / ErrorBoundary）
├── brand/ layout/        框架与导航（TopBar、PhoneSidebar、StatsBar）
├── chat/ crm/ settings/ views/ bridge/   业务视图与组件
├── views/                页面级视图（CrmView / PhonesView / BroadcastView …）
channels/                 发送通道抽象（baileys / android_bridge / rateLimit / sendGate）
store/                    zustand slices + 纯 ingest/reconcile 逻辑
lib/                      纯函数库（无组件、无 store 运行时依赖）
db/                       drizzle schema（持久化契约）
types/                    共享类型（account / broadcast / crm）
```

依赖方向（已验证）：
- `store` 不 import `components`；`lib` 不 import `components`
- `lib → store` 仅 type-only（`import type`，编译期擦除，无运行时循环）
- `channels → lib` 单向
- `components → store / lib / channels` 单向

### 6.1 约定与边界

- **store 切片**：每个动作域一个 slice（`*Slice.ts` / `*Actions.ts`）；bridge 事件摄入拆成纯函数（`ingestSlice` + `parseMessageItem` / `parseContactItem` / `contactIngest` / `messagesIngest` / `chatReconcile`），保持 `set()` 回调薄而可读。
- **lib/baileys.ts 是命令封装层**，按职责拆为 `baileysCore`（runtime/request）/ `baileysSend` / `baileysChatActions` / `baileysLabels`，`baileys.ts` 作统一 re-export 入口（既有 import 兼容）。
- **组件内逻辑**：页面级组件抽出的纯函数 helper 放同目录（如 `views/crmCardHelpers.ts`、`layout/useSidebarData.ts`）；`components/chat/*.ts` 内的发送动作（`sendXxxMessage` / `beginVoiceRecording` 等）是与发送 UI 内聚的逻辑模块，**不搬入 lib**——搬动会引入 `lib → store` 运行时依赖，破坏分层。
- **测试**：覆盖 `lib` 与 `store` 的纯函数（`tests/*.test.mjs`，`node --experimental-strip-types`）；UI 组件因依赖 zustand store 难 mock，不做单测（有意的取舍）。
- **新文件放哪**：纯逻辑无 UI → `lib/` 或 `store/`（按是否操作全局状态）；有 UI 且体积大 → 同目录抽子组件（保持组件 < 800 行左右）；只被单个页面用的 helper → 该页面同目录。
