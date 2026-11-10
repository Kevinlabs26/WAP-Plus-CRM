# BridgeCRM 安全审核报告（2026-11-03）

审核基线：`658d194`（`v0.1.67`）。包含本次修复后的工作树。结论限于本报告列出的源码、依赖、凭据和验证范围；不代表未知漏洞为零，也不覆盖生产机器和所有原生二进制内部。

## 1. 项目概况与范围

- 桌面端：TypeScript、React 18、Vite 6、Tauri 2 / Rust、SQLite；WhatsApp sidecar 使用 Node.js / Baileys，Windows 发布时由 Bun 编译。
- Android：Kotlin / Java、Jetpack Compose、Gradle。
- 依赖清单：npm workspaces 三份 `package-lock.json`；产品 `Cargo.toml` / `Cargo.lock`；Android Gradle 插件与应用依赖锁；另有文档中的 native compatibility Cargo 工程。
- 直接依赖：npm 30 项；Windows 产品 Rust 图 26 项（含 Windows 专用与构建依赖）；Android 11 项应用依赖及 3 项构建插件。
- OSV 对所有锁文件按精确版本查询，共 1,439 个不同的生态 / 包名 / 版本组合：npm 424、crates.io 721、Maven 294。该数量含开发、构建、辅助工程及非 Windows 平台依赖，并不等于 Windows 安装包运行依赖数。
- 代码范围包括当前产品源码、配置、测试、CI、文档和示例；重点检查注入、XSS、路径与解压、命令调用、TLS、CORS、IPC / 鉴权、日志和凭据边界。规则扫描后对命中与更新授权流程做人工核对；这不是形式化证明。
- 凭据扫描覆盖 36,803 个工作树文件，以及全部 179 个本地可达提交 / 3,432 个 Git blob；没有跳过大 blob。扫描器会对二进制产生误报，已按候选类型复核。

## 2. 问题汇总

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
|---|---|---|---|---|
| D01 | 依赖 / 更新配置 | Medium | `desktop/src-tauri/tauri.conf.json:50`；`desktop/package.json:41`；两份 npm 锁文件 | **已修复**：强制校验签名内的应用版本，Tauri CLI 更新到 2.12.2 |
| D02 | 依赖 / 本机工具链 | High（仅本机开发环境） | 当前系统 Node.js 22.23.2；项目 `.nvmrc:1` 为 22.23.4 | **待开发者处理**：本机 Node 落后于项目安全版本；没有改全局安装 |
| D03 | 依赖 | Low（Linux 专属；RustSec 标记 INFO / unsound） | `desktop/src-tauri/Cargo.lock:1456`；`docs/security/native-compatibility/Cargo.lock:1264` | **建议关注**：glib 0.18.5 的 `VariantStrIter` 未定义行为；Windows 产品图不包含它 |
| D04 | 依赖维护 | Low | `desktop/src-tauri/Cargo.toml:44` | **待开发者决定**：产品直接依赖 sherpa-rs 0.5.1 已弃用且上游停止维护；未发现对应的已知 CVE |
| D05 | 依赖维护 | Low | `desktop/src-tauri/Cargo.lock:6061,6182,6197` | **建议关注**：zbus_names 4.3.4、zvariant 5.14.0、zvariant_derive 5.14.0 被 RustSec 标记为停止独立维护；Linux 依赖路径，当前无修复版本 |
| D06 | 依赖维护 | Low | `docs/security/native-compatibility/Cargo.lock:2626` | **建议关注**：仅文档辅助工程锁定 proc-macro-error 1.0.4，已停止维护；不进入产品依赖图 |
| D07 | 依赖 / 可复现性 | Low | 根 `package-lock.json` 与 `desktop/package-lock.json` | **待开发者决定**：两个 npm 锁文件中少数满足同一范围的依赖版本不同；OSV 已分别检查，未发现该差异带来的已知漏洞 |

没有发现当前 Windows 产品依赖图中的 Critical 或 High 已知第三方库漏洞。D02 是本机开发工具版本问题，不随桌面安装包发布；D03–D06 是平台适用性或维护状态问题，不应解释成当前 Windows 可利用漏洞。

## 3. 依赖审核与修复

### 已修复：Tauri 更新清单回滚验证

GitHub Advisory Database 收录的 CVE-2026-95625 描述：更新清单中的版本号未被二进制签名绑定；若攻击者能控制更新清单或其传输，可将客户端引向一个较旧但仍有有效签名的版本。公告没有给出常规包生态的精确受影响范围；Tauri 上游在 updater 2.12.0 加入 `requireSignedVersion` 作为应用侧启用的保护。[GitHub Advisory](https://github.com/advisories/GHSA-p8c6-29q6-cqw7) · [Tauri CLI 更新说明](https://v2.tauri.app/release/%40tauri-apps/cli/)

改动：

- 在 `tauri.conf.json` 启用 `plugins.updater.requireSignedVersion`。
- 将直接开发依赖 `@tauri-apps/cli` 的最低范围改为 `^2.12.2`，并同步根工作区和桌面独立锁文件。Rust updater 已锁定为 2.14.1。
- 用 `tauri signer sign --help` 确认 CLI 提供 `--app-version`，并说明 `tauri build` 会自动把版本写入签名可信注释。

利用前提是更新清单端点或其传输路径被篡改/劫持；有效签名仍保护安装包字节。修复后发布的新安装包要求清单版本与签名版本一致。此次没有真实发布签名密钥，因此没有生成或发布新安装包；下次 release 必须由更新后的 CLI 重新构建并生成带版本的签名。

### 本轮依赖扫描

- 根 npm workspace 的 `npm audit`：0 个已知漏洞。桌面独立 lock 在 npm lock-only 更新时也报告 0 个漏洞；sidecar 与另外两份 lock 均由 OSV 精确版本扫描覆盖。
- OSV 命中 5 个唯一包、6 条 advisory 记录：glib 的 GHSA 与 RustSec ID 是同一问题的两个别名；另有一个停止维护提示和三个 zbus 相关停止维护提示。没有可达的 Critical / High 已知漏洞。
- 最新检查的 zip 提取 DoS 公告已于 zip 9.0.0 修复；产品锁定 `zip 9.1.3`，文档辅助工程锁定 `zip 9.2.2`，版本均在修复范围内。[RustSec zip 公告](https://rustsec.org/advisories/RUSTSEC-2026-0429.html)
- `@tauri-apps/plugin-shell` 锁定 2.3.5，高于其不安全 `open` scope 公告的修复版本 2.2.1。[GitHub Advisory](https://github.com/advisories/GHSA-c9pr-q8gx-3mgp)
- RustSec 对 glib 0.18.5 的 advisory 是特定 Variant 字符串迭代器的未定义行为，修复版本为 0.20.0。它通过 GTK / WebKit Tauri 路径进入 Linux 构建；Windows 解析图不包含该包。[RustSec glib 公告](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- 产品 sherpa-rs 的上游已明确弃用该 crate 并建议迁至官方 Rust API；这是语音 API 和运行时迁移，需补齐产品语音、打包与模型下载验证，未擅自替换。[上游说明](https://github.com/thewh1teagle/sherpa-rs)
- `cargo-audit`、`osv-scanner`、Gitleaks 和 Semgrep 未安装；Rust / Maven / npm 锁文件通过在线 OSV 查询核对，npm 另用 `npm audit` 交叉验证。
- RustSec 的 Linux 停维护记录：[zbus_names](https://rustsec.org/advisories/RUSTSEC-2026-0371.html)、[zvariant](https://rustsec.org/advisories/RUSTSEC-2026-0370.html)、[zvariant_derive](https://rustsec.org/advisories/RUSTSEC-2026-0372.html)。这些是维护状态提示，不是已确认可利用漏洞。

### Node.js 开发环境

项目 `.nvmrc` 和 CI 固定到 22.23.4，但本机 `node --version` 为 22.23.2。Node 官方 2026-10-21 安全发布把 DNS (CVE-2026-105482)、TLS (CVE-2026-106069) 和 Brotli 解码 (CVE-2026-111497) 等 High 问题修复带入 22.23.4；项目本地脚本在本机旧版本上执行时仍使用该旧运行时。[Node.js 官方安全发布](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)

建议用版本管理器切换到仓库指定的 22.23.4。没有修改系统 Node，以免改变其他项目的运行环境。

### 锁文件版本差异

根工作区与桌面独立锁文件存在一些版本差异，例如 `@tauri-apps/api` 为 2.11.1 / 2.12.1，updater JS binding 为 2.11.0 / 2.13.1，PostCSS 为 8.5.28 / 8.5.25。它们都满足 manifest 版本范围，当前 OSV 扫描没有发现这些版本有已知漏洞；但不同安装入口会得到不同构建依赖。根 `npm audit` 会解析工作区根锁，不能替代对独立锁文件的审计，因此本轮对三个锁文件分别做 OSV 版本盘点。

## 4. 直接依赖与关键锁定版本

下列 npm 直接依赖版本以根工作区锁文件为准。桌面独立锁的已知差异见上节。应用与辅助依赖分列，不把文档兼容工程混入产品直接依赖数。

### npm：30 项直接声明

| 清单 | 直接依赖及实际版本 |
|---|---|
| Desktop runtime（16） | `@tauri-apps/api` 2.11.1; `@tauri-apps/plugin-notification` 2.3.3; `@tauri-apps/plugin-shell` 2.3.5; `@tauri-apps/plugin-updater` 2.11.0; `clsx` 2.1.1; `countries-and-timezones` 3.11.0; `drizzle-orm` 0.45.3; `emoji-picker-react` 4.18.0; `franc-min` 6.2.0; `libphonenumber-js` 1.13.15; `lucide-react` 0.468.0; `react` 18.3.1; `react-dom` 18.3.1; `react-virtuoso` 4.18.11; `tailwind-merge` 2.6.1; `zustand` 5.0.14 |
| Desktop dev（10） | `@tauri-apps/cli` 2.12.2; `@types/react` 18.3.31; `@types/react-dom` 18.3.7; `@vitejs/plugin-react` 4.7.0; `autoprefixer` 10.5.4; `drizzle-kit` 0.31.11; `postcss` 8.5.28; `tailwindcss` 3.4.19; `typescript` 5.9.3; `vite` 6.4.5 |
| Baileys sidecar（4） | `baileys` 7.0.0-rc14; `pino` 10.3.1; `qrcode` 1.5.4; `bun` 1.4.4 |

`baileys` 仍是预发布版本（rc14），这是稳定性和维护节奏风险；没有证据将其认定为仿冒包。

### Windows 产品 Rust：26 项直接解析依赖

`base64` 0.22.1; `bzip2` 0.4.4; `chrono` 0.4.45; `png` 0.18.1; `reqwest` 0.13.4; `rusqlite` 0.40.2; `serde` 1.0.229; `serde_json` 1.0.151; `sha2` 0.10.9; `sherpa-rs` 0.5.1; `tar` 0.4.46; `tauri` 2.12.5; `tauri-plugin-notification` 2.3.3; `tauri-plugin-shell` 2.3.5; `tauri-plugin-single-instance` 2.4.4; `tauri-plugin-updater` 2.14.1; `tauri-winrt-notification` 0.7.3; `thiserror` 2.0.19; `tokio` 1.54.1; `tracing` 0.1.44; `tracing-subscriber` 0.3.23; `url` 2.5.8; `uuid` 1.24.0; `windows-registry` 0.6.1; `windows-sys` 0.61.2; 构建依赖 `tauri-build` 2.7.4。

### Android：11 项应用依赖与 3 项构建插件

- 应用：Compose BOM 2024.10.01；Compose UI / UI tooling preview 1.7.5；Material3 1.3.1；Activity Compose 1.9.3；Lifecycle runtime KTX 2.8.7；Core KTX 1.15.0；Kotlin coroutines Android 1.9.0；OkHttp 4.12.0；Kotlin serialization JSON 1.7.3；debug UI tooling 1.7.5。
- 构建插件：Android Gradle Plugin 8.7.2；Kotlin Android 2.4.20；Kotlin Compose 2.4.20。
- 关键锁定的 Android 测试/构建传递依赖：Netty 4.1.137.Final、Bouncy Castle 1.85、protobuf 3.25.5、Guava 33.7.2-jre、commons-io 2.15.1、commons-compress 1.26.0。OSV 对全部 294 个 Maven 锁定版本没有返回已知漏洞。

### 关键 Rust 间接版本

- Windows 图：Tokio 1.54.1、rustls 0.23.46、SQLite 3.53.2（由 rusqlite 0.40.2 bundled）。
- 平台差异：Linux GTK / WebKit 路径有 glib 0.18.5；Linux D-Bus 路径有 zbus 5.19.0、zbus_names 4.3.4、zvariant 5.14.0、zvariant_derive 5.14.0。它们不是当前 Windows 产品解析依赖。

## 5. 代码审核结果

| 检查项 | 结果 |
|---|---|
| SQL 注入 | 通过：查询值使用 SQLite 参数绑定；动态表名来源限于内部固定表集合，未发现用户输入拼入 SQL 的路径 |
| 命令注入 / 动态执行 | 通过：未发现 shell 拼接用户输入、`eval` 或 `new Function` 执行用户内容 |
| XSS | 通过：React 默认文本转义；定向扫描未发现 `dangerouslySetInnerHTML` 或直接 `innerHTML` 写入 |
| SSRF / TLS | 通过：远程媒体下载实施 HTTPS、公共地址、DNS 与重定向校验；Reqwest 保留 TLS 验证，没有关闭证书校验 |
| CORS、鉴权和本机 IPC | 通过：Baileys Bridge 限定本机来源并要求 token / 账号匹配；Android Bridge 有界读取和来源限制；Tauri capability 权限较窄 |
| 路径与归档解压 | 通过：语音模型解压检查路径、链接和资源上限；备份写入采取原子替换 |
| 日志泄露 | 通过：未发现新增敏感 token、完整请求或授权码写日志的路径 |
| CI/CD | 通过：未发现 `pull_request_target`；第三方 Actions 固定到 commit SHA；Release 签名材料来自 GitHub Secrets |

以上通过项基于当前源码静态检查及既有安全测试；未执行真实账号攻击、生产端点渗透或真实更新签名发布。

## 6. 密钥与凭据

- 没有确认真实 API key、token、密码、私钥、数据库凭据或 webhook 泄露。
- 工作树规则扫描的候选为编译 `.exe` 字节内容误匹配，以及 `desktop/tests/remote-media-security.test.mjs:52` 明确用于拒绝验证的 `user:pass` 测试 URL。全 Git 历史唯一候选也是这个测试 URL；没有超大 blob 被跳过。
- `.env.example` 仅含变量名和空值；`.gitignore` 忽略 `.env`、本地环境文件、认证目录和 PEM / 私钥模式；Git 跟踪列表中只有 `.env.example`。
- 因未发现真实泄露，本轮无需改环境变量或新增示例变量。若任何密钥曾以真实值提交或外泄，仍必须在所属平台吊销并重新生成；只删除文件不够。

## 7. 验证结果

| 检查 | 结果 |
|---|---|
| 根 `npm audit` | 通过，0 vulnerabilities；新 CLI lockfile 更新后 npm install 再次显示 0 vulnerabilities |
| 全锁文件 OSV | 通过有保留项，命中仅为前述 Linux glib 与停止维护告警 |
| `npm run check`（修复后） | **通过**：1,061 个 Node 测试通过，TypeScript / Vite 构建、Bun sidecar 编译、Bridge smoke 全部通过 |
| `cargo test --locked --lib --tests --manifest-path desktop/src-tauri/Cargo.toml --quiet`（修复后） | **通过**：151 项通过、0 失败；保留原有 dead_code 与 MSVC 链接提示 |
| Tauri CLI 签名参数 | **通过**：实际 CLI 2.12.2，`signer sign --help` 显示 `--app-version` 及其与 `requireSignedVersion` 的用途 |
| `git diff --check` | 通过 |
| Android Gradle `:app:testDebugUnitTest :app:assembleDebug` | 本次**未能完成**：Gradle wrapper 网络最初被沙箱阻止；允许访问后 Java 仍因本机 loopback connection 初始化失败。没有因此判为 Android 代码失败；未连接设备测试 |

## 8. 需要开发者决定与后续建议

1. **本机 Node**：建议使用版本管理器切换到 `.nvmrc` 指定的 22.23.4。仓库和 CI 已指定安全版本，本次没有改全局工具链。
2. **Linux 支持范围**：若只发布 Windows，保留当前 Linux-only GTK/D-Bus 告警并在 Linux 发布前安排 Tauri / GTK 兼容升级；若计划发布 Linux，需处理 glib >=0.20 与 zbus 6 迁移，并完成 Linux 构建和 UI 验证。不要仅用 Cargo 强制覆盖来假定 ABI 兼容。
3. **产品语音引擎**：可暂时保留 sherpa-rs 0.5.1 并监测，或迁移到官方 Rust bindings。建议单独计划迁移；API、原生库和打包验证超出安全小修复范围，本次未改业务实现。
4. **npm 锁文件**：如果三个锁文件是刻意支持分目录独立安装，建议 CI 分别验证每个锁文件；如果不需要独立安装，建议确定根 workspace 锁为唯一来源并移除重复锁。当前没有仅为消除版本差异而改动其他包。
5. **下次发布**：必须用 CLI 2.12.2+ 重新构建 updater artifacts，让应用版本进入 minisign 签名可信注释，并检查生成的 `latest.json` 与签名配对。真实签名密钥必须保留在 GitHub Secrets / 安全密钥管理中，不应进入仓库。

本轮安全修复只涉及 updater 版本绑定配置、Tauri CLI 小版本要求和两份对应 npm 锁文件；未升级大版本、删除功能或改动 WhatsApp 业务行为。
