# WAP Plus CRM — Desktop

Tauri 2 + React + TypeScript + Tailwind

## 开发

前置：Node 20+、Rust、WebView2；（可选）`adb` in PATH。

```bash
cd desktop
npm install
npm run dev          # 仅 UI → http://localhost:3000
npm run tauri dev    # 桌面壳 + Bridge TCP（真连接必需）
npm run mock-bridge  # 等价于 node ../tools/mock-bridge.mjs
```

从仓库根目录构建 Windows 安装包：

```bash
npm run release:win
```

## 发送通道（与代码一致）

| 通道 | 说明 |
|------|------|
| **baileys（默认）** | 内嵌扫码；需 **`tauri dev`**，由 `baileys-bridge` 子进程提供 |
| **android_bridge** | 真机备用；见 **`../docs/BRIDGE_SETUP.md`** |

完整说明：**`../docs/CHANNELS.md`**。

### Baileys

```bash
npm run tauri dev
# 顶栏 / 设置 → 连接 WhatsApp → 扫码
```

纯 `npm run dev` 只有 UI，**不能**启动 Baileys。

手工验收步骤见 **`../docs/CHANNELS.md`**「Baileys 手工验收」。

```bash
npm test            # resolveSendTarget 等轻量单测
```

### 真机 Bridge 联调

见 **`../docs/BRIDGE_SETUP.md`**。

摘要：先 `mock-bridge` 或真机 + `adb forward`，再 **`tauri dev`**，设置里通道选真机，手机页连接 `127.0.0.1:17890`。

## 目录

```
src/                 UI 工作台
src/channels/        baileys · android_bridge · 限速
src/lib/bridge.ts    Tauri invoke 安全封装
src/lib/baileys.ts   Baileys 命令封装
src/lib/aiSuggest.ts OpenAI / Groq / Gemini / Ollama / mock
src/components/bridge/  BaileysWatcher · BridgeWatcher · SendQueueWatcher
baileys-bridge/      内嵌 Baileys Node 服务
src-tauri/           Rust：Baileys 托管、TCP Bridge、ADB
```

## 数据

| 环境 | 引擎 |
|------|------|
| `npm run tauri dev` | **SQLite**（`app_data/wap-plus.db`，rusqlite） |
| `npm run dev` 浏览器 | IndexedDB + localStorage 备份 |

首次用桌面壳时，若 SQLite 为空会自动从 IndexedDB 迁移。设置里可看引擎与条数。
