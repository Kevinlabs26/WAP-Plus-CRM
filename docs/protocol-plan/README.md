# Bridge 协议补全计划

> **状态：历史执行记录（2026-08-01）**  
> 多数阶段已完成；**现行协议 SSOT** 以仓库根目录 [`shared/protocol.ts`](../../shared/protocol.ts)、[`shared/baileysProtocol.ts`](../../shared/baileysProtocol.ts) 与 [`docs/BAILEYS_PROTOCOL.md`](../BAILEYS_PROTOCOL.md)、[`docs/CHANNELS.md`](../CHANNELS.md) 为准。  
> 本目录保留阶段说明与验收笔记，**不再作为未完成路线图**；真机待验收项见阶段 7。新协议变更请直接改 `shared/` 并更新上述现行文档，不必再开 plan 阶段文件。

目标：让 `shared/protocol.ts`、桌面端和 Android Bridge 的定义与行为一致，并补齐当前真正缺失的能力。

## 执行顺序

1. [统一共享协议](01-protocol-alignment.md) — ✅ 2026-08-01
2. [设备状态与电量上报](02-device-telemetry.md) — ✅ 2026-08-01
3. [ACK 与标准错误](03-ack-and-errors.md) — ✅ 2026-08-01
4. [图片和文件发送](04-media-send.md) — ✅ 2026-08-01
5. [悬浮客户卡片联动](05-overlay-card.md) — ✅ 2026-08-01
6. [联系人搜索](06-contact-search.md) — ✅ 2026-08-01
7. [验证与交付](07-verification.md) — ⚠️ 自动检查完成，真机待验收

## 优先级

- P0：阶段 1～3，先消除协议不一致和静默失败。
- P1：阶段 4～5，补齐用户能直接感知的能力。
- P2：阶段 6，仅在确实需要按名称搜索时实施。
- 收尾：阶段 7，每一阶段完成后执行对应检查，最后跑完整验收。

## 实施原则

- 不新增协议框架或代码生成器；继续使用现有 JSON envelope。
- 不删除现有消息类型，避免破坏兼容性。
- `wa.open_and_send` 继续作为桌面端默认文本发送流程。
- 每次只完成一个阶段，通过验收后再进入下一阶段。

## 完成定义

- 共享协议中的每种消息都有明确的发送方、接收方和 payload 类型。
- Android 命令不会静默失败，桌面端能展示具体结果。
- 文本、媒体、设备状态和悬浮卡片完成真机闭环。
- TypeScript、Rust、Android 构建和最小自动检查全部通过。

## 已完成记录

### 阶段 1 · 2026-08-01

- 修改：`shared/protocol.ts`、`desktop/src/lib/bridge.ts`、`desktop/src/lib/baileys.ts`、`desktop/src/components/layout/PhoneSidebar.tsx`
- 检查：Desktop 生产构建通过；2 个现有测试通过；21 个协议消息名称覆盖通过
- 限制：仅统一类型，没有改变运行时通信行为

### 阶段 2 · 2026-08-01

- 修改：Android Bridge 服务、设备服务器、Accessibility 状态通知，以及 Desktop 设备状态模型和界面
- 检查：Desktop 生产构建通过；3 个测试通过；Android Debug APK 构建通过
- 限制：状态逻辑已自动验证，电量与权限变化仍需连接真机做最终交互验收

### 阶段 3 · 2026-08-01

- 修改：Android 命令回执、Accessibility 操作完成回调、Rust 响应判断与未等待事件保留、桌面打开聊天错误提示
- 检查：Android Debug APK、Desktop 生产构建、3 个前端测试和 Rust `cargo check` 通过
- 限制：Rust 测试二进制已编译，但本机以 `STATUS_ENTRYPOINT_NOT_FOUND` 无法启动；真机仍需验证 UI 控件查找错误码

### 阶段 4 · 2026-08-01

- 修改：Android FileProvider/媒体缓存与原生分享、Tauri `send_whatsapp_media`、现有 Composer 的 Android 媒体分支
- 检查：Android Debug APK、Desktop 生产构建、3 个前端测试和 Rust `cargo check` 通过
- 限制：Bridge 文件上限 14MB；Android 返回“分享页已打开”，用户仍需在手机确认发送，因此不会误标为已送达

### 阶段 5 · 2026-08-01

- 修改：桌面联系人选择与 Android 悬浮卡片联动、重复内容去重、离开聊天/切换通道/Bridge 断线自动隐藏、权限错误提示
- 检查：Android Debug APK、Desktop 生产构建、3 个前端测试和 Rust `cargo check` 通过
- 限制：悬浮窗授权、卡片位置和不同 Android 厂商系统上的显示效果仍需真机交互验收

### 阶段 6 · 2026-08-01

- 修改：新增 `wa.search_contact` 运行链路；无发送地址的 Android 客户可按完整名称搜索，唯一结果自动打开，多结果只返回候选
- 检查：Android Debug APK、Desktop 生产构建、3 个前端测试和 Rust `cargo check` 通过
- 限制：WhatsApp 的 Accessibility view id 可能随版本变化，搜索按钮、结果识别和多语言界面仍需真机验收

### 阶段 7 · 2026-08-01

- 自动检查：Desktop 生产构建、3 个前端测试、Rust `cargo check`、Android Debug APK、Baileys 全部 `.mjs` 语法检查通过
- 协议覆盖：共享协议声明 21 种消息；源码使用的 17 种点分消息全部存在于 `MessageType`，无遗漏
- 交付物：`android/app/build/outputs/apk/debug/app-debug.apk`，SHA-256 `92C41F98EA660F8C8DEB5EC7E3D337AAAF79DBDCFA76651A1983F717848F30B1`
- 真机状态：ADB 当前未检测到设备，因此 USB 重连、权限、电量、文本/媒体发送、联系人搜索和悬浮卡片仍待真机验收
