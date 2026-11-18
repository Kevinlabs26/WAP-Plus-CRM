# macOS 构建与验收

GitHub Actions 的 `macOS build and DMG release` 工作流在 `codex/macos` 分支的推送上运行，分别使用 `macos-15`（Apple Silicon）和 `macos-15-intel`。测试构建不需要 Apple 凭据。它从固定哈希的 FFmpeg 与 Opus 源码构建，验证 DMG 中主程序及两个 sidecar 的架构，并用打包后的 FFmpeg 真正转出一段 Opus 音频。

## GitHub 仓库 Secrets

进入 Settings → Secrets and variables → Actions → New repository secret，为正式发布配置：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | 含私钥的 Developer ID Application `.p12` 文件的 Base64 单行文本 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时使用的密码 |
| `APPLE_SIGNING_IDENTITY` | `security find-identity -v -p codesigning` 显示的完整 Developer ID Application 身份 |
| `APPLE_ID` | 用于公证的 Apple 账号邮箱 |
| `APPLE_PASSWORD` | Apple 账号的应用专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `GOOGLE_DESKTOP_CLIENT_JSON` | 现有 Windows 发布已使用的 Google 桌面 OAuth 配置。如仓库已设置，可直接复用 |

两个架构的测试构建通过后，可用同一提交创建 `macos-build-v0.1.79` 类型的触发标签，或在工作流可手动运行时选择 `publish`。正式发布会重新跑两种架构的全套检查，要求应用签名、公证票据和 Gatekeeper 检查通过，然后统一发布到 `macos-v0.1.79`。macOS Release 不标为 Latest，避免替换 Windows 更新器使用的发布入口。

## 本地构建

在原生 Apple Silicon（`arm64`）及 Intel（`x86_64`）macOS 环境分别执行。使用与运行环境同架构的 Node、Rust 和 Bun。不要用 Rosetta 构建 Apple Silicon 包。

1. 在仓库根目录运行 `npm ci`。
2. 准备对应架构的独立 FFmpeg 构建、直接来自可信来源的二进制 SHA-256，以及与该二进制匹配的许可证和对应源代码说明。运行：

   ```sh
   bash tools/prepare-ffmpeg-macos.sh /absolute/path/ffmpeg "$FFMPEG_SHA256" /absolute/path/LICENSE /absolute/path/NOTICE arm64
   ```

   Intel 上将最后一个参数换为 `x86_64`。准备脚本拒绝错误架构及链接到外部库的二进制。二进制和发布所附许可证应保持同一来源。
3. 运行 `npm run build:macos -w wap-plus-baileys`。
4. 执行 `cargo test --locked --lib --tests --manifest-path desktop/src-tauri/Cargo.toml` 和 `npm test`。
5. 用已有的 Google 桌面客户端配置设定 `WAP_GOOGLE_CLIENT_PATH`。构建内部测试 DMG 时可先使用 Tauri 的临时签名配置，并关闭更新器制品：

   ```sh
   npm run tauri -- build --bundles dmg --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}'
   ```

6. 每种架构都从 DMG 安装一次，再验证启动、WhatsApp 登入、退出应用后重新打开、自动恢复会话、语音和媒体收发、备份恢复，以及新的数据库和密钥文件均为加密格式。确认 Keychain 拒绝访问时不会以明文数据库或替换密钥的方式继续运行。使用专用测试用户及合成数据。
7. 公开分发前，用 Apple Developer ID 对应用及其内置工具签名并公证，通过 Gatekeeper 验证与签名检查后再上传。macOS 更新器需要独立测通后才与 Windows 共用发布清单。

当前步骤只准备 macOS 构建。Windows 的依赖准备脚本、磁盘格式和发布工作流不需要调整。macOS 安装包不得附加到指向不同源代码的现有发布标签。
