# 修复后安全复审报告（2026-11-02）

**结论：本轮最终测试及 Windows 构建检查通过，未发现新的已确认产品安全漏洞；全平台依赖审核仍有未关闭项，不能称为“整个项目零漏洞”。**

本次从修复后的工作树重新执行扫描和检查，不沿用上一轮测试结果。Git 基线仍为 `2f277c1` / v0.1.62，加上尚未提交的安全修复。本报告替代上一报告作为本轮最终结果；旧报告保留历史问题说明与完整依赖版本清单。

**上轮结论更正：** 上轮在新增安装包 FFmpeg 校验后，未再次运行完整测试。此次首次执行实际为 **1,032 通过、1 失败**：安装包烟雾测试的模拟环境没有同步新增校验。现已补齐测试并重新运行，最终为 **1,033 通过、0 失败、0 跳过**。这是一处测试维护遗漏，不能将首次失败隐藏为“始终通过”。

## 1. 项目概况、复审范围

| 项目 | 当前情况 |
|---|---|
| 桌面 | TypeScript / React 18 / Vite 6；Rust / Tauri 2；Node/Baileys 源码、Bun 编译 sidecar |
| 数据与媒体 | SQLite、离线语音引擎、项目独立 FFmpeg；Android Kotlin / Java / Compose 桥接 |
| 包管理 | npm 三份锁文件；产品与辅助兼容工程两份 Cargo.lock；Gradle 插件和应用锁文件及严格哈希清单 |
| 直接依赖声明 | npm 30 项；产品 Rust 26 项；Android 11 项依赖及 3 项插件；辅助工程单列 |
| 全锁文件清单 | 1,439 个不同生态/名称/版本组合：npm 424、Rust 721、Maven 294；含开发、辅助及非 Windows 依赖 |
| Windows 产品 Rust 图 | 369 个包；不包含本轮仍有告警的五个非 Windows 包 |
| 复审方法 | 全锁文件重新在线查询 OSV、三处 npm audit；重新核对官方公告；源码规则扫描、修复调用链和安全边界人工复查；重新执行现有测试/构建及密钥扫描 |

全部直接与关键间接依赖版本在本轮复核后未发生变化，详见[完整版本清单](SECURITY_AUDIT_2026-11-02.zh-CN.md#附录-a全部直接依赖及关键间接版本)。本轮没有新增、删除或升级产品依赖。

人工复查重点：AI JSON/流式读取、模型列表、Sheets 原生响应、Android content URI 分享来源/超时/代次、SQLite 迁移、FFmpeg 下载/校验/绝对路径调用、Tauri 资源配置，以及 CI 安装包检查。对其他既有文件重新进行规则扫描，不声称把所有代码逐行重新证明安全。

未执行 cargo-audit、Semgrep 或 Gitleaks；本机未安装这些工具。OSV、npm audit 与官方运行时公告分别覆盖不同范围，结果不可互相替代。

## 2. 问题汇总与复验状态

表中 S 编号沿用上一报告；严重级别表示原问题/上游公告级别，并不意味着修复后仍存在同等级漏洞。

| 编号 | 类别 | 严重级别 | 位置 | 状态 / 本轮结果 |
|---|---|---|---|---|
| S01 | 依赖 | High | `desktop/baileys-bridge/package.json:15`；根/sidecar 锁文件 | 已修复，Bun 1.4.4；重新编译通过 |
| S02 | 依赖 | High | `.nvmrc:1`；本机默认 Node | 项目已修复，CI/本轮检查用 22.23.4；全局 22.23.2 建议关注 |
| S03 | 依赖 | High | `android/gradle/wrapper/gradle-wrapper.properties:3` | 已修复，Gradle 8.14.6；strict 构建再次通过 |
| S04 | 依赖 | Medium | `desktop/src-tauri/Cargo.toml:40`；`src/db.rs` 迁移测试 | 已修复，rusqlite 0.40.2 / SQLite 3.53.2；旧库兼容再次通过 |
| S05 | 依赖 | Critical（公告级别） | `docs/security/native-compatibility/Cargo.toml:14` 及其 Cargo.lock | 已修复，sherpa-onnx 2.0.1 / zip 9.2.2；默认/语音测试通过 |
| S06 | 代码 | Medium | `desktop/src/lib/aiResponse.ts:4` 及六类调用 | 已修复，实际读取限额与取消测试通过 |
| S07 | 代码 | Low | `desktop/src/lib/listModels.ts` 模型数组/字符串过滤 | 已修复，异常模型标签测试通过 |
| S08 | 代码 | Medium | `desktop/src-tauri/src/google_sheets.rs:46` | 已修复，32 MiB 声明/实际流边界测试通过 |
| S09 | 代码 | Medium | Android `ui/MainActivity.kt`、`a11y/WaAssistService.kt`、`net/MediaSharePolicy.java` | 已修复，来源/两分钟期限/代次断言与构建通过 |
| S10 | 依赖 | Medium（原快照具体 CVE 待确认） | `desktop/baileys-bridge/audioConvert.mjs:7`；`tools/prepare-ffmpeg.ps1` | 项目版本漂移已修复，9.0.2 双哈希及真实编译程序转换通过 |
| S11 | 依赖 | Medium | 产品和辅助 Cargo.lock：glib 0.18.5 | 待开发者决定；不在 Windows 图，Linux 发布审核未通过 |
| S12 | 依赖 | Low | sherpa-rs 0.5.1；四个非 Windows 停维护包 | 建议关注；尚未完成产品语音引擎迁移 |
| S13 | 密钥 | Low（核验项） | 工作树、构建产物、Git 历史、.gitignore / .env.example | 未确认真实泄露；模式扫描及候选复核通过 |
| R01 | 代码 | Low（测试维护） | `desktop/tests/installer-smoke.test.mjs` | 本轮已修复：补齐 FFmpeg 模拟与四种拒绝场景 |

精确位置及所有已修复调用点的行号清单见[上轮问题位置附录](SECURITY_AUDIT_2026-11-02.zh-CN.md#附录-b问题精确位置)。本轮 R01 的准确行号见下文。

### 在线依赖扫描剩余项

| 名称 / 实际版本 | 公告 | 当前 Windows 产品可达性 | 结论 |
|---|---|---|---|
| glib 0.18.5 | GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429（同一问题两个别名） | 不在 Windows 解析图 | 特定 Variant 字符串迭代不安全；修复要求 ≥0.20.0；Linux 兼容迁移待决定 |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370 | 不在 Windows 解析图 | 停维护；不等于已证实远程可利用漏洞 |
| zbus_names 4.3.4 | RUSTSEC-2026-0371 | 不在 Windows 解析图 | 停维护 |
| zvariant 5.14.0 | RUSTSEC-2026-0370 | 不在 Windows 解析图 | 停维护 |
| zvariant_derive 5.14.0 | RUSTSEC-2026-0372 | 不在 Windows 解析图 | 停维护 |

因此是 **5 个包、1 个已知安全问题及 4 个维护告警**，不能把 glib 的两个别名重复算为两处漏洞，也不能过滤非 Windows 记录后报告“全锁文件零告警”。[glib 官方公告](https://github.com/gtk-rs/gtk-rs-core/security/advisories/GHSA-wrw7-89jp-8q8g)。

## 3. 本轮新增修复与重新执行的验证

### R01：安装包烟雾测试夹具遗漏

位置：`desktop/tests/installer-smoke.test.mjs` 中 PowerShell 模拟的 Test-Path / Get-FileHash 和 case 列表。条件：安装包脚本新增 FFmpeg/许可检查，但测试仍按旧资源集合模拟，导致原本“数据库未就绪”的场景提前因 FFmpeg 校验失败，断言报错。

本轮改动仅涉及测试和更新记录，没有降低安装包安全要求：

- 补齐固定 SHA256 的 Get-FileHash 模拟，让既有启动/数据库测试能够到达原有断言。
- 新增 **FFmpeg 缺失、哈希不匹配、LICENSE 缺失、NOTICE 缺失** 四种失败场景，并断言不会继续启动应用。
- 原有安装包版本、运行中会话、已有用户数据、数据库就绪轮询和新进程启动等六种检查继续保留，共十种模拟场景。

测试没有安装或启动真实 CRM，没有结束用户进程，也没有读取真实客户数据库。独立回归与完整测试均已重新通过。

### 最终检查结果

以下是本轮新执行结果；Android 的任务为增量 up-to-date，不冒充 41 条单元测试或 41 次重新编译。

| 检查 | 结果 | 证据 / 范围 |
|---|---|---|
| 完整 `npm run check` | 通过 | 1,033 测试，0 失败，0 跳过；TypeScript / Vite build、Bun sidecar 编译、Bridge smoke 均通过 |
| Windows 产品 `cargo test --locked --lib --tests` | 通过 | 151 项；含真实 SQLite 3.46.0 合成文件的迁移、保存重开、FTS 搜索和完整性检查 |
| 辅助工程默认测试 | 通过 | 28 项；使用真实产品数据库代码 |
| 辅助工程 `--features speech` | 通过 | 29 项；Tiny 原版及 int8 公开模型实际解码 |
| Android strict unit-test 任务 / assembleDebug | 通过 | BUILD SUCCESSFUL；41 个任务 up-to-date，严格哈希未关闭 |
| Java 独立策略断言 | 通过 | 重新编译并执行 BoundedInputCheck、MediaSharePolicyCheck |
| Gradle 官方产物核验 | 通过 | 702 / 702，failures 为空；重新查询官方仓库 |
| 根 npm audit | 通过 | 0 条 |
| desktop npm audit | 通过 | 0 条 |
| sidecar npm audit | 通过 | 0 条 |
| 全锁文件 OSV | 有保留项 | Windows 解析图无已知匹配；全平台保留上表五个包告警 |
| 独立 FFmpeg 哈希和真实媒体回归 | 通过 | 完整测试使用项目内固定文件；没有回退系统 FFmpeg |
| 额外 Bun 编译版媒体链 | 通过 | Bun 1.4.4 编译独立验证程序，通过绝对路径调用 FFmpeg，将合成 WAV 转为 Ogg/Opus 并生成 64 点波形数组 |
| 安装包检查模拟回归 | 通过 | 十种场景；仅模拟，不代表真实安装包升级测试 |
| 密钥扫描 / 忽略规则 | 通过核验 | 未确认真实凭据泄露；.env、认证目录及签名私钥均被忽略，无真实敏感路径被 Git 跟踪 |
| CI/CD 配置复查 | 通过本轮检查 | 未发现 pull_request_target；第三方 Action 均固定提交 SHA；未新增权限或明文凭据 |
| `git diff --check` | 通过 | 无空白错误；保留既有 CRLF/LF 提示 |

运行时复核：Bun **1.4.4**、本轮 Node **22.23.4**、Gradle **8.14.6**、SQLite **3.53.2**、FFmpeg **9.0.2**；本机默认 `node --version` 仍为 **22.23.2**，没有擅自更新全局环境。[Bun 修复公告](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p)、[Node 安全版本说明](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[Gradle 公告](https://github.com/gradle/gradle/security/advisories/GHSA-j5m7-59rp-24f5)、[SQLite 安全记录](https://www.sqlite.org/cves.html)、[zip 修复版本](https://github.com/zip-rs/zip2/security/advisories/GHSA-m665-v7pm-7grj)。

### 密钥复查

本轮重新扫描工作树 **36,643 个文件**和本地可达 **171 个提交 / 3,282 个 blob**，历史扫描无超大 blob 被跳过。31 个工作树候选及 1 个历史候选仍为已核验的协议常量、FFmpeg 解析标记/公开 SSH 算法名称或安全测试伪凭据；没有确认真实密钥泄露。`.env.example` 的非注释行仅为空变量声明。

大体积缓存、node_modules、原生 target 等目录不做逐字节全量密钥扫描；依赖另用来源/SCA 核验。未通过外部平台接口验证密钥有效性；若后续发现真实泄露，必须在平台作废并重新生成，删除代码不够。

## 4. 需要开发者决定的问题

本轮没有新的待授权业务改动；此前四项批准的修复均已保留并复验。

| 项目 | 可选方案 | 建议 |
|---|---|---|
| Linux glib 旧系列 | 保持当前 Windows 发布范围；或单独迁移 Linux GTK/Tauri 兼容链并进行 Linux 构建/UI 测试 | 当前保持 Windows 范围，Linux 发布前必须处理，不能强制跨系列替换后直接宣称兼容 |
| 产品 sherpa-rs 0.5.1 已归档 | 固定现状并监测；或把辅助工程已验证的官方绑定迁入产品并补完整功能/打包验证 | 单独安排产品迁移；本轮只复验辅助工程，不把样本解码通过当作迁移完成。[上游状态](https://github.com/thewh1teagle/sherpa-rs) |
| 全局 Node 22.23.2 | 通过版本管理器升级默认版本；或仅在项目命令中显式使用固定版 | 建议开发者更新默认版本；本轮验证明确使用 22.23.4 |

## 5. 剩余风险与后续建议

- **仍未完整通过：** 全平台依赖清零、Linux/macOS 发布审核、产品旧语音引擎维护和原生静态组件完整 SBOM；它们没有因当前 Windows 测试通过而被关闭。
- **尚未执行：** 真实手机分享与 WhatsApp 收发、真实用户数据库升级恢复、真实 AI/Google 服务、新安装包实际安装及升级。本轮未发送消息、未使用真实 API Key、未更改用户数据。
- **外部依赖边界：** 固定 FFmpeg 版本/哈希可解决版本漂移，不能证明其全部编解码器没有未知漏洞；既有协议、格式、容量与超时限制仍应保留。分发者须继续携带 GPL 许可证及履行对应源码义务。
- **报告范围：** 规则扫描和测试均有覆盖边界，不能证明“任何输入都安全”。没有证据支持把近似名称的恶意包公告套用到真实 tauri-winrt-notification，或将其他 React Server Components 插件的公告套用到本项目。
- **发布状态：** 本轮只新增测试修正、更新记录及这份复审报告；没有提交、push 或 release。线上 v0.1.62 安装包不包含这些本地修复，正式发布仍需重新构建、签名和真实安装包烟雾测试。

## 复审快照与证据索引

本地复审日志位于忽略的 `tmp/re-audit-2026-11-02-*`，依赖与密钥扫描原始结果位于忽略的 `docs/security/*.json`。不提交二进制、用户路径或原始候选内容到报告。

<!-- REAUDIT_SNAPSHOT -->

- 复审时间：2026-11-02 19:17（Europe/Paris，UTC+01:00）。
- 代码/配置/锁文件快照：759 个文件；清单内容 SHA256：`4ff434ed69f95b6c68ce88525148f29ee96fda407b9061cd62987712b7dd2056`。包含已跟踪文件及本轮未跟踪的修复文件，不包含忽略的缓存、二进制或报告本身。
- R01 模拟补齐：`desktop/tests/installer-smoke.test.mjs:22`；新增拒绝场景：`desktop/tests/installer-smoke.test.mjs:28`；拒绝断言：`desktop/tests/installer-smoke.test.mjs:38`。
- 本轮修正仅为 `desktop/tests/installer-smoke.test.mjs`、`CHANGELOG.md` 及本复审报告。其余工作树改动是前轮安全修复，未撤回或擅自重做。
