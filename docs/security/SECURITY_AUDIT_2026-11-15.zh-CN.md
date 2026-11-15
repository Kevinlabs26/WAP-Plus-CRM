# BridgeCRM 安全审核（2026-11-15）

基线：`fdd228dc1ce36723c78f4c7166c3a5c98b90f988`，产品版本 0.1.74，加本轮安全修改。原有未提交的 `desktop/src/components/layout/chatSidebarUtils.ts` 改动保留。本轮没有提交、push、创建 Release、轮换密钥或读取真实客户数据库。

## 1. 项目概况与审核范围

这是 Windows 优先的 WhatsApp CRM：React 18 / TypeScript / Vite 6 前端，Tauri 2 / Rust 原生层，SQLCipher 数据库，Node / Bun 编译的 Baileys sidecar，FFmpeg 媒体处理，以及 Kotlin / Java / Compose Android Bridge。包管理为 npm workspaces、Cargo、Gradle；没有产品浏览器扩展、Python 服务或 NoSQL 服务。

- npm 三份 manifest、三份 lock：31 个直接声明。
- 产品 Rust 29 个直接声明，另有原生兼容辅助工程 9 个直接 / 可选 / dev 声明。
- Android 11 个应用 / BOM / debug 声明，3 个构建插件，2 份 Gradle lock，wrapper 及依赖校验元数据。
- 全部锁文件去重后为 **1,439 个生态 / 名称 / 精确版本组合**：npm 425、crates.io 720、Maven 294。包括开发、辅助工程和其他平台依赖，并非安装程序运行依赖数。
- 对 **911 个被跟踪的源码、配置、脚本、测试和文档文件，共 172,076 行**建立逐文件规则扫描和 SHA-256 清单。排除历史审核报告、二进制与锁文件的源码行数统计；锁文件另行完整查询。覆盖表为 `source-coverage-2026-11-15.csv`。
- 人工跟踪高风险入口和相连调用：本机 HTTP 鉴权、账号隔离、下载与上传、原始缓存、SQL / 备份、IPC / WebView、外链与进程启动、OAuth / Vertex、凭据存储、Android 导出组件和 CI。**逐文件规则覆盖不等于逐行独立人工证明**；没有执行生产渗透、真机攻击或第三方原生库模糊测试。

依赖核查使用 76 条按名称分别提交的 WebSearch 查询，并读取官方公告；对全部 1,439 个锁定元组请求 OSV，另运行三种入口的 npm audit。没有安装 cargo-audit、osv-scanner、gitleaks 或 semgrep，未声称运行它们。WebSearch 无结果不证明无漏洞。原始查询 / 维护信息在忽略的本地证据目录，不包含用户凭据。

## 2. 问题汇总

表中 Gradle 严重性采用官方公告；其余未有 CVSS 的条目为本项目条件评级，不能解读为已确认的匿名远程利用。

|编号|类别|严重级别|位置（修复后）|状态|
|---|---|---|---|---|
|D01|依赖|Critical|`android/gradle/wrapper/gradle-wrapper.properties:3`|已修复：Gradle 8.14.7，版本目录代码注入|
|D02|依赖|High|同上|已修复：daemon 注册表信任 / 反序列化|
|D03|依赖|High|同上|已修复：stale daemon 端口冒用|
|D04|依赖|Medium（当前构建未启用）|`desktop/src-tauri/Cargo.lock:3086`|已修复：quinn-proto 0.11.18 → 0.11.19，两项 DoS 公告|
|D05|依赖|Medium（平台条件）|`desktop/src-tauri/Cargo.lock:3109`|已修复：quinn-udp 0.5.15 → 0.5.16|
|C01|代码|Low|`desktop/baileys-bridge/rawMediaStore.mjs:113`|已修复：磁盘原始缓存实际读取限制为 4 MiB|
|R01|代码|Medium|`desktop/baileys-bridge/index.mjs:133`、`:188`、`:751`|建议关注：开发者明确决定本轮保留，单独迁移明文登录资料 / 缓存|
|R02|依赖|Medium（生命周期）|`desktop/src-tauri/Cargo.lock:2717`|建议关注：开发者明确决定单独迁移已 EOL 的 OpenSSL 3.6|
|R03|依赖|Medium（Linux 条件）|`desktop/src-tauri/Cargo.lock:1456` 及辅助工程 glib|建议关注：开发者明确决定本轮保留，Linux 暂不发布|
|R04|依赖|Low|`desktop/src-tauri/Cargo.toml:46`|建议关注：开发者明确决定单独迁移已归档的 sherpa-rs|
|R05|依赖|Low|`desktop/src-tauri/Cargo.lock:3024`、`:6083`、`:6204`、`:6219`|建议关注：停止维护的间接依赖|
|R06|依赖|Low|`desktop/baileys-bridge/package.json` 的 qrcode；AndroidX / UI 旧声明|建议关注：更新节奏 / 陈旧版本，无本轮确认漏洞|

未确认真实生产密钥泄露，因此没有凭空添加“密钥漏洞”或擅自轮换。未发现需要本轮跨大版本处理的、已确认 Windows 运行路径可达的 Critical / High 漏洞；这不消除 R01 / R02 等保留风险。

## 3. 已修复问题、利用条件和改动

### D01—D03：Gradle 8.14.6 不再是充分的安全基线

本轮重新查询发现 [8.14.7 官方发布说明](https://docs.gradle.org/8.14.7/release-notes.html) 新增三项修复。Gradle 分发包自身并不作为 `org.gradle:gradle-core` 应用依赖出现在项目 lock 中，单靠 OSV 锁文件查询或 npm audit 会漏掉它。

1. **D01：版本目录值可成为生成的 Java 代码。** [GHSA-3cfg-jpcr-gfp3](https://github.com/gradle/gradle/security/advisories/GHSA-3cfg-jpcr-gfp3)，官方 Critical。恶意本地 / 导入版本目录在 settings 阶段执行，可读取构建环境凭据。本项目目前未定义或导入 version catalog，也没有 `libs.versions.toml`，因此没有确认现有仓库可直接触发该路径；构建不可信改动 / 将来导入目录仍存在条件风险。
2. **D02：客户端过度信任 daemon 注册表。** [GHSA-gqrr-4j89-5267](https://github.com/gradle/gradle/security/advisories/GHSA-gqrr-4j89-5267)，官方 High。恶意项目可指定注册表位置，使客户端反序列化或向错误地址发送构建环境。本项目当前和可达历史未发现 `org.gradle.daemon.registry.base` 配置，未跟踪 `registry.bin`；不存在已确认的恶意注册表。修复仍不能让主动信任恶意项目提供的注册表变得安全。
3. **D03：客户端未验证旧 daemon 端口上的进程身份。** [GHSA-pcp8-98xm-c6pr](https://github.com/gradle/gradle/security/advisories/GHSA-pcp8-98xm-c6pr)，官方 High。攻击者需同机占用异常退出 daemon 遗留的端口，可能收到环境变量并返回恶意对象；不是公网匿名远程攻击。项目正常使用 daemon，故共享构建机上条件成立时有实际风险。

三项均影响 8.14.6，兼容修复为 **8.14.7**，无须升级 Gradle 9 或 AGP。本轮更新 wrapper URL，并从官方 HTTPS 下载站读取、校验并固定 SHA-256：

`903bfc4bc7622323124054c10f509246212a1902948bdaf26c379cca8735e856`

同步更新 `desktop/tests/security-runtime-versions.test.mjs` 的最低 Gradle 和对应 hash 断言。保留严格依赖验证、现有插件版本及业务行为。完整 Android 测试 / APK 构建通过。

### D04—D05：QUIC 锁版本中的三项拒绝服务

- **quinn-proto**：0.11.18 → **0.11.19**。[RUSTSEC-2026-0523](https://rustsec.org/advisories/RUSTSEC-2026-0523.html) 的远端流编号可突破并发上限；需应用接受对端发起的双向流。[RUSTSEC-2026-0524](https://rustsec.org/advisories/RUSTSEC-2026-0524.html) 的超长 Retry token 可令 QUIC 客户端崩溃或尝试巨额内存分配；恶意服务端或可抢先回应握手的攻击者可触发。
- **quinn-udp**：0.5.15 → **0.5.16**。[RUSTSEC-2026-0538](https://rustsec.org/advisories/RUSTSEC-2026-0538.html) 的截断数据包可使部分平台接收循环持续占用 CPU。官方明确 Windows / Linux / Android 使用其他路径，不受此接收循环问题影响；Apple 等平台另有条件。

公告未给出官方 CVSS，不编造 High 或 CVE。`cargo tree --locked -i quinn-proto` 和 `-i quinn-udp` 在当前 Windows 默认特征下均无启用路径。它们经 reqwest 的可选 HTTP/3 路径进入产品 lock；项目未启用 `http3`，未发现 QUIC 连接代码。因此本次是消除锁文件中的潜在风险，不能声称修复了已可达的 Windows 远程崩溃。

只精确更新两个包；Cargo.toml 无变化。Cargo 同时规范化若干既有 windows-sys 依赖边，未额外批量更新包版本。最终 OSV 不再报告这三项，Rust 全量测试通过。

### C01：原始缓存读取没有执行写入时的大小限制

`createRawMediaStore` 写入拒绝超过 4 MiB 的条目，但此前 `load` 对已有磁盘文件使用无界 `readFile`。原始缓存总预算为 512 MiB，单个超大但仍低于总预算的文件不会因总量裁剪而被拒绝。损坏文件、旧程序留下的超大条目或能替换缓存的本机主体，可令下载 / 重发路径分配大量内存并反序列化。需要本机文件控制或损坏条件，未确认远程聊天内容能绕过现有写入上限。

- `desktop/baileys-bridge/rawMediaStore.mjs` 改为文件流配合既有 `readBoundedStream`，**实际最多接受 4 MiB**，超限停止并按原有失败语义返回 null，不删除文件。
- 修改同一共享读取入口，覆盖 `media-index` 与 `message-index`，正常缓存和旧格式迁移仍通过原解码器。
- `desktop/tests/raw-media-store.test.mjs` 写入一个有效但超限的磁盘 JSON，验证不能绕过限制，且其他正常媒体仍可读取。相关小测及全量检查通过。

## 4. 需要取舍的风险及开发者决定

本轮已展示选择并收到开发者明确答复。以下均不是遗漏授权后未执行的兼容补丁。

- **R01 Baileys 静态数据**：`useMultiFileAuthState(authDir)` 登录文件和部分原始消息索引为明文。读取用户目录、备份或泄露归档的人可能获得会话材料 / 消息资料；实际重放登录受服务端状态约束，未使用真实账号验证。方案 A：保留并另做迁移；方案 B：实施 DPAPI 登录 / 缓存适配，验证旧数据迁移、重连和恢复。**开发者已选择 A**。后续建议 B；不要公开分享 auth 目录，也不要以删除它代替迁移。
- **R02 OpenSSL**：锁为 openssl-src **300.6.1+3.6.3**；[官方确认 3.6 已于 2026-11-01 EOL](https://openssl-library.org/post/2026-11-01-eol34-36/)。[官方 3.6 漏洞清单](https://openssl-library.org/news/vulnerabilities-3.6/index.html) 还列有后续安全修复。项目通过 SQLCipher 使用其加密 / KDF，reqwest 默认 Rustls；未找到 OpenSSL TLS / QUIC / CMS / PKCS12 等已公告入口，不能直接将全部 TLS High 套到此项目。方案 A：本轮记录，专门迁移；方案 B：立即变更原生库栈并验证旧加密库、WAL、备份、安装包。**开发者已选择 A**；未来新增 OpenSSL 功能时需重新评估。
- **R03 glib**：锁为 **0.18.5**。[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) 的 VariantStrIter 未定义行为修复于 **0.20.0**，需跨 0.x 兼容边界协调 GTK / Tauri，不能随意 lock 强制替换。当前 Windows 不含 GTK。方案 A：记录并暂停 Linux 发布；方案 B：本轮迁移并实机验证。**开发者已选择 A**。macOS / Linux 也仍需解决现有 Windows DPAPI 依赖，Windows 检查不能替代跨平台可用性验证。
- **R04 sherpa-rs**：**0.5.1** 已[归档且官方建议改用 sherpa-onnx Rust API](https://github.com/thewh1teagle/sherpa-rs)。本地下载表确认 Windows 静态内嵌 sherpa-onnx **1.10.28**，上游下载有 SHA-256 核验。方案 A：本轮保留并记录；方案 B：迁移官方 API、验证语音、原生 ABI、构建和安装包。**开发者已选择 A**。额外查到 [CVE-2026-108954](https://github.com/advisories/GHSA-f5q5-vp8g-wh4x) / [上游问题](https://github.com/k2-fsa/sherpa-onnx/issues/3983)：恶意 transducer 模型 metadata 与 joiner 维度不一致可越界。项目目前只创建 WhisperRecognizer，未发现受影响的 transducer 解码入口；公告没有明确本项目内嵌版本的修复基线，**原生代码存在性待确认**，不将该公告描述成已修复或可达。未来启用 transducer 前必须处理。

其他维护关注：proc-macro-error 1.0.4、zbus_names 4.3.4、zvariant / zvariant_derive 5.14.0 的 OSV 维护告警仍保留，后三项主要为 Linux D-Bus 链。qrcode 1.5.4 的所用版本发布时间为 2024-08，registry 最近修改 2025-11；只是更新稀疏，不能证明放弃维护。lucide-react 0.468.0、React 18 和部分 AndroidX / Compose 所用版本陈旧，上游仍有更新；未确认仿冒或这些版本的新可利用漏洞。drizzle-kit 的旧 @esbuild-kit 工具已弃用，现有 esbuild override 保留，未来随上游工具迁移。

## 5. 其他依赖核对与误报

- npm audit 根 workspace、desktop 独立、sidecar 独立入口均 **0 vulnerabilities**。OSV 仍报告的并非全部应忽略：glib 和维护告警是真实保留项；xlsx 两项需渠道识别。
- xlsx 为官方 CDN **0.20.3**，不是 npm registry 的旧 0.18.5。[CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) 修复 >=0.19.3，[CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363) 修复 >=0.20.2。OSV npm 渠道无上界范围不能用于将 CDN 修复版降回旧版。
- Vite 6.4.6 已高于 [Critical 虚拟模块 RCE](https://github.com/vitejs/vite/security/advisories/GHSA-p4f5-76q4-ffq7) 的受影响上限；开发服务器默认本机监听，配置外部 host 时仍须保护开发环境。
- tauri-plugin-shell 2.3.5 高于 [open 协议校验公告](https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp) 修复版 2.2.1；drizzle-orm 0.45.3 高于[标识符 SQL 注入公告](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9) 修复版 0.45.2。
- React 为普通客户端渲染，没有 react-server-dom / RSC 运行路径。不能把 [RSC Critical 公告](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) 误套到 React 18 UI；@vitejs/plugin-react 也不等于 plugin-rsc。
- 构建 sidecar 使用 Bun **1.4.4**，已满足 [emSign 信任修复](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84)。编译 exe 内嵌运行时，必须重新构建才能应用修复，本轮已重新编译。
- 项目 Node pin 为 **22.23.5**，本轮全量 npm 检查使用该便携运行时，符合[官方安全版本](https://nodejs.org/en/blog/release/v22.23.5)。系统默认仍为 22.23.2，不在本轮替换范围；启动开发服务应使用项目运行时。
- FFmpeg **9.0.2** 下载包 / exe hash 在准备入口校验，调用参数固定 `file,pipe` 协议、参数数组和超时，未发现外部媒体 URL 可直接开启其网络协议。原生解码器没有做独立模糊测试。
- 未发现已确认的仿冒依赖；实际 `baileys 7.0.0-rc14` 来源为 WhiskeySockets。仍是 RC 版本，稳定性和第三方平台行为另有风险。

## 6. 代码检查结果

|检查面|已核对边界与结论|
|---|---|
|SQL / NoSQL / 模板|SQLite 值参数绑定；动态表 / 列来自内部常量调用，跟踪 load_table / 清理 / 图片库调用，未确认外部文本变为 SQL 标识符。没有产品 NoSQL 服务或外部模板执行入口。|
|命令 / 动态执行|原生 Command 与 JS 子进程使用参数数组；手机号 / 账号 / App ID 校验；Muse eval 使用内置 driver、JSON 序列化参数和精确 HTTPS origin 检查。未把本地旧 V8 缓存解码武断视为任意 JS 执行；C01 限制其输入大小。|
|XSS / 外链|React 文本节点输出；未发现产品 dangerouslySetInnerHTML。聊天链接仅允许 HTTP(S)，号码构造固定 wa.me URL，noopener / noreferrer；shell 插件已过修复基线。|
|鉴权 / 越权 / CSRF / CORS|Baileys 仅绑定 127.0.0.1，来源白名单和随机 token 在业务路由前，存在账号与 expected-phone 检查。OPTIONS 不要求 token，但不执行业务。二进制上传走同一边界。CORS 本身不被当作鉴权。|
|SSRF / TLS|remoteMedia 要求公共 HTTPS、拒绝凭据 / 非标准端口 / 内网地址，每跳重验并将 DNS 结果固定到 TLS 连接；Google / Vertex 固定服务端且不自动重定向，未发现关闭 TLS 证书验证。自定义 AI 地址为用户配置能力，非匿名 URL 转发器。|
|上传 / 下载 / 解压|请求体、视频、文件、模型下载及原生文件读取有上限；模型 tar 拒绝越界路径、链接 / 特殊文件并限制数量 / 总量；分阶段安装，失败保留旧模型。C01 修复原始索引的实际读取缺口。|
|桌面 IPC / WebView|capability 仅覆盖 main，远端 Muse 窗口无应用 IPC capability；远端执行前校验 origin，driver 自身也检查 origin / 客户线程。没有 Electron nodeIntegration。应用锁是 UI 隐私能力，不能防已控制同一 OS 用户的攻击者。|
|凭据 / 加密|Windows SQLCipher + DPAPI；缺失 / 错误 DB key 不重建覆盖库。备份随机 salt / IV、PBKDF2-SHA256 600,000 / AES-256-GCM，spool AES-GCM 使用随机 IV / AAD。R01 明文 auth / 原始缓存仍保留，不能因主库加密就声称全部文件加密。|
|日志 / 错误|HTTP 日志避免 SDK 原始 payload，Android 操作日志不再含完整号码；仍应把诊断、同步调试、导出和历史备份视为敏感资料。未确认匿名远端可读取这些日志。|
|OAuth / 云盘|PKCE + state、有界 loopback 回调、固定授权服务端；Drive 检查预期账号、目录能力和继承共享权限，token 不随重定向发送。没有用 desktop client_secret 代替用户授权。|
|AI / 导出 / 恢复|模型输入是外部不可信内容，人工补充说明是授权产品能力；模型不获得任意本机执行接口。CSV 对公式前缀转义，备份过滤凭据，恢复先验证并暂停新的发送。模型对指令的遵从性不构成形式化安全保证。|
|Android|ServerSocket 仅 loopback，token 常量时间比较、认证超时、输入和 worker 上限；FileProvider 不导出，Accessibility 受系统签名权限约束，allowBackup=false。明文 loopback 桥接不等于公网监听。无 JavaScript interface / 产品 WebView 注入入口。|
|CI/CD|未发现 pull_request_target；第三方 Action 固定提交 SHA，CI contents:read，发布 workflow 才写权限；未把 PR 标题 / body 直接插入脚本。签名 secret 使用非 VITE_ 环境变量，requireSignedVersion 保留。Gradle 分发升级如 D01—D03。|
|浏览器扩展|未发现产品扩展 manifest，此项不适用。|

## 7. 密钥与凭据扫描

- 工作树规则扫描 **37,000 文件 / 2,047,158,066 字节**，含源码、配置、测试、示例、文档、前端 dist、编译 sidecar / FFmpeg 以及临时构建副本。另对被跟踪文本执行通用凭据赋值规则，命中均为翻译标签或测试占位值。
- 排除 `.git`、node_modules、Rust target、Gradle / 工具缓存、生成目录及指定图片 / 模型 / 压缩文件；没有声称解包扫描全部模型、安装器或所有 target 二进制。node_modules 仅用于追溯候选来源，未计作全量扫描。
- 本地可达 Git 历史：**194 个提交、4,366 个 blob，约 105 MB batch 数据**。8 个候选均为拒绝测试中的带用户名密码 URL、PEM 解析头和明确命名的 RSA 测试 fixture。不含远端未获取 / 不可达 / 已删除对象。
- 二进制候选重新比对当前依赖源码：Google Key 外形字串在 Baileys `WABinary/constants.js:600` 的协议字典中；AWS Key 外形字串在 `whatsapp-rust-bridge/dist/index.js:1967` 的长编码块内。FFmpeg 命中为 OpenSSH 算法名和 PEM 解析标记，没有对应的 PEM 私钥正文。没有把候选值传给 WebSearch 或写入报告。
- 跟踪的 env 文件只有变量名 / 空值的 `.env.example`。`git check-ignore` 确认根 / desktop 的 `.env` 及变体、`desktop/src-tauri/client_secret.local.json` 有效忽略。未发现跟踪的生产 OAuth 配置。
- Desktop OAuth client 配置随应用分发是 public-client 模式；[Google 官方说明桌面客户端不能保守 client_secret](https://developers.google.com/identity/protocols/oauth2/native-app)。它不等于用户 refresh token 或服务账号私钥；本项目用户授权材料仍需 DPAPI 保护。
- 没有确认需要改成新环境变量的硬编码生产密钥，保留现有 `.env.example`，不添加虚构变量。**任何真实密钥若曾提交 / 泄露，必须在对应平台撤销并重新生成；只删除代码、忽略文件或清 Git 历史不够。本轮没有轮换。**

## 8. 修复后的验证

|检查|结果|
|---|---|
|`npm run check`（项目 Node 22.23.5）|通过；1531 项，1530 passed、0 failed、1 既有条件跳过；TypeScript / Vite 生产构建、Bun sidecar 编译、Bridge mock smoke 均通过|
|`cargo test --locked --lib --tests --manifest-path desktop/src-tauri/Cargo.toml`|通过；11 个 harness，274 passed、0 failed、16 既有 ignored；含加密库 / 备份 / 账号边界测试|
|Gradle 8.14.7 `--dependency-verification strict :app:testDebugUnitTest :app:assembleDebug`|通过；1 分 47 秒，41 任务执行|
|缓存 / runtime 小测|3 passed，0 failed|
|依赖审核脚本小测|通过|
|`tools/security-verify-gradle-artifacts.test.py`|通过：official artifact verification checks passed|
|三入口 npm audit|全部 0 vulnerabilities|
|OSV 全锁复扫|完成；QUIC 三项消除，保留 glib、维护告警及经厂商公告核对的 xlsx 渠道误报|
|`git diff --check`|通过|

环境说明：Rust 构建使用项目缓存 Strawberry Perl 供 vendored OpenSSL；Android 使用进程级 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp` 规避本机 JDK 回环路径问题，没有提交该环境变通、关闭校验或修改系统 JDK。此前已获许可关闭的开发版未重启。Rust 的已有未使用函数 / 链接警告和 Gradle 9 弃用提示保留。

本轮没有重新执行需真实 WhatsApp / 交互客户端的 ignored 测试，没有运行安装器 smoke（该脚本要求干净 runner），也没有生成正式签名安装器。之前生成的旧安装包不会自动获得这次修复。

## 9. 剩余风险与建议

1. 按开发者决定独立安排 Baileys 加密、OpenSSL 和语音栈迁移；每项应以真实兼容性回归 / 重连 / 旧库恢复 / 安装包验证结束。
2. Linux 暂不发布；macOS 也需要系统安全存储适配与实机测试。不要把当前 Windows 通过当成跨平台发布结论。
3. 项目运行时与系统运行时分开：使用项目 Node；本机 JDK 安全补丁和 WebView2 / OS 更新另行维护。未擅自改全局环境。
4. 密钥规则、OSV、WebSearch 都有盲区；未做生产账号接管、真机攻击、未知漏洞证明、原生解码器模糊测试。用户选择的模型 / 自定义 AI endpoint 仍须可信，HTTPS 下载不等于独立内容签名。
5. 本轮源码修复和验证完成，尚未提交 / 上传；后续 Release 应基于本轮源码重新构建，保留 GitHub 的签名与干净 runner 安装验证。

## 10. 可复核证据和依赖明细

- `dependencies-2026-11-15.csv`：全部 npm / Cargo / Maven 锁记录，带来源和配置；同一包多版本 / 独立入口差异不隐藏。
- `source-coverage-2026-11-15.csv`：逐文件路径、行数、字节、hash 和五类规则命中数。
- 忽略的结构化结果：`docs/security/dependency-inventory.json`、`osv-audit.json`、`secret-scan.json`。
- 本地 `.audit-cache/`：`web-dependencies-20261115.json`、三入口 `npm-audit-*-20261115.json`、`secret-history-20261115.json`、`secret-assignment-20261115.json`、`binary-secret-origins-20261115.json`、`ffmpeg-secret-classification-20261115.json`。
- 本地验证日志：`.audit-cache/security-check-20261115.log`、`security-rust-20261115.log`、`security-android-20261115.log`、`security-dependencies-final-20261115.log`。这些原始日志按仓库规则不提交。

以下列出所有直接依赖。Rust “实际直接版本”按产品自身的 lock 依赖边解析，例如 base64 直接为 0.22.1，不能将间接出现的 0.21.7 / 0.23.1 都写成直接版本。

### npm 直接声明

|清单 / 用途|包|声明|根 workspace 实际版本|
|---|---|---|---|
|desktop/package.json / dependencies|@tauri-apps/api|^2.0.0|2.11.1|
|desktop/package.json / dependencies|@tauri-apps/plugin-notification|^2.0.0|2.3.3|
|desktop/package.json / dependencies|@tauri-apps/plugin-shell|^2.0.0|2.3.5|
|desktop/package.json / dependencies|@tauri-apps/plugin-updater|^2.11.0|2.11.0|
|desktop/package.json / dependencies|clsx|^2.1.1|2.1.1|
|desktop/package.json / dependencies|countries-and-timezones|^3.11.0|3.11.0|
|desktop/package.json / dependencies|drizzle-orm|^0.45.3|0.45.3|
|desktop/package.json / dependencies|emoji-picker-react|^4.18.0|4.18.0|
|desktop/package.json / dependencies|franc-min|^6.2.0|6.2.0|
|desktop/package.json / dependencies|libphonenumber-js|^1.13.15|1.13.15|
|desktop/package.json / dependencies|lucide-react|^0.468.0|0.468.0|
|desktop/package.json / dependencies|react|^18.3.1|18.3.1|
|desktop/package.json / dependencies|react-dom|^18.3.1|18.3.1|
|desktop/package.json / dependencies|react-virtuoso|^4.18.11|4.18.11|
|desktop/package.json / dependencies|tailwind-merge|^2.5.5|2.6.1|
|desktop/package.json / dependencies|xlsx|https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz|0.20.3|
|desktop/package.json / dependencies|zustand|^5.0.2|5.0.14|
|desktop/package.json / devDependencies|@tauri-apps/cli|^2.12.2|2.12.2|
|desktop/package.json / devDependencies|@types/react|^18.3.12|18.3.31|
|desktop/package.json / devDependencies|@types/react-dom|^18.3.1|18.3.7|
|desktop/package.json / devDependencies|@vitejs/plugin-react|^4.3.4|4.7.0|
|desktop/package.json / devDependencies|autoprefixer|^10.4.20|10.5.4|
|desktop/package.json / devDependencies|drizzle-kit|^0.31.11|0.31.11|
|desktop/package.json / devDependencies|postcss|^8.4.49|8.5.28|
|desktop/package.json / devDependencies|tailwindcss|^3.4.16|3.4.19|
|desktop/package.json / devDependencies|typescript|^5.6.3|5.9.3|
|desktop/package.json / devDependencies|vite|^6.4.6|6.4.6|
|desktop/baileys-bridge/package.json / dependencies|baileys|7.0.0-rc14|7.0.0-rc14|
|desktop/baileys-bridge/package.json / dependencies|pino|10.3.1|10.3.1|
|desktop/baileys-bridge/package.json / dependencies|qrcode|1.5.4|1.5.4|
|desktop/baileys-bridge/package.json / devDependencies|bun|1.4.4|1.4.4|

### 产品 Rust 直接声明（含 build / Windows）

|包|实际直接版本|
|---|---|
|base64|0.22.1|
|bzip2|0.4.4|
|chrono|0.4.45|
|futures-util|0.3.33|
|png|0.18.1|
|reqwest|0.13.4|
|ring|0.17.14|
|rusqlite|0.42.0|
|serde|1.0.229|
|serde_json|1.0.151|
|sha2|0.10.9|
|sherpa-rs|0.5.1|
|tar|0.4.46|
|tauri|2.12.5|
|tauri-build|2.7.4|
|tauri-plugin-notification|2.3.3|
|tauri-plugin-shell|2.3.5|
|tauri-plugin-single-instance|2.4.4|
|tauri-plugin-updater|2.14.1|
|tauri-winrt-notification|0.7.3|
|thiserror|2.0.21|
|tokio|1.54.1|
|tracing|0.1.44|
|tracing-subscriber|0.3.23|
|url|2.5.8|
|uuid|1.24.0|
|windows|0.61.3|
|windows-registry|0.6.1|
|windows-sys|0.61.2|

### 辅助 Rust 工程（包括可选和 dev）

|名称|版本|
|---|---|
|rusqlite|0.42.0|
|serde|1.0.229|
|serde_json|1.0.151|
|tauri|2.12.5|
|chrono|0.4.45|
|tracing|0.1.44|
|sherpa-onnx|2.0.1|
|bzip2|0.4.4|
|uuid|1.29.0|

### Android 应用 / BOM / debug 直接依赖

|名称|版本|
|---|---|
|androidx.compose:compose-bom|2024.10.01|
|androidx.compose.ui:ui|1.7.5|
|androidx.compose.ui:ui-tooling-preview|1.7.5|
|androidx.compose.ui:ui-tooling|1.7.5|
|androidx.compose.material3:material3|1.3.1|
|androidx.activity:activity-compose|1.9.3|
|androidx.lifecycle:lifecycle-runtime-ktx|2.8.7|
|androidx.core:core-ktx|1.15.0|
|org.jetbrains.kotlinx:kotlinx-coroutines-android|1.9.0|
|com.squareup.okhttp3:okhttp|4.12.0|
|org.jetbrains.kotlinx:kotlinx-serialization-json|1.7.3|

构建插件：com.android.application **8.7.2**；org.jetbrains.kotlin.android **2.4.20**；org.jetbrains.kotlin.plugin.compose **2.4.20**。Gradle 分发包为 **8.14.7**。

### 关键间接锁版本

|生态 / 包|锁版本（含独立入口差异）|
|---|---|
|npm / esbuild|0.25.12 / 0.28.2|
|npm / postcss|8.5.28 / 8.5.25|
|npm / ws|8.21.2 / 8.21.1|
|npm / protobufjs|7.6.5|
|npm / whatsapp-rust-bridge|0.5.4|
|crates.io / tauri-utils|2.10.2|
|crates.io / wry|0.57.1|
|crates.io / rustls|0.23.46|
|crates.io / rustls-webpki|0.103.16|
|crates.io / webpki-roots|0.26.11 / 1.0.11|
|crates.io / quinn|0.11.12|
|crates.io / quinn-proto|0.11.19|
|crates.io / quinn-udp|0.5.16|
|crates.io / openssl-src|300.6.1+3.6.3|
|crates.io / openssl-sys|0.9.116|
|crates.io / libsqlite3-sys|0.40.0|
|crates.io / sqlcipher-src|420.0.0+sqlcipher-4.20.0-sqlite-3.54.1-libtomcrypt-1.18.2|
|crates.io / glib|0.18.5|
|crates.io / proc-macro-error|1.0.4|
|crates.io / zbus_names|4.3.4|
|crates.io / zvariant|5.14.0|
|crates.io / zvariant_derive|5.14.0|
|Maven / io.netty:netty-codec-http|4.1.137.Final|
|Maven / com.google.protobuf:protobuf-java|3.25.5|
|Maven / org.bouncycastle:bcprov-jdk18on|1.85|
|Maven / org.apache.commons:commons-compress|1.26.0|
