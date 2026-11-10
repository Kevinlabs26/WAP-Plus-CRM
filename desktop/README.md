# WAP Plus CRM — Desktop

Tauri 2 + React + TypeScript + Tailwind

## 开发

前置：Node 22.23.4（与根目录 `.nvmrc` 一致）、Rust、WebView2、完整 Perl（SQLCipher 的 vendored OpenSSL 构建需要；Git for Windows 自带的精简 Perl 不够用，建议安装 Strawberry Perl）；（可选）`adb` in PATH。

Windows 可使用与 `.nvmrc` 同版本的官方便携 Node，放在根目录 `.audit-cache/node-v22.23.4-win-x64` 后，从仓库根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/project-node.ps1 run tauri -- dev`。入口会验证 Perl 包含 OpenSSL 所需模块，并只为 Tauri 开发启动临时设置独立 WebView2 数据目录，避免与已安装应用配置互锁；Node、Perl 和 WebView2 设置仅对子进程生效，不改系统默认值。入口也支持其他 npm 命令。

```bash
cd desktop
npm install
npm run dev          # 仅 UI → http://localhost:43871
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

### 通过群链接导入文件夹

文件夹菜单 → 导入与添加 → 粘贴链接并加入群组。每行一个邀请链接，选择对应的在线账号，点击「加入并归类」即可；「预览链接」仅查看，不会入群。预览会检查所有已同步账号：群已存在时优先归类已有群聊，账号专属文件夹会阻止跨账号重复入群。确认加入后，群资料在后台补充，不阻塞归类；只有本地归类保存完成才提示成功。若已入群但归类失败，使用「重试失败项」只补归类，不重复申请加入。需要管理员批准的群显示等待批准，不计入已导入。

### 云端图片

「设置 → 云端图片」单独连接 Google Drive 账号，选择目标文件夹和分享方式后保存。右键用户头像或聊天图片选择「上传到云端」，顶部统计条右侧显示上传阶段和真实进度；成功后自动复制链接，并在界面保留 10 秒供再次复制。新上传会替换当前状态。支持 PNG、JPEG、GIF、WebP，单张最多 8 MB。

复用构建时的 Google 桌面 OAuth 客户端（`WAP_GOOGLE_CLIENT_PATH` 或现有 `client_secret*.json`），在其 Google Cloud 项目启用 **Google Drive API**，并为 OAuth 配置 `https://www.googleapis.com/auth/drive` 范围。此权限用于浏览用户现有文件夹；需要重新完成一次云盘授权。授权凭据单独使用 Windows DPAPI 保存，不替换 Google 表格的授权配置。

公开链接允许任何持链接的人查看；指定邮箱模式不发送邮件通知，并拒绝继承公开、团队或其他邮箱权限的目标文件夹。分享失败不会显示为成功或复制链接；重试沿用本次生成的文件 ID，避免网络中断后重复上传。管理员限制外部分享时仍可能失败，状态卡会保留错误。

保留最近 30 个上传任务，Windows 下使用 DPAPI 加密保存。重启后可在「设置 → 云端图片」选择原任务重试。最多保留最近 3 份待恢复原图，上传并共享成功后释放原图；更早任务如尚未传到云端，需要重新选择图片。中断任务不会在重启时自动上传、分享或覆盖剪贴板。恢复记录读取失败时停止新上传，保留原文件供排查。

任务记录恢复独立于账号连接检查。连接检查临时失败后重新连接，也必须先确认任务记录已读取，才能写入新任务。「重新读取」在初次恢复失败时重读磁盘；若是保存失败，则重试保存内存中的新任务，避免用旧记录覆盖未保存任务。重复点击共用一次恢复操作。

### 同步缓存与备份

数据库依赖固定在 `rusqlite 0.41.1` / SQLCipher 4.19.0（SQLite 3.53.4），保留 SQLite ≥ 3.53.2 的安全基线测试。加密实现使用上游依赖，不修改第三方源码。升级对应 [rusqlite 官方发行记录](https://github.com/rusqlite/rusqlite/releases/tag/v0.41.1)。

Windows 桌面端为每个账号生成 DPAPI 保护的随机密钥，同步积压记录使用 AES-256-GCM 加密，异步分批写入并同步落盘。主数据库确认保存后才允许清理对应记录。缓存位于登录目录旁的 `*-sync-events`，密钥为 `*-sync-key.dpapi`；重置扫码凭据不删除这些待确认记录。旧明文同步缓存首次启动自动迁移；密钥丢失、文件损坏或新旧缓存冲突时停止读取，保留文件。积压超过 256 MiB、内存待写超过 32 MiB 或磁盘失败时，账号卡片显示警告并暂停额外历史拉取，不清理未确认消息。突然断电前尚在内存的事件仍需通过 WhatsApp 历史同步补齐。

写入失败或内存待写超过 32 MiB 时，还会断开该账号的接收连接并取消自动重连，保留已接收记录和登录凭据；正在处理的批次仍可完成入队。HTTP 状态及已有缓存读取保持可用。修复空间或写入权限后，点击「重连」会先完成待写记录、验证确认文件可写，再恢复连接。后台重试成功不会擅自重连。警告仍提示有记录未保存时，请勿退出程序。

自动备份绑定当前 Windows 用户，不能直接作为换电脑的迁移文件。「设置 → 数据与隐私 → 密码加密迁移备份」可导出 `.wapbackup`：密码至少 10 位，PBKDF2-SHA256（600,000 次）派生 AES-256-GCM 密钥，随机盐与 IV，每份最大 256 MiB。可选包含缓存附件；密码不保存，忘记后无法恢复。导入先解密、预览并确认，再替换本机数据。备份仍排除 API 密钥、Bridge Token 和 WhatsApp 登录凭据；原有 JSON 导出继续保留，其文件为明文。

密码迁移备份与普通备份一样，先等待本机变更保存完成，再读取历史；保存失败就停止导出，不生成成功文件。

### Muse 并发

文字和生图使用两个独立网页窗口，共用本机登录配置。图片等待不占用文字队列；文字队列中手动回复优先，其次自动回复，再次主动联系。每条队列最多等待 100 项、排队最多 5 分钟；取消和超时的等待项不会提交。AI 设置和回复建议显示当前运行及排队数量。网站自身的限流和会话有效期仍由 Muse 决定。

| 环境 | 引擎 |
|------|------|
| `npm run tauri dev` | **SQLite**（`app_data/wap-plus.db`，rusqlite） |
| `npm run dev` 浏览器 | IndexedDB + localStorage 备份 |

首次用桌面壳时，若 SQLite 为空会自动从 IndexedDB 迁移。设置里可看引擎与条数。
