# BridgeCRM 安全审核报告（2026-11-11）

审核基线：`b532d171a9530c0bd7f34e6e2c2d4e2b0edab963`，审核基线产品版本 `0.1.70`；发布准备版本 `0.1.71`。本报告描述该基线加本轮安全修复后的工作树；没有发布安装包、轮换凭据、删除用户缓存或停止账号连接。此前报告仅作历史参考，本轮重新读取清单、查询公告并运行检查。

## 1. 项目概况和范围

- 桌面：TypeScript、React 18、Vite 6、Tauri 2 / Rust；Windows SQLCipher 数据库和 DPAPI 密钥保护。
- 通信：Baileys Node.js sidecar，发布版由 Bun 编译；FFmpeg 转换本地媒体。
- Android：Kotlin / Java、Jetpack Compose、Gradle、Accessibility 和本地桥接。没有产品浏览器扩展或 NoSQL 服务。
- 包管理：npm workspaces，三份 npm manifest / lock；产品和辅助工程两份 Cargo manifest / lock；Android 两份 Gradle lock、wrapper 和依赖校验元数据。
- 直接声明：npm **31**；产品 Rust **29**；辅助 Rust **9**（含可选和 dev）；Android **11** 个应用 / BOM / debug 声明、3 个构建插件。
- 全锁文件 **1,439** 个不同的生态 / 包名 / 精确版本组合：npm 425、crates.io 720、Maven 294。完整 CSV 为 **2,202** 条带来源记录；包含开发、辅助工程和非 Windows 路径，不等于发布运行依赖数。
- 对 **884** 个源码、配置、测试、脚本和文档文件、**164,664** 行建立逐文件规则检查及哈希清单，随后人工跟踪高风险入口和调用链。路径、行数、哈希与规则命中数见 `source-coverage-2026-11-11.csv`。
- 人工重点：HTTP 鉴权 / 账号隔离、IPC、WebView、外链 / 客户端调用、上传 / 下载、模型解压、SQL、备份恢复、AI 上下文、凭据与日志、Android 导出组件、CI / 发布脚本。**未将规则扫描冒充每行独立人工证明，也未对生产账号实施攻击或反编译全部第三方库。**

## 2. 问题汇总

| 编号 | 类别 | 严重级别 | 位置（修复后） | 状态 |
|---|---|---|---|---|
| D01 | 依赖 | Critical | `desktop/package.json:51`；`package-lock.json:1741`；`desktop/package-lock.json:3789` | 已修复：Vite 6.4.5 → 6.4.6 |
| D02 | 依赖 | High | `.nvmrc:1`；`package.json:34`；项目专用 Node | 已修复：22.23.4 → 22.23.5，系统默认版本保留 |
| D03 | 依赖 | Medium（本项目评级，平台条件） | `desktop/src-tauri/Cargo.lock:3390` | 已修复：rustix 1.1.4 → 1.1.6 |
| D04 | 依赖 | Low | `desktop/package-lock.json:3`、`:26` | 已修复：独立锁补齐版本 / xlsx 声明并更新 Vite |
| C01 | 代码 | Low | `desktop/src-tauri/src/commands.rs:461` | 已修复：拖入文件的实际读取也强制有界 |
| C02 | 代码 | Low | `android/app/src/main/java/com/wapplus/bridge/a11y/WaAssistService.kt:518` | 已修复：不再记录完整电话号码 |
| R01 | 依赖 | Medium | `desktop/src-tauri/Cargo.toml:42`；`Cargo.lock:4000` | 已修复：经授权升级 rusqlite 0.42.0 / SQLCipher 4.20.0 / SQLite 3.54.1 |
| R02 | 代码 | Medium | `desktop/baileys-bridge/index.mjs:720`、`:133`、`:186` | 建议关注：沿用已确认的认证 / 原始缓存加密迁移延期决定 |
| R03 | 依赖 | Low | `desktop/src-tauri/Cargo.toml:46` | 建议关注：sherpa-rs 已弃用，沿用已确认的单独迁移决定 |
| R04 | 依赖 | Medium（Linux 条件） | `desktop/src-tauri/Cargo.lock:1456`；辅助 Cargo lock 的 glib | 建议关注：glib 0.18.5 的未定义行为；当前 Windows 路径不含 GTK |
| R05 | 依赖 | Low | `desktop/src-tauri/Cargo.lock:3024`、`:6083`、`:6204`、`:6219` | 建议关注：停止维护的宏 / Linux D-Bus 依赖 |
| R06 | 依赖 | Medium（生命周期，本项目评级） | `desktop/src-tauri/Cargo.lock:2717`、`:2726` | 建议关注：开发者已选择本轮记录，单独迁移 OpenSSL |

严重性区分公告评级和本项目利用条件。没有确认真实生产密钥泄露；不把测试私钥、PEM 解析标志、协议字典或编码二进制中的偶合字符串当作泄露。

## 3. 已修复问题和利用条件

### D01：Vite 开发服务器代码执行

[上游 GHSA-p4f5-76q4-ffq7](https://github.com/vitejs/vite/security/advisories/GHSA-p4f5-76q4-ffq7) 将 <=6.4.5 列为受影响，6.4.6 为该分支修复版本；公告没有给出 CVE，不另编编号。

恶意请求可污染虚拟模块并触发服务端执行 / 读取文件。公告限定为向网络暴露开发服务器的应用。当前 `desktop/vite.config.ts:5`、`:20` 默认本机监听，但支持 `TAURI_DEV_HOST`；开启网络监听时受影响。打包后的静态前端不运行 Vite 服务，不能据此声称所有已安装客户端均可被远程利用。

- 更新 manifest、根 workspace 和桌面独立锁；本地 `npm ls vite --all` 确认为 6.4.6。
- 初次 npm 更新只变更范围而未替换 workspace 锁中的旧解析，已额外核对并修正；最终锁的 URL / integrity 与官方 npm 6.4.6 元数据、独立锁一致。
- `npm audit` 在修复前没有报告此公告，说明必须交叉核对官方公告。最终 TypeScript / Vite 构建通过。

### D02：Node 运行时安全补丁

[官方 22.23.5 发布说明](https://github.com/nodejs/node/releases/tag/v22.23.5) 于本轮审核日发布，包含 HTTP/2 和 TLS / HTTP 安全修复。项目开发 sidecar 使用 Node，发布 sidecar 使用 Bun，不能用 npm audit 代替运行时审查。

本项目的 sidecar 是带 token 的本机 HTTP/1 服务，没有发现 HTTP/2 服务端或 TLS mTLS 服务端入口；这些 High 公告的完整利用条件并非全部可达。HTTPS 客户端路径存在，但本轮未确认可由远程消息构造到特定 TLS / HTTP 重入条件，实际可利用性**待确认**。为消除旧运行时基线，直接采用兼容安全补丁。

- `.nvmrc`、根 engines / lock 和 README 同步为 22.23.5；CI 已读取 `.nvmrc`，无须再写一个独立版本值。
- 官方便携包下载到忽略目录 `.audit-cache/node-v22.23.5-win-x64`，SHA-256 与同站官方 SHASUMS 一致；未声称额外验证 GPG 签名。
- 使用既有 `tools/project-node.ps1` 运行最终全量检查。没有修改系统 PATH / 默认 Node，符合此前用户选择。
- 旧的在运行进程不会自动换运行时；下次启动应使用项目入口。系统旧 Node 对其他项目的风险不属于本次项目修复完成声明。

### D03：rustix xattr 未初始化内存

[RustSec RUSTSEC-2026-0486](https://rustsec.org/advisories/RUSTSEC-2026-0486.html) / OSV 公告指出：1.x 的 xattr Buffer 在零长度缓冲区时错误标记已初始化字节，可从安全 Rust 触发未定义行为；修复版 1.1.6，0.38 系列不受该 Buffer API 问题影响。该公告是 unsound 信息告警，没有官方 CVSS；表中 Medium 为本项目保守评级。

产品 lock 的 1.1.4 更新为 1.1.6。辅助 lock 已是 1.1.6，无须重复升级。相关 xattr 路径属于 Unix 文件属性处理，当前 Windows 构建不含该利用路径；仍修复所有产品锁定平台的兼容补丁。Cargo 同时重新规范化了若干既有依赖边的版本限定（如 windows-sys / syn），没有批量升级其包版本。最终 OSV 不再返回 rustix 告警，产品库编译和原生测试通过。

### D04：桌面独立锁不完整

独立 `desktop/package-lock.json` 仍写 0.1.69，且根包声明没有同步已使用的官方 CDN xlsx。按现有 manifest 重新生成独立锁，补齐版本 / xlsx 和 Vite 6.4.6。没有删除独立安装入口，其他无漏洞包版本未统一升级。根 / 独立锁中其他合法版本差异仍在完整 CSV 列出。

### C01：拖入文件检查与读取间的大小竞态

此前先取路径 metadata，再调用无界 `std::fs::read(path)`。如果用户选择的文件在两步之间增长或路径被替换，读取可超出 14 / 16 / 24 MiB 的既定限制，导致额外内存消耗。利用需要控制本机被选择文件并配合用户导入，不是远程消息直接任意读文件。

改为打开一次文件句柄，在该句柄上校验 metadata；实际读取 `take(limit + 1)` 后再次检查字节数。保留原来的类型与大小政策、错误提示和内容，不增加新的文件访问范围。新 Rust 集成测试验证普通文件 / 音频 / 视频保留原内容、拒绝超限；同一 harness 的 37 项测试通过。二进制音频 / 视频新入口原已使用有界读取，保持不变。

### C02：Android 联系人号码日志

`openChat` 的信息级日志包含完整联系人号码。读取调试日志或收到日志导出的人可获取该标识；不是 Android 外部应用无权限即可读取全量 logcat。

删除号码插值，保留固定操作名称。不更改联系人、聊天选择或发送行为。Android 独立输入 / 媒体安全检查通过；完整 Gradle 构建受本机 Java 环境问题阻挡，见验证表。

## 4. 需开发者决定的取舍和已确认决定

R01 的跨兼容边界升级已获开发者明确授权并实施。R02 / R03 沿用此前已确认的暂缓决定，R06 按本次答复单独安排迁移；没有取消加密、注销登录或删除数据。

**R06：内嵌 OpenSSL 3.6 已结束维护。** [官方 EOL 公告](https://openssl-library.org/post/2026-11-01-eol34-36/) 确认 2026-11-01 起不再公开提供 3.6 安全修复。本项目 openssl-src 300.6.1+3.6.3 经 SQLCipher 引入；[官方 3.6 公告清单](https://openssl-library.org/news/vulnerabilities-3.6/index.html) 的若干 X.509 / TLS / QUIC / EC 问题已在 3.6.5 修复，而 crates.io 的 300.x 仍止于 3.6.3。当前用途为 SQLCipher AES / HMAC / KDF，未发现 OpenSSL TLS / QUIC / CMS / EC 签名入口，因此未将这些公告直接判为本应用可达 High。OSV crate 查询没有表达这个内嵌 C 库生命周期问题。选项 A：本轮记录风险，单独迁移（建议）；选项 B：升级原生 OpenSSL 主版本并做加密数据库兼容测试。开发者已明确选择 A：本轮记录风险，单独迁移；没有升级 OpenSSL 主版本。

1. **R01：SQLCipher 内含旧 SQLite。** 产品 rusqlite 0.41.1 / libsqlite3-sys 0.39.1 启用 `bundled-sqlcipher-vendored-openssl`，实际 sqlcipher-src 为 `419.0.6+sqlcipher-4.19.0-sqlite-3.53.4-libtomcrypt-1.18.2`。[RustSec RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459.html) 明确说明此特征的 SQLite 3.53.4 仍受 CVE-2026-119375 影响；普通 SQLite 修复基线为 3.54.0。OSV 包版本判定不能覆盖此特征例外。攻击者需要能写入受害程序将打开的数据库及其 sibling WAL；在本项目加密 / 完整性条件下实际构造能力**待确认**。此前用户选择等待上游；**最后复核确认 [rusqlite 0.42.0 今日发布](https://github.com/rusqlite/rusqlite/releases/tag/v0.42.0)**，crates.io 元数据为 libsqlite3-sys ^0.40.0 → sqlcipher-src =420.0.0 → SQLCipher 4.20.0 / SQLite 3.54.1，已出现修复路径。选择 A：本轮跨 0.x 边界升级并验证旧加密库 / WAL / 备份恢复（本轮建议）；选择 B：本轮保留 0.41.1，另行安排升级。开发者已明确选择 A。产品与辅助工程均升级至 rusqlite 0.42.0 / libsqlite3-sys 0.40.0；产品使用 SQLCipher 4.20.0 / SQLite 3.54.1，仍启用原有加密特征。旧 SQLCipher 4.19 合成库、尚未 checkpoint 的 WAL、重新打开及备份副本恢复的回归见 tests/db.rs；没有操作真实业务库。
2. **R02：Baileys 登录及部分原始缓存明文。** `useMultiFileAuthState` 和 media-index / message-index 不受业务库 SQLCipher 或加密 event spool 保护；能读取用户数据目录 / 备份的主体可能获得会话材料和消息资料。是否可独立重放登录还受服务端状态约束，未验证真实账号。选择 A：本轮保留，另做迁移（已选）；选择 B：改为 DPAPI 认证 / 缓存存储，同时验证旧数据迁移、重连、恢复和打包。建议独立安排 B，迁移前不分享该目录，不直接删 auth。
3. **R03：sherpa-rs 0.5.1 已弃用。** [上游仓库](https://github.com/thewh1teagle/sherpa-rs) 已归档并指向官方 sherpa-onnx Rust API。选择 A：当前保留，另做迁移（已选）；选择 B：本轮迁移并完成识别行为、原生库和打包回归。没有确认此弃用本身对应可利用 CVE。

## 5. 其他依赖结论、误报和维护风险

- **R04 glib 0.18.5**：[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)，VariantStrIter 迭代器未定义行为，修复 >=0.20.0。来自 Linux GTK / WebKit，当前 Windows 无该路径；跨 0.x API / ABI 更新不强制覆盖。Linux 发布前需处理且实机验证。
- **R05 停止维护**：proc-macro-error 1.0.4（2024-0370）、zbus_names 4.3.4（2026-0371）、zvariant / zvariant_derive 5.14.0（2026-0370 / 0372）。后面三项主要为 Linux D-Bus 路径；这些是维护告警，不据此编造远程执行漏洞。公告链接和原文保存在本轮 OSV 证据。
- **SheetJS 误报**：锁为官方 CDN xlsx 0.20.3。[CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) 的修复 >=0.19.3、[CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363) 的修复 >=0.20.2。OSV 返回的无上界范围来自 npm 常规发布渠道，不能把 CDN 0.20.3 降回 npm 旧版“修复”。
- React 18 普通客户端渲染不使用 react-server-dom / RSC；不能把 React Server Components 的 Critical 公告直接套到本项目。@vitejs/plugin-react 也不等于 @vitejs/plugin-rsc。
- tauri-plugin-shell 2.3.5 高于 [open 协议校验漏洞](https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp) 修复版 2.2.1；Drizzle 0.45.3 高于 [标识符注入](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9) 修复版 0.45.2。
- Bun 1.4.4 已包含 [Brotli 修复](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p) 和 [HTTP/3 QPACK 修复](https://github.com/oven-sh/bun/security/advisories/GHSA-cf8x-9m69-3gg3)；本轮重新编译 sidecar，未将 Node 补丁等同于 Bun 补丁。
- FFmpeg 9.0.2 的包和二进制 SHA-256 在构建入口校验；转换限制 `file,pipe` 协议。旧报告提到的 SFTP 主机密钥问题在当前调用路径不可达；本轮不声称 FFmpeg 所有解码器已经过独立模糊测试。[官方版本说明](https://ffmpeg.org/download.html)
- Gradle wrapper 8.14.6 已达到三项高风险 daemon / 仓库安全公告的修复版本，保留 wrapper hash 和严格依赖校验。[官方发布说明](https://docs.gradle.org/8.14.6/release-notes.html)
- lucide-react 0.468.0、部分 AndroidX / Compose 声明显著陈旧；没有确认这些精确版本的新漏洞或包名仿冒，不以版本老直接判 High。维护检查也确认废弃的 @esbuild-kit/esm-loader / core-utils 为 drizzle-kit 的间接工具路径，迁移上游工具时再替换。
- 本机 Android JDK 21.0.10.7 不是近期 21.x 安全基线；21.0.13+10 的参考基线见 [JDK 发布说明](https://www.oracle.com/java/technologies/javase/21-0-13-relnotes.html)。Microsoft 发行版的对应可用补丁及当前调用条件**待确认**，本轮未替换系统 JDK / 改用不同授权条款的发行版。
- 未确认恶意仿冒依赖；Baileys 来源为 WhiskeySockets 的 `baileys 7.0.0-rc14`，不是名称近似的恶意 fork。RC 仍有兼容和稳定性风险。完整逐名称 WebSearch、锁元组 OSV 和 npm registry 维护信息均保留为本地证据。

## 6. 代码边界检查结果

| 检查面 | 跟踪的边界与结论 |
|---|---|
| SQL / NoSQL / 模板 | SQLite 查询值参数绑定；动态列 / 表来自内部集合。未确认外部文本到 SQL 标识符 / shell / 动态模板执行的未校验路径；无产品 NoSQL 服务 |
| 动态执行与进程 | 子进程参数数组，用户手机号 / App ID 白名单；Muse eval 参数 JSON 序列化，driver 来源为编译内置。缓存 V8 deserialize 为旧本机缓存兼容，不将它解释为任意 JS 代码执行 |
| 鉴权 / CSRF / CORS / 越权 | sidecar 绑定 127.0.0.1；来源白名单、token、账号 / 登录号码校验在路由前，新增二进制上传也经过该边界。CORS 不代替 token；修改类路由需要认证 |
| SSRF / TLS / 重定向 | remoteMedia 拒绝非公共地址 / 非 HTTPS / 用户名密码 / 非标准端口，DNS 解析后固定连接地址，每跳重验，按流限制；未关闭证书校验。自定义 AI endpoint 是用户配置能力，不将它误报为无需权限 SSRF |
| XSS / WebView / IPC | React 文本渲染；无产品 dangerouslySetInnerHTML 入口；主窗口 capability 与远端 Muse 窗口分离；每次 driver 执行校验 Muse 精确 HTTPS origin，driver 内也检查来源和客户归属 |
| 外链 / 本地客户端 | clone_calls 对手机号、受支持 App ID、账号绑定 / 核对、固定 WhatsApp voice 链接域名和路径校验；未发现任意链接选择本地可执行文件的路径 |
| 上传 / 文件 / 解压 | token 后接收有界 JSON 或二进制；临时文件名固定、声明与实际大小匹配、异常清理。模型 tar 拒绝父路径 / 绝对路径 / 链接 / 特殊文件并限制总量与数量；分阶段替换。C01 补齐旧拖入入口 |
| 加密 / 静态数据 | SQLCipher + DPAPI；事件 spool 随机 IV 的 AES-GCM；OAuth / Vertex / Muse 线程存储使用现有保护。R01 已升级修复；R02 仍单独保留，不能因为主库加密就宣称全部数据加密 |
| 日志 / 错误 | 服务错误日志避免 SDK 原始 payload；C02 去除号码。调试同步日志、历史备份仍应按敏感数据处理。HTTP 错误只对带 token 的本机调用者返回，未确认匿名远程敏感信息泄露 |
| OAuth / 备份 / 导出 | PKCE、state、有界 loopback 回调、固定 OAuth 服务端；备份使用字段白名单 / 大小限制 / DPAPI / 完整性校验；CSV 转义公式前缀；恢复边界与账号隔离测试通过 |
| AI 自动行为 | 生成 / 排队 / 发送时检查当前账号、客户和上下文；客户文字作为历史数据，模型草稿不等于已发送消息；Playbook 切换有上下文失效检查。模型遵从性不等于形式化安全边界；未让模型取得本机任意执行接口 |
| Android | loopback ServerSocket、token、TTL、输入 / worker 上限；FileProvider 不公开、URI 授权和媒体来源校验；Accessibility 由系统权限保护；allowBackup=false。明文本地桥接不等于公网监听 |
| CI/CD | 未发现 pull_request_target；第三方 Action 固定提交 SHA；CI 默认 contents:read，发布才有写权限；签名 secret 环境变量不进入 VITE_ 前缀，updater 签名校验保留 |
| 浏览器扩展 | 无产品扩展 manifest，扩展 permissions / host_permissions / 消息来源项不适用 |

## 7. 密钥和 Git 检查

- 主工作树扫描 **36,950** 个文件 / **2,041,614,697** 字节，含源码、测试、配置、注释、文档、前端 / sidecar / FFmpeg 构建产物及本地临时副本。排除 `.git`、node_modules、target、Gradle / 审核缓存、指定图片 / 模型 / 归档等，不能声称解包扫描所有第三方模型与 archive。
- 报告 / 审核缓存文本补扫 **3,660** 个文件 / **166,984,544** 字节；排除便携 Node / Perl 的第三方分发内容和 WebView profile。候选仅为已知拒绝测试 / 审核脚本副本中的 `user:pass` URL。
- 本地可达历史 **184** 个提交 / **4,024** 个 blob，`skippedBlobs: []`。不包括不可达对象、远端已删历史或未连接的其他仓库。历史候选 7 处，为拒绝 URL、PEM 解析头和明确的测试 RSA key。
- 二进制候选专门追到依赖源码：AWS 外形字符串位于 `baileys/lib/WABinary/constants.js:600` 协议字典；Google 外形字符串位于 `whatsapp-rust-bridge/dist/index.js:1967` 的长编码块内部；FFmpeg 的 `sk-...` 为 OpenSSH 算法名，私钥头为解析标志、无后随 PEM 正文。没有打印候选值或将其上传到搜索服务。
- 额外赋值规则检查的命中为运行时 Authorization 插值和明确的测试占位值。`vertex-test-only-key.txt` 仅供 RSA 签名测试，禁止用于任何真实服务。
- Git 跟踪的 env 文件仅 `.env.example`，内容为变量名 / 空值。`git check-ignore` 确认根 / desktop 的 `.env`、环境变体和 `client_secret*.json` 有效忽略；未发现需要新增环境变量替代的真实硬编码凭据，因此不伪造一轮密钥迁移。
- **未确认真实生产 API Key、Token、密码、私钥或 webhook 泄露。若任何真实值曾提交或泄露，必须到对应平台撤销并重新生成；删代码、加 ignore 或清缓存都不够。** 本轮没有授权或实施轮换。

## 8. 验证结果

| 检查 | 结果 |
|---|---|
| 最终项目入口 `tools/project-node.ps1 run check` | 通过：1,469 项 JS 测试，1,468 通过、1 跳过、0 失败；TypeScript / Vite 6.4.6 生产构建、Bun sidecar 编译、bridge smoke 均通过 |
| 产品 `cargo test --locked --lib --tests --no-run` | 升级后通过；编译全部原生库和 10 个集成测试，保留既有未使用函数和链接警告 |
| 新拖入文件 Rust harness | 37 项通过，已包含于下面全部原生测试计数 |
| 全部 10 个 Rust 集成 harness | 刚编译的测试二进制逐一执行，检查编译时间晚于本轮源码：164 通过、8 ignored、0 失败 |
| Rust 库单元测试 | 刚编译的库测试二进制执行：101 通过、8 ignored、0 失败；合计原生 265 通过、16 ignored |
| 辅助 native-compatibility | 30 项通过；普通 bundled SQLite 3.54.1 |
| Android 独立 javac / java | BoundedInputCheck、MediaSharePolicyCheck 通过 |
| Android 完整 Gradle | 未完成：三次尝试（含 no-daemon / IPv4）在 Java PipeImpl UnixDomainSockets 连接报 `Invalid argument: connect / Unable to establish loopback connection`；未关闭防火墙或依赖校验 |
| npm audit | 根 workspace、desktop 和 sidecar 独立入口均 0 vulnerabilities |
| OSV 全锁复扫 | 完成 1,439 元组；保留 xlsx 误报、glib / 停止维护告警；SQLCipher 特征例外已按内嵌 SQLite 3.54.1 人工核对修复，rustix 告警消除 |
| 审核工具 | dependency audit Node 小测通过；未安装 cargo-audit、osv-scanner、gitleaks、semgrep，未声称运行这些工具 |
| `git diff --check` | 通过 |

升级前一次完整测试曾因正在运行的 `wap-plus-crm.exe` 无法替换而失败。最终升级后使用 `cargo test --locked --lib --tests --no-run` 编译成功，再运行同批新测试 exe；数据库 fixture 更新后又单独 `cargo test --locked --test db`，32 项全部通过。旧版 SQLCipher 4.19 库和仅在 WAL 中的第二行均成功读取，写入新行、重开、复制恢复通过；缺失 / 错误密钥仍保留原库。16 个 ignored 为原有真实客户端 / 交互诊断测试，没有跳过新失败。

根 `npm ci` 同样遇到正在使用的 esbuild 文件锁；已通过根 lock 恢复依赖，核实 Vite 实际版本，再重新完成最终全量检查。既有开发进程占用的旧临时 CLI 文件未强制删除。没有停止账号连接以获取绿色检查。

## 9. 剩余风险和后续建议

1. R01 SQLCipher 已按授权升级；R02 Baileys 加密、R03 sherpa-rs 和 R06 OpenSSL 按开发者选择另开迁移。分别以登录重连、语音、加密库和安装包验证为完成条件。
2. Linux 发布前处理 GTK / D-Bus 依赖；Windows 验证不能覆盖 Linux ABI。
3. Android 构建需修复本机 JDK 回环环境并使用受维护的 JDK 21 安全补丁；独立 Java 小测不能替代完整 APK 构建和真机测试。
4. 修复尚未发布到安装包，已运行的 Vite / Node / 桌面进程也不会自动加载新依赖。重新启动 / 重新构建后才获得补丁；审核阶段未执行 push 或创建 Release；后续发布状态以 GitHub 版本页为准。
5. DPAPI 不能防止同一 Windows 用户已经被控制；不要把账号认证目录、诊断捕获或备份当作普通公开文件。外部聊天 / Playbook 的模型指令遵从仍需持续观察。
6. 这次审核覆盖源码和已知公告，不构成“无未知漏洞”保证；未做真实账号接管、生产渗透、Android 真机攻击或第三方原生解码器模糊测试。

## 本地证据

- `dependencies-2026-11-11.csv`：三生态全部锁版本及来源；`source-coverage-2026-11-11.csv`：逐文件规则覆盖与哈希。
- `dependency-inventory.json`、`osv-audit.json`、`secret-scan.json`、`secret-history-scan.json`：重用的结构化审计输出，按仓库规则不提交。
- `.audit-cache/web-dependencies-20261111.json`：逐直接依赖检索名称与公告链接；无搜索结果不等于无漏洞，与 OSV / 官方资料共同判断。
- `.audit-cache/dependency-audit-final-20261111.log`、`npm-audit-*-20261111.json`、`secret-supplement-20261111.json`、`binary-secret-origins-20261111.json`：脱敏扫描 / 交叉核对证据。
- `.audit-cache/security-full-check-final-20261111.log`、`security-rust-executables-20261111.log`、`security-rust-libtests-20261111.log`、`security-rust-check-20261111.log`、`security-native-compat-20261111.log`、`security-android-stack-20261111.log`：验证记录。

## 附录：全部直接依赖与关键间接版本

完整锁定元组和来源见 `dependencies-2026-11-11.csv`；版本以根 workspace / Cargo 产品锁为准，独立入口的差异也保留在 CSV。

### npm（31 个声明）

| 清单 / 用途 | 名称 | 实际版本 |
|---|---|---|
| desktop/package.json / dependencies | @tauri-apps/api | 2.11.1 |
| desktop/package.json / dependencies | @tauri-apps/plugin-notification | 2.3.3 |
| desktop/package.json / dependencies | @tauri-apps/plugin-shell | 2.3.5 |
| desktop/package.json / dependencies | @tauri-apps/plugin-updater | 2.11.0 |
| desktop/package.json / dependencies | clsx | 2.1.1 |
| desktop/package.json / dependencies | countries-and-timezones | 3.11.0 |
| desktop/package.json / dependencies | drizzle-orm | 0.45.3 |
| desktop/package.json / dependencies | emoji-picker-react | 4.18.0 |
| desktop/package.json / dependencies | franc-min | 6.2.0 |
| desktop/package.json / dependencies | libphonenumber-js | 1.13.15 |
| desktop/package.json / dependencies | lucide-react | 0.468.0 |
| desktop/package.json / dependencies | react | 18.3.1 |
| desktop/package.json / dependencies | react-dom | 18.3.1 |
| desktop/package.json / dependencies | react-virtuoso | 4.18.11 |
| desktop/package.json / dependencies | tailwind-merge | 2.6.1 |
| desktop/package.json / dependencies | xlsx | 0.20.3 |
| desktop/package.json / dependencies | zustand | 5.0.14 |
| desktop/package.json / devDependencies | @tauri-apps/cli | 2.12.2 |
| desktop/package.json / devDependencies | @types/react | 18.3.31 |
| desktop/package.json / devDependencies | @types/react-dom | 18.3.7 |
| desktop/package.json / devDependencies | @vitejs/plugin-react | 4.7.0 |
| desktop/package.json / devDependencies | autoprefixer | 10.5.4 |
| desktop/package.json / devDependencies | drizzle-kit | 0.31.11 |
| desktop/package.json / devDependencies | postcss | 8.5.28 |
| desktop/package.json / devDependencies | tailwindcss | 3.4.19 |
| desktop/package.json / devDependencies | typescript | 5.9.3 |
| desktop/package.json / devDependencies | vite | 6.4.6 |
| desktop/baileys-bridge/package.json / dependencies | baileys | 7.0.0-rc14 |
| desktop/baileys-bridge/package.json / dependencies | pino | 10.3.1 |
| desktop/baileys-bridge/package.json / dependencies | qrcode | 1.5.4 |
| desktop/baileys-bridge/package.json / devDependencies | bun | 1.4.4 |

### desktop/src-tauri/Cargo.toml（29 个声明）

| 名称 | 直接解析版本 | 声明范围 |
|---|---|---|
| tauri-build | 2.7.4 | [build-dependencies] |
| base64 | 0.22.1 | [dependencies] |
| reqwest | 0.13.4 | [dependencies] |
| futures-util | 0.3.33 | [dependencies] |
| sha2 | 0.10.9 | [dependencies] |
| ring | 0.17.14 | [dependencies] |
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
| thiserror | 2.0.21 | [dependencies] |
| tracing | 0.1.44 | [dependencies] |
| tracing-subscriber | 0.3.23 | [dependencies] |
| rusqlite | 0.42.0 | [dependencies] |
| tar | 0.4.46 | [dependencies] |
| bzip2 | 0.4.4 | [dependencies] |
| sherpa-rs | 0.5.1 | [dependencies] |
| tauri-winrt-notification | 0.7.3 | [target.'cfg(windows)'.dependencies] |
| windows-registry | 0.6.1 | [target.'cfg(windows)'.dependencies] |
| windows | 0.61.3 | [target.'cfg(windows)'.dependencies] |
| windows-sys | 0.61.2 | [target.'cfg(windows)'.dependencies] |

### docs/security/native-compatibility/Cargo.toml（9 个声明）

| 名称 | 直接解析版本 | 声明范围 |
|---|---|---|
| rusqlite | 0.42.0 | [dependencies] |
| serde | 1.0.229 | [dependencies] |
| serde_json | 1.0.151 | [dependencies] |
| tauri | 2.12.5 | [dependencies] |
| chrono | 0.4.45 | [dependencies] |
| tracing | 0.1.44 | [dependencies] |
| sherpa-onnx | 2.0.1 | [dependencies] |
| bzip2 | 0.4.4 | [dev-dependencies] |
| uuid | 1.29.0 | [dev-dependencies] |

### Android（清单与锁文件未变）

| 直接声明 | 实际版本 |
|---|---|
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
| Android Gradle Plugin | 8.7.2 |
| Kotlin Android plugin | 2.4.20 |
| Kotlin Compose plugin | 2.4.20 |
| Gradle wrapper | 8.14.6（固定 SHA-256） |

### 关键间接依赖补充（本轮重读全部锁）

| 生态 | 名称 | 版本集合 |
|---|---|---|
| crates.io | rustix | 0.38.44, 1.1.6 |
| crates.io | libsqlite3-sys | 0.40.0 |
| crates.io | sqlcipher-src | 420.0.0+sqlcipher-4.20.0-sqlite-3.54.1-libtomcrypt-1.18.2 |
| crates.io | openssl-sys | 0.9.116 |
| crates.io | openssl-src | 300.6.1+3.6.3 |
| crates.io | rustls | 0.23.46 |
| crates.io | tokio | 1.54.1 |
| crates.io | sherpa-rs-sys | 0.5.1 |
| crates.io | sherpa-onnx-sys | 2.0.1 |
| crates.io | glib | 0.18.5 |
| crates.io | zbus | 5.19.0 |
| crates.io | zbus_names | 4.3.4 |
| crates.io | zvariant | 5.14.0 |
| crates.io | zvariant_derive | 5.14.0 |
| crates.io | proc-macro-error | 1.0.4 |
| crates.io | zip | 9.1.3, 9.2.2 |
| npm | esbuild | 0.25.12, 0.28.2 |
| npm | rollup | 4.64.0, 4.62.3 |
| npm | ws | 8.21.2, 8.21.1 |
| npm | postcss | 8.5.28, 8.5.25 |
| npm | vite | 6.4.6 |
