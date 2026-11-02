# 安全审核报告（2026-11-02）

审核对象：v0.1.62 / `2f277c1` 基线及本次未提交修复。结论针对本地源码与下述验证范围，不代表线上旧安装包已经修复，也不构成“没有任何漏洞”的保证。

## 1. 项目概况与范围

- 桌面：TypeScript、React 18、Vite 6、Tauri 2 / Rust；WhatsApp 后端为 Node/Baileys，Windows 发布时用 Bun 编译；SQLite 保存业务数据，sherpa-rs 提供离线语音。
- Android：Kotlin / Java / Compose、Gradle；通过本机桥接与 WhatsApp 辅助操作协作。另有 `docs/security/native-compatibility` 数据库与语音兼容验证工程。
- 包管理：npm 三份锁文件、产品与辅助工程两份 Cargo.lock、Gradle 插件及应用锁文件、严格依赖哈希验证。未发现 Python/Go/Maven/iOS 产品工程；审计工具包含 Python。
- 直接声明：npm 30 项、产品 Cargo 26 项、Android 11 项依赖声明及 3 项插件声明；辅助工程单独计数。完整直接版本与关键间接版本见附录。
- 最终锁文件集合共 1,439 个不同的“生态 / 名称 / 版本”组合：npm 424、Rust 721、Maven 294。包含辅助工程、构建工具、开发依赖及非 Windows 平台依赖，不是 Windows 成品的运行依赖数量。Windows 产品 Cargo 实际解析图为 369 个包。
- 范围包括源码、测试、配置、示例、文档、CI/CD、Android、桌面 IPC、第三方下载与解包、生成的前端/后端产物，以及全部本地可达 Git 历史。逐文件规则扫描后，人工追踪高风险信任边界；没有声称对所有代码逐行完成形式化验证。
- 依赖方法：全部锁定版本查询 OSV；三个 npm audit 交叉核对；逐个查询全部直接依赖名称及重点运行时、原生与间接依赖的公开公告。主要依据 GitHub 官方安全公告、RustSec、SQLite/Node/FFmpeg 官方安全页。未安装 cargo-audit、Semgrep、Gitleaks，未声称执行这些工具。npm/OSV 没有覆盖到本次 Bun 公告，网页核验补上了这一缺口。

## 2. 问题汇总

行号及受影响调用点见第 3 节和附录。严重级别是项目风险；标明“公告级别”的条目保留上游评级，同时说明实际可达条件。

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
|---|---|---|---|---|
| S01 | 依赖 | High | `desktop/baileys-bridge/package.json`、两份 Bun 锁记录 | 已修复 |
| S02 | 依赖 | High | `.nvmrc`；本机全局 Node | 项目已修复；全局运行时建议关注 |
| S03 | 依赖 | High | `android/gradle/wrapper/gradle-wrapper.properties` | 已修复 |
| S04 | 依赖 | Medium | `desktop/src-tauri/Cargo.toml`、Cargo.lock | 已修复 |
| S05 | 依赖 | Critical（公告级别） | `docs/security/native-compatibility/Cargo.lock` 的 zip 2.x | 已修复；未进入当前产品 |
| S06 | 代码 | Medium | `desktop/src/lib/aiResponse.ts` 及六类 AI/翻译调用 | 已修复 |
| S07 | 代码 | Low | `desktop/src/lib/listModels.ts` | 已修复 |
| S08 | 代码 | Medium | `desktop/src-tauri/src/google_sheets.rs` | 已修复 |
| S09 | 代码 | Medium | Android `MainActivity.kt`、`WaAssistService.kt` | 已修复 |
| S10 | 依赖 | Medium（原快照具体 CVE 待确认） | `audioConvert.mjs`、原系统 FFmpeg 路径 | 已修复项目版本漂移；原系统程序保留 |
| S11 | 依赖 | Medium | 产品/辅助 Cargo.lock 中 glib 0.18.5 | 建议关注；不在 Windows 解析图，Linux 发布前处理 |
| S12 | 依赖 | Low | sherpa-rs 0.5.1 及四项非 Windows 停维护依赖 | 建议关注 |
| S13 | 密钥 | Low（核验项，未确认漏洞） | 工作树、构建产物、Git 历史、忽略规则 | 检查通过；无已确认真实密钥泄露 |

## 3. 已修复问题、原因及验证

### S01：Bun 网络响应解压内存破坏

Bun 1.3.14 → **1.4.4**。官方公告影响 `>=1.0.21,<1.4.4`；Baileys 实际使用全局 fetch 下载媒体等内容，因此相关 Brotli 解压能力可达。攻击仍需要能影响被请求服务器的恶意压缩响应，未执行破坏性利用。普通 npm audit / OSV 的零结果没有排除这个运行时问题。[Bun 官方公告 GHSA-663w-cv8g-jj2p](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p)。

改动：固定 Bun 开发工具版本，同步根与 sidecar 的独立锁文件；使用 1.4.4 重新编译实际 sidecar，新增版本回归检查。仅改锁文件不能更新已发布的内嵌 Bun 程序，后续发布必须重新构建。

### S02：Node 构建 / 开发运行时落后于安全修复

`.nvmrc` 从 22.23.2 → **22.23.4**，CI 继续读取该文件。官方十月安全版本包含 Brotli、DNS/TLS 等修复；具体可达性取决于开发/工具和网络功能。[Node 官方安全发布说明](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。

本次全套 npm 验证使用项目隔离下载、经官方 SHASUMS256 校验的 22.23.4。没有修改系统 Node；本机全局 22.23.2 仍需开发者用版本管理器更新。桌面正式 sidecar 使用 Bun，与系统 Node 分开。

### S03：Gradle 仓库错误回退风险

Wrapper **8.14.5 → 8.14.6**，同步官方分发 SHA256。多个仓库及特定错误回退条件可造成错误仓库来源被采用；严格依赖哈希验证已降低攻击面，但不能代替修复。

依据三个官方 High 公告：[GHSA-j5m7-59rp-24f5](https://github.com/gradle/gradle/security/advisories/GHSA-j5m7-59rp-24f5)、[GHSA-xwqc-3h47-hg64](https://github.com/gradle/gradle/security/advisories/GHSA-xwqc-3h47-hg64)、[GHSA-mvvg-497x-hmj8](https://github.com/gradle/gradle/security/advisories/GHSA-mvvg-497x-hmj8)。8.x 修复版本均为 8.14.6。

验证：新 Wrapper 下严格哈希模式完成 Android 编译/单元测试任务与 APK 构建；额外将 702 个 Gradle 依赖文件与官方仓库重新核验，零不匹配。没有放宽 dependency verification。

### S04：SQLite 旧原生版本

经开发者明确允许，**rusqlite 0.32.1 → 0.40.2、libsqlite3-sys 0.30.1 → 0.38.2，实际 SQLite 3.46.0 → 3.53.2**。相关官方问题要求攻击者可控制 SQL、某些 SQL 函数参数或恶意 FTS 数据库；本次没有找到远程 SQL 注入入口，不能把库级漏洞直接说成可远程攻击 CRM。[SQLite 官方漏洞说明及利用前提](https://www.sqlite.org/cves.html)。

兼容验证使用真实 SQLite 3.46.0 写出的压缩合成数据库 fixture：运行实际迁移、检查中英文历史和 FTS5 搜索、保存笔记、关闭重开并执行完整性检查。不打开或改动用户数据库。产品与辅助工程使用一致的修复版 rusqlite。

### S05：辅助语音工程 zip 2.x

仅辅助工程可选 `speech` 功能通过 sherpa-onnx-sys 引入旧 zip；产品 updater 原有 zip 9.1.3 不受这条链影响。上游 zip 公告是 Critical，但本工程只有下载/解包语音构建资源的路径，未确认具备公告所描述的网关与双解析器攻击链。[zip 双头解析差异公告，受影响 ≤9.0.4，修复 9.0.5](https://github.com/zip-rs/zip2/security/advisories/GHSA-m665-v7pm-7grj)。

经开发者明确允许，仅辅助工程 **sherpa-onnx 1.13.8 → 2.0.1**，将 zip 更新为 **9.2.2**；同时更新辅助 Tauri 2.11.5 → 2.12.5 及兼容补丁依赖，清除其旧 rustls/tokio/webpki 等历史版本告警。补齐直接复用产品数据库测试所需的同版本 bzip2/uuid 测试依赖。

验证：默认 28 项通过；启用 speech 的 29 项通过，包括公开 Tiny 原版及 int8 模型实际解码。没有擅自把产品 sherpa-rs 换成另一套绑定。

### S06、S07：AI 响应资源边界及模型数据校验

恶意/被入侵的自定义 AI、翻译或转写服务可返回超大 JSON，原代码直接 `response.json()` 可能耗尽内存。新增统一 `readAiJson`，逐块限制实际读取字节到 **1,000,000 字节**，不依赖 Content-Length；超限中止读取，释放 reader，避免把完整响应带入错误。

同步接入建议生成、Gemini、客户卡片、草稿翻译、语音转录及模型列表，覆盖对应成功/错误 JSON 分支。原有建议流式上限保持。对模型列表额外验证数组和字符串，避免服务端对象/空值成为 React 标签引发面板崩溃。

新增测试覆盖 UTF-8 单字节分块、缺失/伪造长度、超限取消、空响应、解析/传输异常、模型脏数据，以及超大响应不会发布为回复建议。超过限额的合法超大结果也会明确失败，这是有意保留的资源边界。

### S08：Google Sheets 原生响应无限读取

原生请求原先直接 `.json()`；异常远端响应可能导致过量内存分配。现在先检查声明长度，再逐块累计，限制 **32 MiB**，不回显内容。超限错误归为请求/数据量问题，避免当作网络错误自动重试。

原生测试用本地隔离 HTTP 服务验证正常 JSON、超大声明长度及无 Content-Length 的超大 chunked 响应。未访问真实 Google 表格。

### S09：Android 外部语音分享混淆

本地恶意应用可通过导出的分享 Activity 提交自己的 content URI；旧待补全消息没有超时，且异步读取结果可能绑定到更新后的另一条待处理消息。

经开发者明确允许：解析真实 ContentProvider 所属包，只接收 `com.whatsapp` / `com.whatsapp.w4b`；只接收 audio MIME；使用单调时钟设置 **120 秒**有效期；在读取 URI 前捕获请求代次，完成时重新核验代次、有效期和服务状态。保留既有 8 MB 读取上限。已设置 WhatsApp 包可见性。

验证包含允许/拒绝来源、边界时间、时钟异常和旧代次拒绝；实际 Android Kotlin/Java 编译通过。没有声称 MIME 声明能证明媒体内容，也没有声称已在真实手机逐个版本验证 Provider 名称和分享体验。

### S10：FFmpeg 来源与版本不可复现

原先从 PATH 执行系统 `2025-10-19-git-dc39a576ad` 快照；具体后续 CVE 是否已回补待确认，不能单凭时间给它编造漏洞编号。经开发者明确允许，Windows 改为项目专属 **FFmpeg 9.0.2 essentials**，固定下载 URL，分别校验归档和 EXE 的 SHA256；归档仅提取已指定的两个文件，不做任意目录解包。

原生启动器传入绝对路径；开发环境使用项目 binaries；打包配置包含独立 ffmpeg.exe、GPL 许可证与来源说明。不会修改系统 C:\\ffmpeg，也不会在 Windows 上静默回退该旧程序。既有协议/格式白名单、超时及大小/时长限制继续有效。[构建方发布及源代码版本](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)、[FFmpeg 官方安全记录](https://ffmpeg.org/security.html)。

新增可执行文件哈希/版本验证；使用独立版本重新执行语音时长、Opus/波形转换及拒绝网络媒体引用等既有测试。分发者仍须履行该独立 GPL 程序对应源码提供义务，不能把 Apache 许可证当成其许可证。

### 审计覆盖修正

依赖清单工具补上辅助 Cargo.lock，并正确解析 npm workspace 上级 hoist 的直接依赖；增加回归检查。此改动是审计完整性修复，不算另一个产品运行漏洞。时钟测试由易受最新 tzdata 变动影响的摩洛哥示例改为固定 UTC 的加纳示例，保留时钟更新行为断言。

### 密钥与忽略规则

- 最终工作树规则扫描 36,637 个文件（包含多份产物和临时文件），扫描全部 171 个本地可达提交、3,282 个 Git blob，无超大 blob 被跳过；node_modules、缓存及大型原生构建目录不做逐字节全量扫描，依赖交由 SCA/来源核验。
- 最终 31 个工作树候选与 1 个历史候选均已复核：sidecar 命中可追溯到上游协议字典/WASM 常量；FFmpeg 命中是无私钥正文的 PEM 解析标记和公开 SSH 算法名称；另有明确的安全测试伪凭据。没有确认真实 API Key、密码、私钥泄露。补充的通用凭据/JWT 规则命中也是测试 fixture。报告不输出候选原文。
- `.env`、`.env.local`、桌面 .env、认证目录和本地 Tauri 签名私钥均被忽略；未发现这些真实敏感文件被 Git 跟踪。已存在的 `.env.example` 仅保留空变量声明，无需增加虚构配置。
- 原生 OAuth installed-client 的 client secret 不是可保密的服务器密钥；按 PKCE/state、只读权限和本地令牌保护检查，不将其误判成需要轮换的生产 API Key。
- 如今后确认真实密钥曾提交或泄露，必须到所属平台作废并重新生成；只删代码、补 .gitignore 或改写当前文件都不够。本机签名密钥的真实宿主 ACL 与外部平台密钥有效性不在此次验证结论内。

### 验证结果

最终具体测试计数及源码位置附于下文。通过项包括完整 `npm run check`（测试、TypeScript/Vite、Bun sidecar 编译、Bridge smoke）、产品 Rust 测试、辅助工程默认/语音测试、Android 严格依赖验证下的构建、Java 分享策略断言、702 个官方依赖哈希核验、三处 npm audit、全锁文件 OSV 扫描及 `git diff --check`。

扫描结论必须分开读：npm 三处零漏洞；OSV 仍返回五个非 Windows 包的记录，其中 glib 两个 ID 是同一漏洞别名，另四个是停维护公告。不能把它们过滤后说成“全生态零告警”。

## 4. 需要开发者决定的问题

本轮已批准并完成：SQLite/rusqlite 升级、Android 分享限制、仅辅助工程 sherpa-onnx 2.x 升级、项目独立 FFmpeg。其余没有擅自改变业务或删除功能。

1. **Linux 平台 glib 0.18.5**：GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429，影响特定 Variant 字符串迭代，修复版本 ≥0.20.0。Windows 产品解析图不包含它；Linux GTK/Tauri 链仍保留该旧系列。方案 A：维持 Windows 发布范围，将 Linux 标为未通过；方案 B：另开 Linux 框架兼容迁移并执行 Linux 构建/UI 验证。建议目前采用 A；计划 Linux 发布时执行 B。不能用强制替换跨系列 glib 来假装兼容。[glib 官方公告](https://github.com/gtk-rs/gtk-rs-core/security/advisories/GHSA-wrw7-89jp-8q8g)。
2. **产品离线引擎 sherpa-rs 0.5.1**：上游仓库已归档；本轮没有确认特定运行时 CVE，也没有完整验证其所有静态原生组件。方案 A：暂留、固定产物并持续监测；方案 B：把已通过辅助语音验证的官方绑定迁入产品，补模型下载/转写/取消/错误处理和打包验证。建议另行执行 B；单个辅助解码通过不代表产品迁移已完成。[上游仓库状态](https://github.com/thewh1teagle/sherpa-rs)。
3. **全局 Node**：项目和 CI 已固定安全版；本机默认 Node 仍需版本管理器升级，避免其他项目和手动命令继续使用旧版。没有擅自修改全局开发环境。

## 5. 剩余风险与后续建议

- 非 Windows 停维护依赖：proc-macro-error 1.0.4、zbus_names 4.3.4、zvariant / zvariant_derive 5.14.0 均不在本次 Windows 产品解析图；停维护不等于已证实可利用漏洞，仍应在平台迁移时消除。
- Baileys 7.0.0-rc14 为预发布系列；没有证据将它或真实的 tauri-winrt-notification 0.7.3 认定为仿冒包。不要与近似名称的恶意包或 React Server Components 的其他插件公告混淆。
- 已查看 SQL 参数绑定、命令参数数组、React 文本输出、路径/解包限制、远程媒体 SSRF/DNS/重定向限制、桥接令牌/账号/CORS、OAuth、DPAPI、本地备份、Tauri CSP/权限及 CI 固定提交。未发现新的已确认 SQL/命令注入、XSS、TLS 校验关闭或 CI 表达式注入；这只是本次观察，不是不存在未知问题的证明。
- 桌面客户数据库及媒体仍是本机业务资料；操作系统账号、磁盘加密和备份访问控制属于部署边界。可配置 AI/翻译/转录服务会收到相应内容，使用者仍须信任所配置服务。
- 未验证：真实 WhatsApp 收发/封号风控、真实手机分享 UI、用户原始数据库恢复、真实 AI/Google 凭据、Linux/macOS 成品、所有原生静态库完整 SBOM、新安装包升级。语音兼容只使用公开样本，不声称识别质量或所有模型格式均已验证。
- FFmpeg 增加约 105 MB 未压缩程序；Windows 分发须携带许可证并满足对应源码要求。缺少固定资源时构建/转换应失败，不静默选择系统旧版。
- 修复尚未提交、push 或发布。现有 v0.1.62 安装包不会因本地源码变化自动变安全；下次发布需全新编译 sidecar 与桌面程序、运行安装包烟雾测试，再发布签名产物。
- 后续持续运行依赖/密钥扫描，关注运行时官方公告；建议把原生组件与构建运行时版本同时纳入升级周期。扫描“零已知命中”不等于零漏洞。

## 附录 A：全部直接依赖及关键间接版本

下表由本次最终锁文件和 Windows Cargo metadata 生成。Cargo 全平台锁文件中的非 Windows 包另列告警，实际直接依赖版本不混用同名间接版本。

<!-- GENERATED_DEPENDENCIES -->

### npm：全部 30 项直接声明

| 名称 | 实际版本 | 范围 | 清单 |
| --- | --- | --- | --- |
| @tauri-apps/api | 2.11.1 | dependencies | desktop/package.json |
| @tauri-apps/plugin-notification | 2.3.3 | dependencies | desktop/package.json |
| @tauri-apps/plugin-shell | 2.3.5 | dependencies | desktop/package.json |
| @tauri-apps/plugin-updater | 2.11.0 | dependencies | desktop/package.json |
| clsx | 2.1.1 | dependencies | desktop/package.json |
| countries-and-timezones | 3.11.0 | dependencies | desktop/package.json |
| drizzle-orm | 0.45.3 | dependencies | desktop/package.json |
| emoji-picker-react | 4.18.0 | dependencies | desktop/package.json |
| franc-min | 6.2.0 | dependencies | desktop/package.json |
| libphonenumber-js | 1.13.15 | dependencies | desktop/package.json |
| lucide-react | 0.468.0 | dependencies | desktop/package.json |
| react | 18.3.1 | dependencies | desktop/package.json |
| react-dom | 18.3.1 | dependencies | desktop/package.json |
| react-virtuoso | 4.18.11 | dependencies | desktop/package.json |
| tailwind-merge | 2.6.1 | dependencies | desktop/package.json |
| zustand | 5.0.14 | dependencies | desktop/package.json |
| @tauri-apps/cli | 2.11.4 | devDependencies | desktop/package.json |
| @types/react | 18.3.31 | devDependencies | desktop/package.json |
| @types/react-dom | 18.3.7 | devDependencies | desktop/package.json |
| @vitejs/plugin-react | 4.7.0 | devDependencies | desktop/package.json |
| autoprefixer | 10.5.4 | devDependencies | desktop/package.json |
| drizzle-kit | 0.31.11 | devDependencies | desktop/package.json |
| postcss | 8.5.28 | devDependencies | desktop/package.json |
| tailwindcss | 3.4.19 | devDependencies | desktop/package.json |
| typescript | 5.9.3 | devDependencies | desktop/package.json |
| vite | 6.4.5 | devDependencies | desktop/package.json |
| baileys | 7.0.0-rc14 | dependencies | desktop/baileys-bridge/package.json |
| pino | 10.3.1 | dependencies | desktop/baileys-bridge/package.json |
| qrcode | 1.5.4 | dependencies | desktop/baileys-bridge/package.json |
| bun | 1.4.4 | devDependencies | desktop/baileys-bridge/package.json |

### 产品 Rust：全部 26 项直接声明

| 名称 | 实际版本 | 声明范围 |
| --- | --- | --- |
| tauri-build | 2.7.4 | [build-dependencies] |
| base64 | 0.22.1 | [dependencies] |
| reqwest | 0.13.4 | [dependencies] |
| sha2 | 0.10.9 | [dependencies] |
| url | 2.5.8 | [dependencies] |
| png | 0.18.1 | [dependencies] |
| tauri | 2.12.5 | [dependencies] |
| tauri-plugin-shell | 2.3.5 | [dependencies] |
| tauri-plugin-notification | 2.3.3 | [dependencies] |
| tauri-plugin-single-instance | 2.4.4 | [dependencies] |
| tauri-plugin-updater | 2.14.1 | [dependencies] |
| serde | 1.0.229 | [dependencies] |
| serde_json | 1.0.151 | [dependencies] |
| tokio | 1.54.1 | [dependencies] |
| uuid | 1.24.0 | [dependencies] |
| chrono | 0.4.45 | [dependencies] |
| thiserror | 2.0.19 | [dependencies] |
| tracing | 0.1.44 | [dependencies] |
| tracing-subscriber | 0.3.23 | [dependencies] |
| rusqlite | 0.40.2 | [dependencies] |
| tar | 0.4.46 | [dependencies] |
| bzip2 | 0.4.4 | [dependencies] |
| sherpa-rs | 0.5.1 | [dependencies] |
| tauri-winrt-notification | 0.7.3 | [target.'cfg(windows)'.dependencies] |
| windows-registry | 0.6.1 | [target.'cfg(windows)'.dependencies] |
| windows-sys | 0.61.2 | [target.'cfg(windows)'.dependencies] |

### 辅助工程直接依赖（独立统计）

| 名称 | 锁定版本 | 范围 |
| --- | --- | --- |
| rusqlite | 0.40.2 | [dependencies] |
| serde | 1.0.229 | [dependencies] |
| serde_json | 1.0.151 | [dependencies] |
| tauri | 2.12.5 | [dependencies] |
| chrono | 0.4.45 | [dependencies] |
| tracing | 0.1.44 | [dependencies] |
| sherpa-onnx | 2.0.1 | [dependencies]（可选 speech） |
| bzip2 | 0.4.4, 0.6.1 | [dev-dependencies] |
| uuid | 1.29.0 | [dev-dependencies] |

### Android：全部 11 项依赖声明及插件

| 名称 | 实际版本 |
| --- | --- |
| androidx.compose:compose-bom | 2024.10.01 |
| androidx.compose.ui:ui | 1.7.5 |
| androidx.compose.ui:ui-tooling-preview | 1.7.5 |
| androidx.compose.material3:material3 | 1.3.1 |
| androidx.activity:activity-compose | 1.9.3 |
| androidx.lifecycle:lifecycle-runtime-ktx | 2.8.7 |
| androidx.core:core-ktx | 1.15.0 |
| org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.9.0 |
| com.squareup.okhttp3:okhttp | 4.12.0 |
| org.jetbrains.kotlinx:kotlinx-serialization-json | 1.7.3 |
| androidx.compose.ui:ui-tooling | 1.7.5 |

插件：com.android.application **8.7.2**；org.jetbrains.kotlin.android / org.jetbrains.kotlin.plugin.compose 均为 **2.4.20**。Gradle **8.14.6**，JDK **21**。


### 关键间接版本（所有锁文件中的不同版本均保留）

| 生态 | 名称 | 实际版本 | 锁文件来源 |
| --- | --- | --- | --- |
| npm | @oven/bun-windows-x64 | 1.4.4 | package-lock.json；desktop/baileys-bridge/package-lock.json |
| npm | vite | 6.4.5 | package-lock.json；desktop/package-lock.json |
| npm | esbuild | 0.25.12 | package-lock.json；desktop/package-lock.json |
| npm | nanoid | 3.3.19 | package-lock.json；desktop/package-lock.json |
| npm | postcss | 8.5.28 | package-lock.json |
| npm | protobufjs | 7.6.5 | package-lock.json；desktop/baileys-bridge/package-lock.json |
| npm | rollup | 4.64.0 | package-lock.json |
| npm | esbuild | 0.28.2 | package-lock.json；desktop/package-lock.json |
| npm | whatsapp-rust-bridge | 0.5.4 | package-lock.json；desktop/baileys-bridge/package-lock.json |
| npm | ws | 8.21.2 | package-lock.json |
| npm | postcss | 8.5.25 | desktop/package-lock.json |
| npm | rollup | 4.62.3 | desktop/package-lock.json |
| npm | ws | 8.21.1 | desktop/baileys-bridge/package-lock.json |
| crates.io | glib | 0.18.5 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | libsqlite3-sys | 0.38.2 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | proc-macro-error | 1.0.4 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | rustls | 0.23.46 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | rustls-webpki | 0.103.16 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | sherpa-rs-sys | 0.5.1 | desktop/src-tauri/Cargo.lock |
| crates.io | tar | 0.4.46 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | tokio | 1.54.1 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | webpki-roots | 0.26.11 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | webpki-roots | 1.0.11 | desktop/src-tauri/Cargo.lock；docs/security/native-compatibility/Cargo.lock |
| crates.io | zbus_names | 4.3.4 | desktop/src-tauri/Cargo.lock |
| crates.io | zip | 9.1.3 | desktop/src-tauri/Cargo.lock |
| crates.io | zvariant | 5.14.0 | desktop/src-tauri/Cargo.lock |
| crates.io | zvariant_derive | 5.14.0 | desktop/src-tauri/Cargo.lock |
| crates.io | sherpa-onnx-sys | 2.0.1 | docs/security/native-compatibility/Cargo.lock |
| crates.io | zip | 9.2.2 | docs/security/native-compatibility/Cargo.lock |
| Maven | com.google.guava:guava | 33.7.2-jre | android/buildscript-gradle.lockfile；android/app/gradle.lockfile |
| Maven | com.google.protobuf:protobuf-java | 3.25.5 | android/buildscript-gradle.lockfile；android/app/gradle.lockfile |
| Maven | commons-io:commons-io | 2.15.1 | android/buildscript-gradle.lockfile；android/app/gradle.lockfile |
| Maven | io.netty:netty-codec-http2 | 4.1.137.Final | android/buildscript-gradle.lockfile；android/app/gradle.lockfile |
| Maven | io.netty:netty-handler | 4.1.137.Final | android/buildscript-gradle.lockfile；android/app/gradle.lockfile |
| Maven | org.apache.commons:commons-compress | 1.26.0 | android/buildscript-gradle.lockfile |
| Maven | org.apache.commons:commons-lang3 | 3.18.0 | android/buildscript-gradle.lockfile |
| Maven | org.bitbucket.b_c:jose4j | 0.9.6 | android/buildscript-gradle.lockfile |
| Maven | org.bouncycastle:bcprov-jdk18on | 1.85 | android/buildscript-gradle.lockfile |
| Maven | org.jdom:jdom2 | 2.0.6.1 | android/buildscript-gradle.lockfile |

运行时：Bun **1.4.4**；CI/审计 Node **22.23.4**；SQLite **3.53.2**；独立 FFmpeg **9.0.2**。这些运行时不能只依靠 npm audit 的库版本扫描覆盖。


## 附录 B：问题精确位置

| 编号 | 位置及关键调用 |
| --- | --- |
| S01 | desktop/baileys-bridge/package.json:15；node_modules/baileys/lib/Utils/generics.js:182 |
| S02 | .nvmrc:1 |
| S03 | android/gradle/wrapper/gradle-wrapper.properties:3 |
| S04 | desktop/src-tauri/Cargo.toml:40；desktop/src-tauri/src/db.rs:1462 |
| S05 | docs/security/native-compatibility/Cargo.toml:14 |
| S06 | desktop/src/lib/aiResponse.ts:4；aiSuggest.ts、gemini.ts、aiCustomerCard.ts、translateDraft.ts、transcribeVoice.ts、listModels.ts 的所有 readAiJson 调用 |
| S07 | desktop/src/lib/listModels.ts:59 |
| S08 | desktop/src-tauri/src/google_sheets.rs:46；desktop/src/lib/googleSheetErrors.ts:8 |
| S09 | android/app/src/main/java/com/wapplus/bridge/ui/MainActivity.kt:100；android/app/src/main/java/com/wapplus/bridge/a11y/WaAssistService.kt:824；android/app/src/main/java/com/wapplus/bridge/net/MediaSharePolicy.java:4 |
| S10 | desktop/baileys-bridge/audioConvert.mjs:7；desktop/src-tauri/src/baileys.rs:212；tools/prepare-ffmpeg.ps1:1；desktop/src-tauri/tauri.conf.json 的 externalBin/resources |
| S11 | desktop/src-tauri/Cargo.lock:1456 |
| S12 | desktop/src-tauri/Cargo.toml:44；Cargo.lock 的 proc-macro-error / zbus_names / zvariant / zvariant_derive |
| S13 | .gitignore；.env.example；tools/security-secret-scan.mjs；Git 全可达历史 |

## 附录 C：最终验证清单

| 审核 / 测试 | 结果 | 边界 |
| --- | --- | --- |
| npm run check | 通过：1,033 项测试，0 失败，0 跳过；前端构建、Bun 编译、Bridge smoke 通过 | 使用独立 Node 22.23.4 / Bun 1.4.4 / FFmpeg 9.0.2 |
| 产品 cargo test --locked --lib --tests | 通过：151 项，0 失败 | Windows；包含真实旧 SQLite 合成文件迁移 |
| 辅助 cargo test | 通过：28 项 | 真实产品数据库代码 |
| 辅助 cargo test --locked --features speech | 通过：29 项 | Tiny 原版及 int8 公开样本实际解码 |
| Android strict testDebugUnitTest / assembleDebug | 通过：41 个任务执行，BUILD SUCCESSFUL | 未进行真实手机 UI / 收发测试；不能把 Gradle 任务数当单元测试条数 |
| Java 独立策略断言 | 通过：BoundedInputCheck、MediaSharePolicyCheck | 来源、超时、代次与容量边界 |
| Gradle 官方哈希核验 | 通过：702 / 702，零不匹配 | 没有放宽 verification-metadata |
| 三处 npm audit | 通过：各 0 条 | 不覆盖全部内嵌运行时 / 原生库 |
| 全锁文件 OSV | Windows 当前解析图无命中；全平台仍有 5 个包告警 | glib 1 个漏洞、4 个停维护告警；不是全生态零告警 |
| FFmpeg 首次准备与重复准备 | 通过：全新隔离目录实际下载、双哈希核验、指定文件提取；重复调用通过 | 固定 9.0.2；不修改全局安装 |
| FFmpeg / 网络媒体重点回归 | 通过：10 项，0 跳过 | 包含真实音频转换、时长和网络引用拒绝 |
| 密钥 / 历史扫描 | 通过核验：无已确认真实凭据泄露 | 模式扫描存在漏报可能，未验证外部平台有效性 |
| Linux / macOS 安全与成品 | 未通过完整发布审核 | 未构建；Linux glib 待处理 |
| 产品旧离线引擎维护 | 建议关注 | 归档上游与完整原生 SBOM 仍需迁移验证 |
| 新安装包端到端升级 | 未执行 | 已补充 CI 安装包中独立 FFmpeg 哈希/许可文件检查，留到实际发布执行 |
