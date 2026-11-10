# BridgeCRM 安全审核报告（2026-11-09）

审核基线：`d220518`，版本 `0.1.68`，包含审核开始时已有的大量未提交修改及本轮修复。没有重置工作树、发布版本、轮换密钥或修改系统默认 Node。本文取代旧报告对**当前工作树**的结论，历史报告保留。

## 1. 项目概况与审核范围

- 桌面：TypeScript / React 18 / Vite 6；Tauri 2 / Rust；Windows 数据库为 SQLCipher，密钥由用户绑定 DPAPI 保护。
- WhatsApp：Node.js / Baileys sidecar；发布时通过 Bun 编译；FFmpeg 处理本地媒体。
- Android：Kotlin / Java、Jetpack Compose、Gradle；本机桥接与 Accessibility 服务。Python 审核工具仅使用标准库。
- 清单：根 workspace、desktop、baileys-bridge 三份 npm manifest / lock；产品与 native-compatibility 两份 Cargo manifest / lock；Android 应用与 buildscript Gradle 锁、依赖校验元数据；CI 和原生资源准备脚本。
- 直接依赖声明：npm **31**（desktop runtime 17、desktop dev 10、sidecar 4）；产品 Rust **29**（含构建和 Windows 专用依赖）；辅助 Rust 工程 7 个普通声明（含可选 speech）与 2 个 dev 声明；Android 11 个应用 / BOM / debug 声明及 3 个构建插件。
- 最终全锁文件盘点为 **1,443** 个不同的生态 / 包名 / 精确版本组合：npm 425、crates.io 724、Maven 294。包括开发、辅助工程和非 Windows 依赖，不等同于发布包运行依赖数量。
- 源码规则覆盖清单含 **829** 个文件、150,952 行，涵盖产品、测试、脚本、配置和 CI；完整 lock CSV 为 2,203 条带来源记录，去重后对应上述 1,443 个元组。
- 全文件规则检查后，人工跟踪高风险入口、调用者和数据流：HTTP / IPC / WebView、数据库、媒体下载与上传、模型解压、备份、OAuth、凭据保存、日志及 CI。附录提供源码覆盖清单。**未对每一个文件逐行进行独立人工证明**，也未反编译所有第三方原生二进制；不将自动扫描等同于完整人工渗透测试。

## 2. 问题汇总

| 编号 | 类别 | 严重级别 | 位置（当前文件:行） | 状态 |
|---|---|---|---|---|
| D01 | 依赖 | High | `package.json:34`；`tools/project-node.ps1:1`；本机 Node 22.23.2 | **已修复项目入口**：安装并校验项目专用 22.23.4；系统默认版本按用户要求保留 |
| C01 | 代码 | Medium | `desktop/src-tauri/src/muse_web.rs:290` | **已修复**：Muse 会话路径、归属和交接摘要使用 Windows DPAPI 加密；旧文件读取时迁移 |
| C02 | 代码 | Medium | `desktop/src-tauri/src/muse_web_driver.js:132` | **已修复**：媒体按流计数，超限中止，防止响应体先被无限缓存 |
| C03 | 代码 | Low | `android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt:237` | **已修复**：ACK 日志不再输出完整 payload |
| K01 | 密钥防护 | Low | `.gitignore:114`；`.env.example:10` | **已修复**：补齐所有 `client_secret*.json` 忽略模式及空值环境变量示例；未确认真实密钥泄露 |
| D02 | 依赖 | Medium | `docs/security/native-compatibility/Cargo.toml:8` | **已修复**：辅助工程 rusqlite 0.40.2 → 0.41.1 / libsqlite3-sys 0.39.1，普通 bundled SQLite 3.54.1 |
| D03 | 依赖 | Medium | `desktop/src-tauri/Cargo.toml:42`；`desktop/src-tauri/Cargo.lock:4010` | **待开发者决定（已选择保留）**：加密构建内含 SQLite 3.53.4，等待兼容上游修复 |
| C04 | 代码 / 凭据存储 | Medium | `desktop/baileys-bridge/index.mjs:708`；同文件 `:132`、`:186` | **待开发者决定（已选择保留）**：Baileys 认证和部分原始缓存仍明文；另做加密迁移 |
| D04 | 依赖 | Medium（平台条件） | `desktop/src-tauri/Cargo.lock:1456`；辅助 lock 的 glib 0.18.5 | **建议关注**：Linux GTK 路径存在 VariantStrIter 未定义行为；Windows 构建不含该路径 |
| D05 | 依赖维护 | Low | `desktop/src-tauri/Cargo.toml:46` | **待开发者决定（已选择保留）**：sherpa-rs 0.5.1 上游弃用；单独迁移官方 API |
| D06 | 依赖维护 | Low | `desktop/src-tauri/Cargo.lock:6094`、`:6215`、`:6230`、`:3033`；`docs/security/native-compatibility/Cargo.lock:2626` | **建议关注**：停止维护提示，主要为 Linux / 辅助路径；不是确认的远程执行漏洞 |
| D07 | 依赖可重复性 | Low | `package-lock.json:3403`；`desktop/package-lock.json:1254`（示例） | **建议关注**：三份独立锁与根 workspace 部分版本不同，均已纳入扫描 |

没有确认新的 Critical 问题。D01 是开发运行时的 High 风险；不能用 npm audit 的零结果代替 Node 自身漏洞检查。严重性按当前利用条件评估，维护告警不冒充已知 CVE。

## 3. 已修复问题、利用条件和具体改动

### D01：项目使用带安全修复的 Node

官方 22.23.4 安全发布修复了 TLS / DNS 校验和 Brotli 等 High 问题；开发 sidecar 实际调用 Node，存在处理远程服务数据的路径。具体 CVE 的完整利用链依赖攻击者控制的输入及网络条件，本轮未构造攻击真实账号。[Node 官方发布说明](https://nodejs.org/en/blog/release/v22.23.4)

- 官方 Windows x64 便携压缩包放入 `.audit-cache`，其 SHA-256 与官方 SHASUMS 核对一致；未改系统安装。
- `tools/project-node.ps1` 检查 `.nvmrc` 格式与实际运行版本，仅给当前 npm 命令及其子进程设置 PATH，执行后恢复；开发 sidecar 随父进程继承该版本。
- 根 `engines.node` 与根 lock 同步到 `>=22.23.4`，更新两份 README。原有 `.nvmrc` 和 CI 已为 22.23.4。
- 最终检查由该入口运行。系统 `node --version` 仍为 22.23.2，已运行的旧进程不会自动升级。开发应从新入口重新启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/project-node.ps1 run tauri -- dev
```

`ExecutionPolicy Bypass` 仅限该进程，不修改持久策略。便携运行时被 Git 忽略，其他机器需使用 `.nvmrc` 或放置同版本官方包；不会把已安装的本机工具链提交进源码。

### C01：Muse 会话明文记录

此前客户交接摘要、会话路径和归属信息在独立 JSON 文件明文保存。能读取用户目录、备份副本或误共享文件的主体可获取这些信息，不需要数据库密钥。

`load_thread` / `save_thread` 复用现有 DPAPI 与原子写入，实现带格式标记的用户绑定密文；读取旧明文后校验结构再迁移。解密或校验失败返回错误，不覆盖损坏文件。新增测试验证旧格式迁移、摘要不以明文出现、往返读取和篡改失败；Rust integration test 引入实际 DPAPI 模块。

限制：迁移发生在旧记录被读取时；尚未访问的旧文件、历史备份和此前导出的副本不会自动改写。此加密保护 Windows 静态文件，不能抵御已控制同一登录用户的恶意进程。非 Windows 分支未增加新的加密后端。

### C02：Muse 媒体响应在限制前完整缓存

此前先调用 `response.blob()` 再检查大小；被控制或异常的媒体响应可以在拒绝前耗尽内存。利用需要 Muse 页面选择到该媒体资源，并由攻击者控制响应体或资源大小，不是任意网站直接调用本机 IPC。

改为提前检查 Content-Length，并按实际解码后的流字节累计：图片 8 MiB、视频 16 MiB，超限取消 reader；finally 释放锁。不信任缺失或虚假的响应长度，保留格式、跳转和业务边界校验。测试覆盖超大声明、无长度与虚假小长度的连续流，验证停止读取；现有 Muse / 图片生成测试也通过。

### C03、K01：日志和 OAuth 文件误提交防护

- Android ACK 分支由输出整个 payload 改为固定文字，避免本机诊断日志保留客户消息 / 标识等响应字段。利用前提是可读该日志的调试主体或日志被分享；没有更改协议。
- `.gitignore` 增加 `**/client_secret*.json`，覆盖 build.rs 接受的 Google OAuth 本地配置命名；`.env.example` 增加空值 `WAP_GOOGLE_CLIENT_PATH`、`WAP_REQUIRE_GOOGLE_CLIENT`。OAuth 配置原已支持文件 / 环境配置，不重复新增秘密管理实现。
- `SECURITY.md` 更新为实际 SQLCipher / DPAPI 行为，并明确仍为明文的 Baileys 认证 / 缓存。没有把 OAuth 客户端标识或 updater 公钥当作应吊销的私钥。

### D02：辅助兼容工程的普通 SQLite

RUSTSEC-2026-0459 / CVE-2026-119375：打开攻击者能写入的数据库及相邻 WAL，页大小不一致时可能返回未初始化页缓存。普通 bundled SQLite 的修复基线是 3.54.0 / libsqlite3-sys 0.39.0。辅助工程更新到与产品已使用 API 相同的 rusqlite 0.41.1、普通 SQLite 3.54.1；锁文件仅更新这两个 crate，不连带降级其他包。[RustSec 原始公告](https://github.com/RustSec/advisory-db/blob/main/crates/libsqlite3-sys/RUSTSEC-2026-0459.md)

辅助工程只测内存数据库；补齐与实际 db.rs 对接的 db_encryption 测试边界，磁盘 open / open_readonly 明确报错，防止兼容测试意外打开真实加密业务库。30 个既有测试通过。这不表示产品 SQLCipher 的 D03 已修复。

## 4. 需取舍及已确认的处理方案

### D03：SQLCipher 使用旧 SQLite，版本扫描存在特征盲区

产品已锁定 rusqlite 0.41.1 / libsqlite3-sys 0.39.1，但启用 `bundled-sqlcipher-vendored-openssl`，实际依赖 `sqlcipher-src 419.0.6+sqlcipher-4.19.0-sqlite-3.53.4-libtomcrypt-1.18.2`。源码版本宏与 lock 一致。

RustSec 公告明确说明：0.39.0 / 0.39.1 的 SQLCipher 特征仍内置受影响的 SQLite 3.53.4；OSV 的包版本范围会把 0.39.1 视作已修复，不能据此放行加密构建。利用需受害程序打开不可信主体能写入的数据库 / WAL；当前应用使用本机加密业务库。**在实际密钥、WAL 加密与完整性校验条件下能否构造成功利用，待确认**，不能说已通过远程消息直接利用。

选项：等待上游兼容 SQLCipher 更新（建议）；或自维护加密依赖补丁并承担升级与数据兼容验证；关闭加密不能作为本轮安全修复。**开发者已选择保留加密、记录风险、等待上游修复。** 不导入来源不明的数据库 / WAL，保留现有目录访问保护；上游更新后须核对原生 SQLite 基线并测试旧库、WAL、备份及恢复。

### C04：Baileys 认证与原始缓存仍明文

`useMultiFileAuthState(authDir)` 保存登录凭据和会话密钥；media-index / message-index 还保留原始消息资料。SQLCipher、DPAPI 配置保护与加密事件 spool 不覆盖这些文件。拥有相应用户目录 / 备份读取权限的人可能获得会话材料及消息信息；是否足以独立重放登录还受 WhatsApp 服务端状态约束，未对真实账号验证。

选项：本轮保留并单独迁移（建议）；或本轮替换为 Windows DPAPI 认证 / 缓存存储并验证旧数据迁移、登录、重连、恢复和打包。**开发者已选择本轮保留，另做加密迁移。** 不把该目录当普通日志共享；限制备份范围和本机账户权限。不得直接删除 auth 文件来“修复”，那会改变登录状态并损失会话资料。

### D04–D06：平台与停止维护依赖

- glib 0.18.5 的 `VariantStrIter` 存在未定义行为，修复版本 >=0.20.0；路径为 Tauri 的 Linux GTK / WebKit，当前 Windows 图不包含它。升级跨越 0.x 不兼容边界，不能通过强制 Cargo 覆盖假定 ABI 兼容。Linux 发布前需完成 Tauri / GTK 升级与实际 Linux 验证。[glib 公告](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- sherpa-rs 0.5.1 上游明确弃用，推荐官方 Rust API；属于直接依赖、涉及语音原生资源与 API 迁移。**开发者已选择本轮保留，另做迁移**；无证据把“弃用”写成可利用 CVE。[上游说明](https://github.com/thewh1teagle/sherpa-rs)
- zbus_names 4.3.4（RUSTSEC-2026-0371）、zvariant 5.14.0（0370）、zvariant_derive 5.14.0（0372）是 Linux D-Bus 相关停止维护提示。proc-macro-error 1.0.4（RUSTSEC-2024-0370）为宏构建路径，产品 / 辅助 lock 均保留；自动去重结果只显示其中一个文件，不意味着另一份 lock 没有它。[RustSec 数据库](https://rustsec.org/advisories/)
- lucide-react 锁定 0.468.0，发布于 2024-12，明显落后上游 1.x；项目仍活跃，未确认该版本 CVE或明确停止安全维护，升级需要图标 API / UI 验证，列为版本陈旧关注项。
- Vite 6.4 仍在安全回补范围；tailwind-merge 2.x 属于上游最近两个主版本。不能仅因主版本较旧判定停止维护。[Vite 支持政策](https://vite.dev/releases) · [tailwind-merge 支持政策](https://github.com/dcastil/tailwind-merge/security)

### D07：独立 lock 的安装入口差异

例如根 / desktop 独立 lock 的 API 为 2.11.1 / 2.12.1、updater JS 为 2.11.0 / 2.13.1、PostCSS 为 8.5.28 / 8.5.25。都满足现有 manifest，且已逐版本查询。若保留独立安装入口，应分别在 CI 验证；若仅支持根 workspace，可另行确认后移除重复 lock。本轮没有删除安装入口或批量升级无漏洞依赖。

## 5. 依赖扫描、误报与原生资源

- 对全部直接依赖名称进行了 WebSearch，交叉参考 GitHub Advisory / RustSec / OSV / 官方公告和维护政策；对所有锁定元组调用 OSV querybatch，并读取返回公告全文。查询原始记录与 JSON 证据见下文。
- 本机有 npm audit，最终根 workspace 结果为 **0 vulnerabilities**。cargo-audit、osv-scanner、gitleaks、semgrep 未安装；没有声称运行过它们，也没有为审核安装新的全局工具。
- 最终 OSV 返回 6 个唯一包 / 8 条记录：xlsx 两条、glib 两个别名、四个停止维护包。glib 的 GHSA / RustSec 是同一问题；D03 是人工检查特征发现的额外保留项。
- xlsx 0.20.3 来自 SheetJS 官方 CDN，CVE-2023-30533 已在 >=0.19.3 修复，CVE-2024-22363 已在 >=0.20.2 修复；npm 公告没有常规 registry 修复版本，造成对 CDN 0.20.3 的误报。保留当前安全来源及版本，不换成 npm 旧版。[SheetJS 30533 公告](https://cdn.sheetjs.com/advisories/CVE-2023-30533) · [SheetJS 22363 公告](https://cdn.sheetjs.com/advisories/CVE-2024-22363)
- Bun 1.4.4 达到 GHSA-663w-cv8g-jj2p 的修复基线；本轮已用它重新编译 sidecar。此前发布的旧二进制不会因仓库 lock 改变而自动更新。[Bun 公告](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p)
- FFmpeg 9.0.2 固定 SHA-256；GHSA-vv62-hhh4-f6vv / CVE-2026-107675 涉及 SFTP 主机密钥验证，当前所有产品转换入口设置 `-protocol_whitelist file,pipe`，未发现 SFTP 路径，故该公告在当前调用路径不可达。第三方构建是否编入 libssh 未另行反编译确认；未来开放网络协议前必须重评估。公告未列出可直接使用的修复版本，不编造版本。[GitHub 公告](https://github.com/advisories/GHSA-vv62-hhh4-f6vv)
- plugin-shell 2.3.5 高于相关 open scope 漏洞修复版 2.2.1；Drizzle 0.45.3 高于标识符注入修复版 0.45.2。原有 updater `requireSignedVersion: true`、CLI 2.12.2、Rust updater 2.14.1 保留。[Shell 公告](https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp) · [Drizzle 公告](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9)
- 包名与 manifest 来源核对未确认仿冒包；安装的是 WhiskeySockets 的 `baileys 7.0.0-rc14`，不是公告中的近似拼写恶意分支。它仍是 RC，存在上游兼容与稳定性风险。

## 6. 代码边界检查

| 检查面 | 已核对的控制与结论 |
|---|---|
| SQL / NoSQL、动态执行 | SQLite 值参数绑定；动态表名来自内部固定集合。未发现把消息或外部参数拼入 shell / eval / new Function 的可利用路径。没有产品 NoSQL 服务 |
| HTTP / CORS / CSRF / 鉴权 | sidecar 绑定 loopback，明确来源列表、token 与账号校验；请求大小与上传流有界。未把 CORS 当身份鉴别，仍要求 token |
| SSRF / TLS / 跳转 | 远程媒体限制公共地址、DNS 绑定及每跳重验；媒体 CDN 路径另有限制。保留 TLS 证书校验。自定义 AI 服务地址是用户配置能力，未确认无需权限的 SSRF 路径 |
| XSS / WebView / IPC | React 文本转义；Muse 精确 HTTPS origin 校验、注入参数序列化、远端窗口无主窗口 capability。自动化脚本执行为产品必要能力；不认定所有 eval 调用都接受攻击者代码 |
| 文件 / 归档 / 备份 | 模型解压拒绝绝对路径、父目录与链接，限制展开体积和文件数；分阶段验证 / 原子替换。图片库按 ID、类型、大小和 canonical 路径校验；导出 / 恢复有字段白名单 |
| 不安全反序列化 | 原始缓存含本机受限 V8 deserialize 兼容路径，不执行任意 JS；上限与缓存信任前提需保留。未发现网络输入直接进入通用对象代码反序列化 |
| 加密 / 凭据 | Windows SQLCipher + DPAPI；事件 spool 使用随机 IV 的 AES-GCM。Muse 静态文件已补保护；D03 和 C04 保留，不因主库加密就声称所有数据均加密 |
| OAuth / 云盘 | PKCE + state、loopback 回调、固定服务域名、授权令牌 DPAPI；共享权限按显式选择并检查继承。未真实向外发送消息或创建云端共享 |
| Android | token、来源、请求 TTL、有限行长 / worker、FileProvider 非公开；cleartext 配置用于本机桥接，未发现外网监听，因此未仅据该标志报告公网泄露 |
| CI/CD | 未发现 pull_request_target；第三方 Action 固定 commit SHA，默认只读权限，签名密钥通过 secrets 环境传入。没有发布或测试真实签名私钥 |
| 浏览器扩展 | 当前产品没有扩展 manifest；permissions / host_permissions 与扩展消息来源规则不适用 |

这些是已核对路径的结论，不表示未知漏洞为零。未进行生产端点渗透、真实账号接管验证、Android 设备攻击或跨平台动态测试。

## 7. 密钥、配置和 Git 历史

- 工作树扫描 **36,920** 个文件 / **2,041,268,667** 字节，覆盖源码、配置、测试、示例、注释、文档外的构建输出和可执行文件；规则包括私钥头、AWS / GitHub / Google / OpenAI token、含密码连接串和 webhook。另对 OAuth / Slack / Azure 等配置模式做脱敏检索与命中复核。
- 主扫描排除 `.git`、依赖目录、target、Gradle 缓存、`.audit-cache`、`docs/security` 报告目录以及模型 / 图片 / archive 等指定二进制格式。随后专门补扫报告目录及审核缓存的文本配置 / 源码 / 日志 / JSON / CSV：**518 个文件、35,460,412 字节**（部分路径与前述范围相交，不直接相加）。仅有两处已确认 `user:pass` 拒绝测试 / 误报筛选规则副本命中，无新增真实凭据。便携 Node 分发包与其第三方依赖、模型及归档内部没有据此宣称全部扫描。
- 本地可达 Git 历史 **181** 个提交、**3,680** 个 blob，未跳过超大 blob（`skippedBlobs: []`）；不包括本地不可达对象或远端已删除历史。
- 候选为拒绝测试用 `user:pass` URL、PEM 解析标志、明确的 `vertex-test-only-key.txt` 测试 RSA 私钥，以及编译二进制字节误匹配。测试私钥没有产品配置用途，仍应保持仅限测试；不将它包装成生产凭据泄露。
- **未确认真实 API Key / Token / 私钥泄露。** `.env` 忽略规则有效，Git 跟踪的 env 文件仅 `.env.example`，示例仅变量名 / 空值；本轮补齐 OAuth 文件模式。
- 一旦任何真实密钥曾提交或外泄，必须到对应平台撤销并重新生成，再清理引用 / 历史；只删除代码或增加 ignore 不够。本轮未发现需授权轮换的真实值，也未替用户吊销任何凭据。

## 8. 验证结果与修复配套

| 检查 | 最终结果 |
|---|---|
| 项目 Node 下 `npm run check` | **通过**：1,395 项，1,394 通过、1 跳过、0 失败；TypeScript / Vite 生产构建、Bun sidecar 编译、bridge smoke 全部通过 |
| 产品 Rust `cargo test --locked --offline --lib --tests --manifest-path desktop/src-tauri/Cargo.toml --quiet` | **通过**：219 通过、16 ignored、0 失败；ignored 为依赖已打开 Windows 客户端 / 交互会话的既有诊断测试（模块在不同 harness 中重复） |
| 辅助 native-compatibility Cargo 测试 | **通过**：30 项；普通 bundled SQLite 3.54.1 |
| Muse 安全回归 | 修复前可复现失败；修复后前端 Muse / 图片生成 53 项、Muse Rust 16 项通过，亦已纳入全量 |
| Android BoundedInputCheck / MediaSharePolicyCheck | standalone javac / java 检查通过 |
| Android Gradle `:app:testDebugUnitTest :app:assembleDebug` | **未完成**：获准联网后已下载 wrapper，但 Java 仍报 `Unable to establish loopback connection`，无 daemon 重试仍失败；未关闭防火墙 / 依赖校验 |
| npm audit / OSV | npm 0 vulnerabilities；OSV 全锁扫描完成，有本文列明误报与保留项 |
| 审核工具小测 | dependency audit Node 测试通过；Python 3.13 Gradle artifact verifier 的哈希正确 / 篡改 / HTTP / 跨域跳转小测通过 |
| `git diff --check` | 通过，保留既有 LF / CRLF 提示 |

为让现有全量测试能够运行，还修复了测试桩与当前工作树功能的脱节：新增图标 / EmojiPicker / MuseWebFields mock，补齐媒体缓存导出、gallery settings / window timer、菜单 DOM 几何与焦点身份；更新既有 customer-card 超时断言；installer mock 在覆盖函数前显式加载 PowerShell Utility，避免自动加载覆盖模拟 Get-FileHash。未跳过失败断言。

对应文件：`ai-settings-usage-vertex-ui`、`ai-token-budget`、`campaign-send-safety`、`folder-reply-menu`、`image-library`、`installer-smoke`、`onboarding-navigation`、`quick-reply-browser`、`settings-model-races`、`sidebar-header-ui`、`star-link`、`transcription-config` 测试。`leadInbox.ts` 的 utils 引用改为等价相对路径，使现有直接 Node TS 测试可加载；未改业务算法。这些配套调整不作为新安全漏洞计数。

## 9. 剩余风险与后续建议

1. 已确认保留 D03 SQLCipher、C04 Baileys 明文存储、D05 sherpa-rs；后续分别完成上游更新与旧库验证、认证加密迁移、官方语音 API 迁移。
2. Linux 发布前处理 glib 及 D-Bus 依赖；本轮没有假定 Windows 测试可以覆盖 Linux ABI。
3. Android 完整 APK / Gradle 验证待解决本机 Java loopback 错误后补跑；已通过的 Java 小测不能替代完整构建。
4. 本轮重新编译了 sidecar 和 Web 资源，未生成或发布签名 Tauri 安装包；实际使用者需通过新构建 / 发布获得修复。开发端重启时使用项目 Node 入口。
5. DPAPI 与 SQLCipher不防御同一 Windows 用户已被攻陷；旧 Muse 文件采用按需迁移，历史备份需按原敏感等级保护。审核没有据此擅自删除数据、停止已有客户端或旋转账号密钥。

## 附录 A：证据文件

- `docs/security/dependency-inventory.json`：全 manifest / lock 精确版本与来源；`osv-audit.json`：每个元组结果、完整公告和 npm 维护元数据。
- `docs/security/dependencies-2026-11-09.csv`：可提交的完整 lock 版本清单；`source-coverage-2026-11-09.csv`：产品、测试、脚本、配置的规则扫描文件 / SHA-256 / 行数与命中位置（不含匹配内容）。
- `docs/security/web-search-2026-11-09.json`：本轮逐直接依赖 WebSearch 证据，JSON 报告按仓库规则忽略；公告可能在审核后更新。
- `docs/security/secret-scan.json`、`secret-history-scan.json`：仅候选位置与规则，不输出疑似真实值。
- `.audit-cache/secret-supplement-20261109.json`：报告和缓存文本补扫证据；候选已按测试副本复核。
- `.audit-cache/npm-audit-final-20261109.json`、`dependency-audit-final-20261109.log`、`security-full-check-final-20261109.log`、`security-rust-20261109.log`、`native-compat-security-tests.log`、`security-android-20261109.log`：本轮验证输出，缓存不进入 Git。

## 附录 B：全部直接依赖与关键间接版本

以下由最终清单 / 锁文件生成；npm 实际版本以根 workspace 为准，独立锁所有版本另见 CSV，Rust 直接版本以 Cargo resolve root 为准而非同名间接包猜测。

### npm（31 项）

| 清单 / 用途 | 包 | 实际版本 |
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
| desktop/package.json / devDependencies | vite | 6.4.5 |
| desktop/baileys-bridge/package.json / dependencies | baileys | 7.0.0-rc14 |
| desktop/baileys-bridge/package.json / dependencies | pino | 10.3.1 |
| desktop/baileys-bridge/package.json / dependencies | qrcode | 1.5.4 |
| desktop/baileys-bridge/package.json / devDependencies | bun | 1.4.4 |

### 产品 Rust（29 项）

| 包 | 直接解析版本 |
|---|---|
| base64 | 0.22.1 |
| bzip2 | 0.4.4 |
| chrono | 0.4.45 |
| futures-util | 0.3.33 |
| png | 0.18.1 |
| reqwest | 0.13.4 |
| ring | 0.17.14 |
| rusqlite | 0.41.1 |
| serde | 1.0.229 |
| serde_json | 1.0.151 |
| sha2 | 0.10.9 |
| sherpa-rs | 0.5.1 |
| tar | 0.4.46 |
| tauri | 2.12.5 |
| tauri-build | 2.7.4 |
| tauri-plugin-notification | 2.3.3 |
| tauri-plugin-shell | 2.3.5 |
| tauri-plugin-single-instance | 2.4.4 |
| tauri-plugin-updater | 2.14.1 |
| tauri-winrt-notification | 0.7.3 |
| thiserror | 2.0.19 |
| tokio | 1.54.1 |
| tracing | 0.1.44 |
| tracing-subscriber | 0.3.23 |
| url | 2.5.8 |
| uuid | 1.24.0 |
| windows | 0.61.3 |
| windows-registry | 0.6.1 |
| windows-sys | 0.61.2 |

### 辅助 Rust 工程（7 + 2 项声明）

| 包 | 版本 | 用途 |
|---|---|---|
| rusqlite | 0.41.1 | 普通 |
| serde | 1.0.229 | 普通 |
| serde_json | 1.0.151 | 普通 |
| tauri | 2.12.5 | 普通 |
| chrono | 0.4.45 | 普通 |
| tracing | 0.1.44 | 普通 |
| sherpa-onnx | 2.0.1 | 可选 speech |
| bzip2 | 0.4.4（0.6.1 为间接依赖） | dev |
| uuid | 1.29.0 | dev |

### Android

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

### 关键间接依赖（全部锁文件中的实际版本）

| 生态 | 包 | 版本 |
|---|---|---|
| crates.io | libsqlite3-sys | 0.39.1 |
| crates.io | sqlcipher-src | 419.0.6+sqlcipher-4.19.0-sqlite-3.53.4-libtomcrypt-1.18.2 |
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
| Maven | io.netty:netty-handler | 4.1.137.Final |
| Maven | org.bouncycastle:bcprov-jdk18on | 1.85 |
| Maven | com.google.protobuf:protobuf-java | 3.25.5 |
| Maven | com.google.guava:guava | 33.7.2-jre |
| Maven | commons-io:commons-io | 2.15.1 |
| Maven | org.apache.commons:commons-compress | 1.26.0 |
| Maven | org.apache.commons:commons-lang3 | 3.18.0 |
| Maven | org.bitbucket.b_c:jose4j | 0.9.6 |
| Maven | org.jdom:jdom2 | 2.0.6.1 |
