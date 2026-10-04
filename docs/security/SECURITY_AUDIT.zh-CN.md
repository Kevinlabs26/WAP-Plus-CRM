# BridgeCRM 安全审核报告

审核日期：2026-10-02；供应链与原生组件补充核对：2026-10-03；工作流与推送前复核：2026-10-04。对象：审核期间的工作目录和修改内容；推送前验证及当前发布边界见第 22 节。

## 1. 项目概况与范围

- 桌面：TypeScript / React 18 / Vite 6 / Tailwind / Zustand，Tauri 2 + Rust，SQLite/rusqlite；Drizzle 主要用于静态 schema。
- WhatsApp sidecar：Node.js ESM / Baileys，Bun 编译为 Windows EXE。本项目不是浏览器扩展，未发现扩展 manifest；浏览器扩展权限项不适用。
- Android：Kotlin / Java / Jetpack Compose / Gradle，Android API 26–35，TCP Bridge 与辅助功能服务。
- 包管理：npm workspaces + 根 package-lock.json；另外保留两个子目录 package-lock.json；Rust Cargo.toml/Cargo.lock；Android Gradle Kotlin DSL/Wrapper。本轮新增构建 classpath 和 app 全配置锁文件，以及官方 SHA-256 制品校验基线。
- 直接依赖：npm 28 项声明（17 项运行时、11 项开发）；Rust 20 项声明（含构建及 Windows 专用项）；Android 11 项依赖声明（含 BOM、debug UI）和 3 项构建插件声明。
- 对三个 npm 锁、Cargo.lock、Android 运行时、构建 classpath 和新增锁文件全部配置去重「生态/名称/版本」组合逐项查询 OSV（最终 1,286 项，其中 npm 426、Rust 566、Maven 294 项）；直接依赖逐个 WebSearch，优先采用 GitHub Advisory、RustSec、官方仓库和发布说明。已补齐内部设备测试工具链，原生组件实际版本与哈希另存 native-inventory.json；这不是原生二进制内部的完整审计。
- 范围覆盖项目源码、配置、CI、测试、文档、示例、当前前端 dist 和编译 sidecar；逐文件静态扫描并人工追踪安全边界。追加凭据规则扫描覆盖 Git 所有可达引用的 132 个提交、2,228 个去重文件对象，未跳过大对象；规则不能识别所有未知格式/编码凭据。不包含不可达或已清理的提交、未在 Git 保存的旧版安装包、平台密钥管理界面、生产运行环境和所有原生二进制内部的完整审计。未对真实账号执行攻击。
- 开始审核时已有大量未提交修改，包括 DPAPI、账号路径校验、删除日志、数据恢复与安全测试；这些属于原有工作，保留且不计入本次新增修复。

证据：本目录 dependency-inventory.json、osv-audit.json、npm-audit-before.json、npm-audit-after.json（第一轮）、npm-audit-final.json（最终）、secret-scan.json、web-search-evidence.json。WebSearch 无命中不等于无漏洞；OSV 的两个别名命中也不重复计为两个漏洞。

## 2. 问题汇总

严重度结合公告和实际利用条件。High「待确认」表示危险边界明确，但端到端可利用性尚未复现。构建依赖新增 Critical 公告命中，具体功能可达性未确认；没有复现项目端到端 Critical 利用。

| 编号 | 类别 | 严重级别 | 位置（修复后的文件:行） | 状态 |
|---|---|---|---|---|
| D01 | 依赖 | High | package-lock.json：sharp；两个 sidecar 锁条目 | 已修复：0.35.3 → 0.35.5 |
| D02 | 依赖 | High | package-lock.json：nanoid；desktop/package-lock.json | 已修复：3.3.16 → 3.3.19；实际运行暴露低 |
| D03 | 依赖 | Medium | desktop/src-tauri/Cargo.lock：rustls | 已修复：0.23.43 → 0.23.45 |
| D04 | 依赖 | Medium | android/gradle/wrapper/gradle-wrapper.properties:3 | 已修复：8.14 → 8.14.5，并固定 SHA-256 |
| D05 | 依赖 | High | desktop/package.json：vite | 已修复：5.4.21 → 6.4.3，已获批准 |
| D06 | 依赖 | High | desktop/package.json：drizzle-orm；desktop/src/db/schema.ts | 已修复：0.38.4 → 0.45.3，已获批准 |
| D07 | 依赖 | Medium | package-lock.json：esbuild 及 drizzle-kit 开发链 | 已修复：Kit 0.31.11；esbuild 0.25.12/0.28.2 |
| D08 | 依赖 | High | desktop/src-tauri/Cargo.lock：glib 0.18.5 | 待开发者决定：Linux 链升级；Windows 当前路径不适用 |
| D09 | 依赖 | Low | desktop/src-tauri/Cargo.lock：proc-macro-error、unic-* | 建议关注：上游停止维护 |
| D10 | 依赖 | Medium | desktop/src-tauri/Cargo.toml：sherpa-rs 0.5.1 | 兼容方案已验证，实际迁移待批准：上游仓库已归档 |
| D11 | 依赖 | High | android/build.gradle.kts:8；app/build.gradle.kts:71 | 已修复：构建/设备工具 protobuf-java 3.22.3 → 3.25.5 |
| D12 | 依赖 | Critical（公告，可达性待确认） | android/build.gradle.kts:7 | 已修复：构建链 Bouncy Castle 1.77 → 1.85 |
| D13 | 依赖 | Critical（公告，可达性待确认） | android/build.gradle.kts:6；app/build.gradle.kts:70 | 已修复：构建/设备工具 Netty 4.1.93.Final → 4.1.137.Final |
| D14 | 依赖 | Medium | android/build.gradle.kts:9 | 已修复：commons-compress 1.21 → 1.26.0 |
| D15 | 依赖 | High | android/build.gradle.kts:11；app/build.gradle.kts:72 | 已修复：构建/设备工具 commons-io 2.13.0 → 2.15.1 |
| D16 | 依赖 | High | android/build.gradle.kts:12 | 已修复：jose4j 0.9.5 → 0.9.6 |
| D17 | 依赖 | High | android/build.gradle.kts:13 | 已修复：jdom2 2.0.6 → 2.0.6.1 |
| D18 | 依赖 | Medium | android/build.gradle.kts:26,27；app/build.gradle.kts:41 | 已修复：Kotlin/Compose 编译插件 2.0.21 → 2.4.20 |
| D19 | 依赖 | Medium | android/build.gradle.kts:10 | 已修复：新 Compress 链的 commons-lang3 3.14.0 → 3.18.0 |
| D20 | 依赖 | High（公告；运行时可达性未发现） | package-lock.json:3359；desktop/tailwind.config.js:27 | 待开发者决定 → 已决定暂时保留：braces 3.0.3，无公布修复版本 |
| D21 | 依赖 | Medium（原生风险待确认） | desktop/src-tauri/Cargo.toml:35；db.rs:88 | 兼容方案已验证，实际迁移待批准：SQLite 3.46.0 → 候选 3.53.2 |
| D22 | 依赖 | Medium（具体 CVE 影响待确认） | desktop/baileys-bridge/audioConvert.mjs:26；本机 C:/ffmpeg/bin/ffmpeg.exe | 兼容方案已验证，实际替换待批准：候选 FFmpeg 9.0.2 |
| C01 | 密钥 | High | desktop/vite.config.ts:27；.github/workflows/release.yml:61 | 已修复：禁止将 TAURI_ 环境变量公开到前端；历史泄露待确认 |
| C02 | 代码 | Medium | desktop/baileys-bridge/httpUtil.mjs:13 | 已修复：精确来源 CORS、敏感响应不缓存 |
| C03 | 代码 | Medium | desktop/baileys-bridge/httpUtil.mjs:32；httpServer.mjs:157 | 已修复：按字节限制 JSON、拒绝畸形重启请求 |
| C04 | 代码 | Medium | desktop/baileys-bridge/mediaDownload.mjs:101；avatarService.mjs:198 | 已修复：下载过程中限制体积 |
| C05 | 代码 | High（待确认） | desktop/src/components/chat/messageMediaUtils.ts:241 | 已修复：主动文档下载、危险 URL 协议拒绝 |
| C06 | 代码 | Medium | desktop/baileys-bridge/audioConvert.mjs:82,124,220,240 | 已修复：禁用网络协议/播放列表，并替换 SDK 缩略图入口 |
| C07 | 代码 | High（待确认） | desktop/src-tauri/src/voice.rs:155；speech_archive.rs:18 | 已修复：模型命名、链接/特殊条目和解压资源边界 |
| C08 | 代码 | Medium | android/.../net/BridgeServer.kt:91,111；ui/MainActivity.kt:102 | 已修复：鉴权/消息行及分享输入读取上限 |
| C09 | 代码 | Medium | desktop/src-tauri/src/bridge.rs:339 | 已修复：桌面 Bridge 消息行 16 MiB 上限 |
| C10 | 代码 | Medium | .github/workflows/ci.yml:15；release.yml:18 | 已修复：第三方 Action 固定提交 SHA |
| C11 | 代码 | Low | desktop/baileys-bridge/httpServer.mjs:1076；audioConvert.mjs | 已修复：移除完整错误对象、URL、音频内容片段日志 |
| C12 | 代码 | High（原端到端利用待确认） | desktop/baileys-bridge/remoteMedia.mjs:28,53；mediaDownload.mjs:5 | 已修复：公共 HTTPS、每跳 DNS 校验与 TLS 地址绑定 |
| C13 | 代码 | Medium | desktop/src-tauri/src/bridge.rs:182 | 已修复：发送 Token 前拒绝非回环地址 |
| C14 | 密钥 | Low | .gitignore；.env.example | 已修复：忽略所有 .env.* 变体，模板仅空变量 |
| C15 | 代码 | Medium | android/.../net/BridgeServer.kt:50,72；net/BridgeWorkers.java:16,28 | 已修复：有界客户端/响应线程池、过载断开、写入超时 |
| C16 | 代码 | Low | android/build.gradle.kts:3；app/build.gradle.kts:63；gradle/verification-metadata.xml:1；.github/workflows/ci.yml:45 | 已修复：锁定实际版本、官方 SHA-256 基线与 CI 严格校验；镜像优先顺序保留 |
| C17 | 代码 | Medium | desktop/baileys-bridge/mediaDownload.mjs:37,62；httpServer.mjs:1077 | 已修复：下载队列上限、503 与重试提示 |
| C18 | 密钥 | Medium | desktop/src-tauri/src/baileys.rs:172；db.rs:78 | 待开发者决定：会话 JSON 与业务数据库静态加密 |
| C19 | 代码 | Medium | desktop/src/lib/localSpeech.ts:59,78 | 已修复：模型下载前端 512 MiB 上限、15 分钟超时、异常取消读取 |
| C20 | 代码 | Low（可用性缺陷） | desktop/src-tauri/src/voice.rs:106,128,169 | 已修复：官方模型词表名兼容、完整文件就绪/安装检查 |
| C21 | 代码 | Medium | desktop/src/lib/mediaBlob.ts:19,48,62 | 已修复：语音读取的解码前大小检查、响应流实际字节上限及取消 |
| C22 | 代码 | Low（可用性缺陷） | desktop/src/lib/transcribeVoice.ts:131 | 已修复：本地转写传递用户明确选择的语言 |
| C23 | 代码 | Medium | desktop/src/lib/transcribeVoice.ts；desktop/src-tauri/src/voice.rs:speech_transcribe | 已修复：转写单任务并发保护、原生推理后台执行；时长/采样上限待开发者选择 |
| C24 | 代码 | Medium | desktop/src/components/chat/Composer.tsx:647 | 已修复：翻译请求绑定会话生命周期，旧结果和错误不影响新会话 |
| C25 | 代码 | High | desktop/src/components/chat/useComposerMedia.ts:350；useMediaSend.ts；sendAudioMessage.ts；sendGifMessage.ts | 已修复：批次切换后停止继续发送，媒体记录固定原会话/账号 |
| C26 | 代码 | Medium | desktop/src/components/chat/useTextSend.ts:81；useMediaSend.ts:53；sendFileMessage.ts；sendImageMessage.ts | 已修复：原会话未改动草稿才清理，读取前固定附件说明 |
| C27 | 代码 | Medium | desktop/src/components/chat/useComposerVoiceInput.ts:64、89 | 已修复：旧语音启动、临时结果及最终结果在切换/取消后失效 |
| C28 | 代码 | Medium（数据丢失） | desktop/src/components/chat/useComposerMedia.ts:399 | 已修复：只有说明实际发送成功才清理草稿 |
| C29 | 代码 | Medium（备份一致性） | desktop/src/lib/automaticBackup.ts:17、24；desktop/src/store/restoreGuard.ts:18 | 已修复：导出期间发生恢复，即使恢复已完成，也不写入该旧快照 |
| C30 | 代码 | Low（可用性缺陷） | desktop/src/components/chat/useComposerMedia.ts:224 | 已修复：附件恢复时显示保存的说明，保留期间新输入 |
| C31 | 代码 | Medium（数据丢失） | desktop/src/components/chat/useComposerDraftAutosave.ts:7；desktop/src/store/persist.ts:141；desktop/src-tauri/src/db.rs:707 | 已修复：文字草稿持久化、连续输入检查点、恢复代次保护和容量失败隔离 |
| C32 | 代码 | Low（任务一致性） | desktop/src/components/views/StatsView.tsx:209；desktop/src/features/multiWindow/lib/selectors.ts:35；desktop/src/store/calcStats.ts:94 | 已修复：待回复与未读分开按账号统计、跳转及多窗口使用同一判断 |
| C33 | 代码 | Medium（数据丢失） | desktop/src/store/messageActionsSlice.ts:41；desktop/src/components/chat/sendTextMessage.ts:161；desktop/src/components/chat/useTextSend.ts:186 | 已修复：乐观入队不先清草稿，失败/结果未知保留；成功或重试队列接管后才清原会话 |

依赖位置的精确行号与完整条目见附录自动生成表。上表跨行位置表示同类调用点，不代表每一行都存在独立漏洞。

## 3. 依赖漏洞与可达性

### 已修复

- **D01 sharp**：[GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)，修复下限 0.35.4，已锁定 0.35.5。Baileys 的缩略图/头像处理可加载 sharp，确实存在图片解码调用。公告所述 libheif 内存破坏的具体平台条件需要区分，不能据此断言 Windows 已有可执行 RCE。
- **D02 nanoid**：[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)，3.x 修复下限 3.3.18，已锁定 3.3.19。主要来自 PostCSS 开发链；项目未发现向自定义生成器传入攻击者可控 size=0。保留公告 High，但项目实际风险较低。
- **D03 rustls**：[官方公告](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc) / [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)，0.23.45 修复 TLS 1.3 不同加密级别的消息边界处理。reqwest/更新器依赖 TLS 链，更新 Cargo.lock，不改变业务 API。
- **D04 Gradle**：[GHSA-mqwm-5m85-gmcv](https://github.com/gradle/gradle/security/advisories/GHSA-mqwm-5m85-gmcv)、[GHSA-w78c-w6vf-rw82](https://github.com/gradle/gradle/security/advisories/GHSA-w78c-w6vf-rw82) 涉及仓库连接失败时回退可能引入恶意制品。[8.14.5 官方发布说明](https://docs.gradle.org/8.14.5/release-notes.html)确认安全修复；该支线首次修复为 8.14.4，本次升级到 8.14.5 并校验官方 ZIP SHA-256。只涉及构建链。
- 同步两个旧 npm 子锁，清除与当前 manifest 不一致的旧 Router 条目；旧锁曾命中 Router 公告，但根工作空间当前未安装该 Router，不能计作当前产品运行时漏洞或宣称删除了路由功能。

### 后续已批准迁移与仍未迁移

Android 构建链继续审核新增 **D11–D19**：运行时依赖树最初未命中公告，但 buildEnvironment 揭示了 AGP/Kotlin 的旧构建依赖，不能用运行时无命中来概括整个 Android 生态。原始命中、全部别名和受影响范围保存在 osv-before-android-build-fixes.json，构建树前后分别保存；最终解析状态见 osv-audit.json。

| 问题 | 公告、修复下限与实际条件 |
|---|---|
| D11 Protobuf | [GHSA-735f-pc8j-v9w8](https://github.com/protocolbuffers/protobuf/security/advisories/GHSA-735f-pc8j-v9w8)，3.x 修复下限 3.25.5。AGP aapt2/SDK/analytics/设备测试消息确实使用 Protobuf；利用需要构建工具解析恶意嵌套消息，未复现。保留 3.x，不迁移到 4.x。 |
| D12 Bouncy Castle | [GOST CTR 重用](https://github.com/advisories/GHSA-574f-3g2m-x479)（主线修复 1.84）和[证书 Name Constraints 绕过](https://github.com/advisories/GHSA-9pwp-9qqc-pr26)（1.85）等；统一 bcprov/bcpkix/bcutil 至 1.85。AGP SDK/签名工具引入，但未发现项目使用 GOST 或依赖该证书约束，Critical 为公告级别，不代表 APK 中存在远程 Critical 漏洞。 |
| D13 Netty | 多个 HTTP/HTTP2、TLS、内存资源及请求解析公告。保留 4.1 分支，统一其模块到覆盖当前命中的 4.1.137.Final；不覆盖独立版本线的 netty-tcnative。[Critical SNI 绕过](https://github.com/advisories/GHSA-c4c3-7fpv-j4q5)要求服务端仅按 SNI 选择 mTLS 且默认上下文宽松，本项目未发现该服务端部署；这些库来自 AGP gRPC 构建工具，具体其他解析入口可达性待确认。 |
| D14 Compress | [GHSA-4265-ccf5-phj5](https://github.com/advisories/GHSA-4265-ccf5-phj5) 与 GHSA-4g9r-vxhx-9pgx，修复 1.26.0；需要工具处理攻击者控制的畸形压缩文件，AGP SDK/仓库工具具有解压用途，未复现。 |
| D15 IO | [Apache 安全公告](https://commons.apache.org/proper/commons-io/security.html)，GHSA-78wr-2p64-hpwj：恶意 XML 导致 CPU 消耗，修复下限 2.14.0。使用 2.15.1 兼容升级后的 Compress；具体 XmlStreamReader 路径待确认。 |
| D16 jose4j | [GHSA-3677-xxcr-wjqv](https://github.com/advisories/GHSA-3677-xxcr-wjqv)，修复 0.9.6；解压恶意 JWE 可耗尽内存，构建工具链有该库，但没有确认解析外部攻击者 JWE。 |
| D17 JDOM | [GHSA-2363-cqg2-863c](https://github.com/advisories/GHSA-2363-cqg2-863c)，修复 2.0.6.1；XXE 需要 SAXBuilder 展开不可信外部实体，AGP/IDE XML 构建链引入，实际调用参数未确认。 |
| D18 Kotlin | [GHSA-r937-wjx7-w2jp](https://github.com/advisories/GHSA-r937-wjx7-w2jp)：构建缓存元数据不安全反序列化；利用需污染构建缓存，公告 Medium/本地高权限，未确认远程入口。首次修复 2.4.20-Beta1，已核实稳定 2.4.20 发布；[官方兼容矩阵](https://kotlinlang.org/docs/gradle-configure-project.html)包含现有 Gradle 8.14.5/AGP 8.7.2，因此按同主版本升级规则直接同步 Kotlin/Compose 插件，无需 AGP 大版本升级。将弃用 kotlinOptions 改为 compilerOptions，JVM 17 目标保持一致。 |
| D19 Lang | 最终复查发现 Compress 1.26.0 新引入 commons-lang3 3.14.0，命中 [GHSA-j288-q9x7-2f5v](https://github.com/advisories/GHSA-j288-q9x7-2f5v)，修复下限 3.18.0。ClassUtils.getClass 的超长输入可造成递归栈溢出；实际构建入口可达性待确认。定向升级到 3.18.0 后再次验证构建与依赖公告，避免升级造成新的间接命中。 |

同主版本构建库替换在根 buildscript.classpath 中执行，不对 APK implementation 依赖强行 override；Kotlin 编译插件更新会同步解析其标准库，最终 APK 依赖另行导出扫描。较新 AGP 自带修复链后应重新评估并删除已不需要的定向版本规则，避免长期压住上游的新安全版本。

- **D05 Vite（已修复）**：5.4.21 命中[Windows fs.deny 绕过](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)、[source map 路径穿越](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)、[Windows UNC/NTLM 泄露](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)。获批准后升级到覆盖这些公告的 6.4.3，原有 React 插件继续兼容，现有 check 通过。开发服务器仍默认回环；静态生产 bundle 不运行开发服务器。
- **D06 Drizzle ORM（已修复）**：0.38.4 命中[GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)，修复下限 0.45.2，获批准后升级到实际解析的 0.45.3。原代码只用静态 schema，未发现攻击者可控 alias；安全更新仍消除了依赖公告命中。类型检查和 8 张表的独立 schema 生成通过，没有执行 db:push 或修改实际数据库。
- **D07 esbuild（已修复）**：[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)，修复下限 0.25.0。升级 Kit 至 0.31.11 后，旧 @esbuild-kit/core-utils 仍引入 0.18.20；因此按已批准的兼容迁移，在根和 desktop 清单分别定向 override 为 ^0.25.4，覆盖 workspace 和独立安装两种路径。实际锁版本只有 0.25.12/0.28.2；构建、schema 生成、测试通过。旧 loader 的停止维护警告仍存在，应跟踪上游清理，不能将 audit 为 0 等同于维护状态正常。
- **D08 glib 0.18.5**：[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)，VariantStrIter 内存安全问题，修复 >=0.20.0；GHSA-wrw7-89jp-8q8g 是同一问题。出现在 Tauri Linux GTK 依赖链；当前 Windows 构建不启用该平台路径，项目未直接调用该迭代器。需要由上游平台链一起迁移。
- **D09 停止维护间接依赖**：proc-macro-error 1.0.4（RUSTSEC-2024-0370）；unic-char-property/common/range/ucd-ident/ucd-version 0.9.0（RUSTSEC-2025-0081/0080/0075/0100/0098）。这些公告是维护状态，不能都解释为可利用的 High 漏洞。请跟踪 Tauri/HTML 解析构建链的替代版本。
- **D10 sherpa-rs 0.5.1**：[官方仓库](https://github.com/thewh1teagle/sherpa-rs/issues)显示于 2026-06-06 归档。直接依赖的 download-binaries/static 功能会带入原生 sherpa/ONNX 制品；这类二进制的完整组成与漏洞覆盖待确认，不能靠 Cargo OSV 零命中宣告安全。

未发现能够确认的仿冒包。Baileys npm 元数据指向 WhiskeySockets 官方仓库；rc14 为预发布版本，应持续跟踪稳定版本。qrcode 1.5.4、franc-min 6.2.0、clsx 2.1.1 的当前版本发布时间较早，但仅发布时间不足以证明项目停止维护。Tauri shell 当前 2.3.5 已超过[历史 open 注入公告修复版本 2.2.1](https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp)，不能报为当前漏洞。

本地 npm audit：此前修复后曾为 0；2026-10-03 重新查询发现新完成审查的 braces 公告，根锁为 5 条 High，均为同一漏洞及父依赖传播。OSV 对三个 npm 锁也命中 braces 3.0.3，暂无修复版本，不能继续宣称 npm 零命中。开发者已批准暂时保留并记录边界。Rust 仍有 glib 和维护状态公告；未安装 cargo-audit，因此采用锁定版本逐项 OSV/RustSec 交叉核对，不声称运行了 cargo-audit。

## 4. 代码与密钥修复的理由、利用条件

- **C01 前端环境变量**：旧 envPrefix 接受 TAURI_，签名阶段注入的 TAURI_SIGNING_PRIVATE_KEY/PASSWORD 可被前端 import.meta.env 公开，开发模式还可能包含整个对象。[Tauri 官方配置泄露公告](https://github.com/tauri-apps/tauri/security/advisories/GHSA-2rcp-jvr4-r259)强调必须修配置，仅升级 CLI 不够。改为只允许 VITE_；构建配置仍读取进程环境，保留既有行为。当前扫描没有确认签名私钥泄露；旧 debug 构建和旧产物待确认。
- **C02 CORS**：全局 * 改为精确的 localhost:3000/127.0.0.1:3000 与 Tauri 本地来源，拒绝恶意来源/null/前缀碰撞，加入 Vary: Origin 与 Cache-Control: no-store。无 Origin 的 native 客户端仍需令牌。原实现已有令牌且监听回环，未发现纯网页无令牌越权，因此将此项定为防御加固 Medium。
- **C03 请求边界**：40 MiB 按原始字节累计后解码 UTF-8，JSON 必须为对象，格式错误返回 400、过大返回 413。旧 /restart 将畸形 JSON 捕获为 {}，可能触发默认 clearAuth 并清除登录状态；认证客户端的错误请求即可触发，改为立即拒绝。
- **C04 下载内存**：旧媒体与头像先下载完整 buffer 后判断大小，恶意响应可在上限检查前耗尽内存。改为共享 readBoundedStream，在读取时停止，保留既有媒体体积上限，头像 3.5 MB/30 秒。未加新依赖。
- **C05 主动文档**：远程联系人发送 HTML/SVG/XHTML 等附件，用户点击打开可能被转为继承桌面来源的 Blob 文档；与原生 IPC 权限组合风险较高，实际 WebView 执行链待确认。只预览明确的图片/音视频/PDF MIME，其余下载；打开/下载入口同时拒绝 javascript:/file:/vbscript: 等协议。外部 HTTPS URL 仍保留外链功能。
- **C06 ffmpeg**：攻击者控制播放列表时，自动探测可能引用网络或其他本地文件。所有自有转码入口设置 file,pipe 协议白名单；音频限制为明确的普通媒体 demuxer，波形强制 OGG、GIF 强制 GIF，拒绝 HLS/concat 播放列表。发现 SDK 视频缩略图路径使用未经保护的 shell ffmpeg，现由自有 argv spawn + 协议/demuxer 白名单替代；缩略图限制 32×32 边界、10 秒超时。显式提供 jpegThumbnail，失败为空缩略图，防止 SDK 重试不安全路径。它仍不是 OS 沙箱，原生解码器自身漏洞/进程内存消耗需持续关注。
- **C07 模型解压**：模型名字不再有静默清洗碰撞，拒绝路径、Windows ADS/设备名、尾点和非法字符。只允许目录/普通文件，拒绝链接/特殊条目、路径穿越，限制 10,000 个条目、4 GiB 解压数据与总读取预算、512 MiB 压缩包。利用条件是导入恶意模型或下载源被替换；不宣称 tar 当前版本已证明绕过 unpack_in。通过暂存目录先解包和验证 ONNX，再替换旧模型，失败保留旧模型，避免格式错误先删旧数据。
- **C08 Android**：恶意本地客户端发送无换行超大行，或第三方分享 URI 提供超大输入流，可在原检查前分配大量内存。新增标准库 Java 有界读取工具：鉴权 64 KiB 字符、业务消息 16 MiB 字符、分享文件 8 MiB 字节。分享只接受 content:；空配置令牌不能通过鉴权。补齐 MainActivity 所需 BridgeApp import。
- **C09 Rust Bridge**：握手原有 64 KiB 边界，握手后的 read_line 仍无上限。已改为最多读取 16 MiB+1 字节，超过上限关闭连接；恶意或被替换的 Bridge 服务不再通过单行制造无界 String。不会默默截断后继续处理。
- **C10 CI**：现有 CI/release 所有第三方 Action 由可移动 tag/branch 改为核实后的完整提交 SHA，保留原版本标签注释。补充 Java 安全检查步骤，并修正 Android Gradle 工作目录，增加 assembleDebug 验证。未发现 pull_request_target；CI contents:read，release 的 contents:write 仅保留发布所需范围。固定 Action 不等于固定其下载的编译器、操作系统镜像和所有外部制品；更新后的云端 CI 尚未运行。
- **C11 日志**：HTTP catch 不再输出完整 SDK 错误对象及带参数 URL，只记录方法、错误类型和状态；移除音频 data URL 的内容前缀。避免请求体/电话号码/令牌被 SDK 错误附带写日志。其他诊断日志仍可能含 JID/联系人元数据，应按个人数据设置保留期限。
- **C14 环境文件**：忽略 .env.* 并显式保留 .env.example / .env.*.example，忽略审计 npm 缓存；模板只有变量名与空值，现有程序继续从环境读取。git 索引未发现真实 .env/.pem/.key/.p12/.jks 被跟踪。
- **C15 连接并发（继续审核时新增修复）**：原实现每个客户端和响应都新建线程，攻击者不需要令牌便可通过大量本地连接制造线程增长；认证后不读响应还能阻塞同步广播。使用标准库有界线程池：客户端处理 4 个、待处理连接 8 个；响应处理 2 个、排队 32 个。过载立即关闭相关连接，活动写入超过 30 秒关闭 socket；超时任务完成后取消并移出定时队列。停止服务关闭所有连接（包括未鉴权/待处理连接），并停止线程池。广播和回复共享后台写入路径，避免堵塞 Android 主线程。独立 Java 检查覆盖两个队列的饱和拒绝/关闭及停滞响应超时；Android 完整 APK 编译后续验证通过。
- **C12 SSRF（获批准后修复）**：新增唯一公共 HTTPS 下载入口，拒绝明文 HTTP、凭据 URL、非 443 端口、回环/私网/链路本地/共享/保留/文档/IPv6 映射与转换地址。检查全部 DNS 答案，任一不安全即拒绝；通过 custom lookup 将校验结果绑定至实际 TLS 连接，保留域名 SNI/证书校验，禁止 agent 连接池复用。最多 5 跳重定向，每跳重新验证 URL/DNS；30 秒总时限且读取时执行既有大小上限。发送图片/音频/文件/GIF、商品图片、头像共享此入口并向 SDK 传递 Buffer。入站只接受 WhatsApp/CDN 初始主机；安全下载有界密文后由原 SDK 在内存解密，不自行实现密码算法；404/410 重上传后重新执行全部校验。回归测试覆盖混合 DNS、重绑定、IPv4 编码/IPv6 映射绕过、私网重定向、密文解密、重上传和真实 HTTPS lookup 行为，Node/Bun 均通过。
- **C13 Bridge 传输（获批准后修复）**：保留系统域名解析后，校验实际目标 IP 为 loopback，且检查在建立 TCP/发送令牌之前；非回环主机返回明确错误。USB/ADB 的 127.0.0.1 连接仍可用。Android 服务原有回环绑定继续保留；usesCleartextTraffic 不承担原始 TCP 的保护。新的 Rust 测试验证 IPv4/IPv6 远程地址拒绝。
- **C17 下载队列（继续审核新增）**：媒体入口需要已鉴权且连接中的账号，但连续媒体重试仍可堆积无上限等待任务、请求和消息引用，导致内存/响应资源耗尽。共享调度器保留 3 个并发，将等待任务限制为 64；满队列明确拒绝并返回 HTTP 503、Retry-After: 5，未修改既有媒体体积限制。测试实际保持下载未完成，提交 100 个任务，确认 67 个接受、33 个明确拒绝、并发峰值 3、释放后可重试；另验证真实 HTTP 端点的状态和响应头，Node/Bun 均通过。
- **C18 凭据落盘**：现有 AI/API 配置使用 Windows DPAPI，但 Baileys 的 useMultiFileAuthState 直接保存会话 JSON，SQLite 与 WAL 直接保存业务数据。利用需要读取应用数据目录或获得未加密备份/离线磁盘副本；未确认其他 OS 用户能读到生产目录，也未发现远程免鉴权读取，因此不能称为远程凭据泄露。建议优先制定不含会话密钥的备份策略；全面静态加密必须同时处理旧格式迁移、WAL、回滚和恢复密钥，未经选择不自动迁移。加密不能抵御已控制当前登录账户的攻击者。

没有确认项目自有硬编码生产 API Key/私钥。最终扫描 1,240 个文件，覆盖当前构建 EXE 与 dist，三个候选已核对：Google 格式字符串与 node_modules/baileys/lib/WABinary/constants.js:600 的公开协议字典一致；AWS 格式串是约 961,808 字符编码 token 中的偶然片段；新增媒体安全测试使用 example.com 和占位用户名/密码验证拒绝带凭据 URL，不是真实凭据。未输出真实候选值，未擅自作废上游公开字典内容。更新器 pubkey 是公钥，不是泄露；mock dev-bridge-token 是本地开发测试默认值，不应用于生产。

**任何已经提交或泄露过的真实密钥必须到对应平台作废并重新生成，只删除代码不够。** 本次未掌握密钥管理平台状态，也未轮换凭据。如果旧构建曾包含更新签名私钥，需同时规划客户端信任公钥/更新签名迁移，不能只改 CI Secret。

历史扫描证据：secret-history-scan.json。132 个提交中的 2,228 个去重 blob 逐个扫描，唯一候选是媒体安全测试的 example.com 占位凭据；未发现扫描规则能识别的真实历史凭据。脚本只输出对象 ID、位置、规则与行号，不输出疑似密钥值，不改写 Git 历史。

## 5. 已决定事项与仍待决定事项

| 决策 | 可选方案 | 建议与未执行原因 |
|---|---|---|
| Vite/Drizzle/esbuild 迁移（已决定） | 已选择 A：升级 Vite/Drizzle/Kit，并定向修复 loader esbuild | 已获批准并完成，最终版本和兼容检查见 D05–D07；没有执行生产数据迁移。 |
| glib 与停止维护构建链 | A：随 Tauri/Linux 上游升级到 glib >=0.20；B：保留 Windows 发布，登记 Linux 阻断项 | Windows 当前可优先 B，新增 Linux 发布前必须 A；不可强行 override GTK ABI。 |
| 远程媒体 SSRF（已决定） | 已选择 A：公共 HTTPS、DNS/每跳重定向校验，入站初始主机限定 WhatsApp/CDN | 已获批准并完成；HTTP、内网和非 443 地址会被明确拒绝。既有远程媒体链接如依赖这些地址，需要改为公共 HTTPS 或上传本地文件。 |
| Bridge 网络传输（已决定） | 已选择 A：USB/ADB 回环连接，拒绝非回环 IP | 已获批准并完成；不再支持直接明文 LAN 连接。恢复 LAN 功能需先设计 TLS 与服务器身份验证。 |
| sherpa-rs 归档 | A：迁移到有维护的官方绑定/自有受控封装；B：维护固定版本 fork 并固定原生制品校验；C：移除本地转写 | 推荐先评估 A，短期 B。C 删功能，大范围迁移未经授权不执行。 |
| 本地凭据/账号文件 | A：维持当前 OS 账户/目录保护、DPAPI 与禁备份策略；B：扩展到 Baileys 会话文件/数据库的静态加密 | 取决于威胁模型。当前存在 Baileys 会话 JSON 和业务数据落盘；本机账户或磁盘失守时仍有风险。B 涉及格式迁移/恢复机制，不擅自进行。 |

开发者后续已批准 Vite/Drizzle/esbuild 兼容迁移、公共 HTTPS 媒体策略和仅回环 Bridge，本次均完成。其余 glib/Linux 链、归档语音依赖、凭据格式迁移仍保留待决定。密钥轮换需要开发者在对应平台执行。

## 6. 验证与剩余风险

- `npm run check`：2026-10-03 重跑通过，最终 262 个现有/新增 Node 测试、TypeScript/Vite 6 前端构建、506 模块 Bun sidecar 编译、mock Bridge smoke。新增模型下载行为测试覆盖有/无进度回调、伪造 Content-Length、流中超限、取消读取和正常字节上传。首次本轮构建因清理已有 dist 文件出现 EPERM，允许工作区生成文件清理后重跑完整 check 成功。Vite 大 bundle 提示为性能警告，不是测试失败。
- `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`：最新重跑通过，22 个测试（Bridge 4、数据库 12、协议 2、安全/模型 4）；包括超长行拒绝、非回环鉴权阻断、模型归档检查、官方/旧式词表文件名及残缺模型拒绝。本轮设置隔离官方 Tiny 模型目录，还用未升级的当前产品引擎成功识别官方样例，见第 10 节。保留原有 dead_code 警告。
- Drizzle：用 `npm exec -w wap-plus-crm -- drizzle-kit generate --dialect=sqlite --schema=./src/db/schema.ts --out=../docs/security/schema-check` 在临时目录验证 8 张表，成功。没有对实际数据库执行迁移；检查后删除临时 SQL/snapshot 输出，保留日志。
- Bun 1.3.14：9 个媒体安全测试通过；真实 HTTPS 测试验证 custom lookup 确实绑定地址，另对 example.com 的公共 HTTPS 下载保留 TLS 校验并成功。测试最初采用 node:test mock API，Bun 不支持该 API，随后改为可恢复的函数替换，Node/Bun 均通过；没有通过关闭 TLS 绕过兼容问题。
- Java 有界输入与并发检查：`javac -d <临时目录> android/app/src/main/java/com/wapplus/bridge/net/BoundedInput.java android/app/src/main/java/com/wapplus/bridge/net/BridgeWorkers.java android/app/src/test/java/com/wapplus/bridge/net/BoundedInputCheck.java`，随后 `java -ea -cp <临时目录> com.wapplus.bridge.net.BoundedInputCheck`，通过。该独立 main/assert 检查并非 JUnit，Gradle 不会自动发现它，已用独立 CI 步骤执行。
- Android：2026-10-03 用 `--dependency-verification strict :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease buildEnvironment` 重跑通过，90 个任务全部执行。debug APK 和未签名 release APK 均已生成，未发布。沿用本次进程的 JAVA_TOOL_OPTIONS 指定 jdk.net.unixdomain.tmpdir 至工作区临时目录，未写入产品配置；参数依据 [OpenJDK 源码](https://github.com/openjdk/jdk21u/blob/master/src/java.base/windows/classes/sun/nio/ch/UnixDomainSocketsUtil.java)。Gradle 单元测试任务完成，不代表自动执行独立 main/assert Java 安全检查；该检查上一轮已单独通过。未连接真机/模拟器执行 AGP UTP 设备测试，故内部测试工具升级的设备端兼容性仍待确认。现有 AccessibilityNodeInfo.recycle 弃用与 Gradle 9 不兼容提示属于后续维护项。
- 制品验证：686 个 Gradle JAR/AAR/POM/module 文件 SHA-256 全部匹配官方 Google Maven、Maven Central 或 Gradle Plugin Portal，未接受不匹配的值；反例测试在隔离工程中确认错误校验值被 Gradle 拒绝、官方校验值通过。校验工具离线行为检查也通过。证据见 gradle-official-verification.json、android-verified-build.log、gradle-checksum-negative.log、gradle-checksum-positive.log。
- `git diff --check`：通过；保留工作区原有修改，不创建提交、不部署发布。
- 当前源码未发现可达的字符串拼接 SQL 注入、经 shell 的用户参数命令注入、eval 处理用户输入、关闭 TLS 校验或下载远程 JavaScript 执行。数据库参数绑定、React 默认转义、原有 CSP/令牌/回环监听/签名更新器属于已有保护。这不是对未知漏洞的零风险保证。
- Android 无上限连接/响应线程与媒体下载等待队列已加固；仍需在真实 APK 做并发/慢读客户端集成测试。消息分发器和辅助功能的业务回调队列没有因此获得全链路速率限制；整体缓存和不同账号总资源仍需按实际消息量做压力测试。
- Baileys 的可选 link-preview-js 当前未安装，且应用未调用 groupInvite 媒体生成分支；这些 SDK 功能可能存在额外自动网络请求。以后启用自动链接预览/群邀请缩略图时，必须先接入相同的安全下载边界，不能只验证最外层 URL。
- Android 新增锁文件补齐内部 UTP 配置后发现旧 Netty、Protobuf、commons-io，已在 app 专属工具配置中分别更新至 4.1.137.Final、3.25.5、2.15.1，不强制覆盖 APK 的业务运行时。最终 294 个 Maven 版本逐项查询 OSV，命中为 0。修复前证据见 osv-before-utp-fixes.json，当前见 osv-audit.json。全生态 1,286 个版本仍命中 braces、Linux glib 与 Rust 停止维护项；不是零漏洞结论。
- 最新根 `npm audit` 报告 5 条 High，均属于同一个 braces 公告及其 chokidar/fast-glob/micromatch/Tailwind 依赖链，不能重复计作 5 个独立漏洞。上一轮 npm 无命中是当时数据库结果，现已被新公告复核结果替代。开发者已选择暂时保留，无公布修复版本，不执行工具建议的 Tailwind 大版本升级。
- FFmpeg、sherpa/ONNX、bundled SQLite、系统 WebView2 的本机版本已取证，详情见下方补充及 native-inventory.json。原生构建内其他库、最终安装包及所有用户机器的版本没有因此获得完整 SBOM/漏洞覆盖。
- Gradle 已增加实际版本锁及官方制品哈希校验，镜像顺序保留。npm/Cargo 生命周期脚本、Hosted Runner/编译器 stable 通道和本地 sherpa 解压缓存仍是供应链面；官方仓库被攻陷或维护者主动发布恶意新版本也不能只靠初次 HTTPS/hash 核对排除。
- 日志、会话数据库和导出文件包含客户个人数据；需明确备份加密、目录权限与保留期。原生 IPC 能读文件属于本地桌面功能，若将不可信页面赋予相同权限会放大 XSS；不要给远程页面授予当前本地 capability。

## 7. 全部直接依赖与关键锁定版本

下列版本来自实际锁条目；声明范围和完整传递树保存在 dependency-inventory.json。Rust 同名多版本时，直接项按 Cargo.toml 范围选择匹配版本；其余版本属于间接依赖。

### npm：全部 28 项

| 清单 | 用途 | 依赖 | 声明范围 | 锁定版本 |
|---|---|---|---|---|
| desktop/package.json | 运行时 | @tauri-apps/api | ^2.0.0 | 2.11.1 |
| desktop/package.json | 运行时 | @tauri-apps/plugin-notification | ^2.0.0 | 2.3.3 |
| desktop/package.json | 运行时 | @tauri-apps/plugin-shell | ^2.0.0 | 2.3.5 |
| desktop/package.json | 运行时 | @tauri-apps/plugin-updater | ^2.11.0 | 2.11.0 |
| desktop/package.json | 运行时 | clsx | ^2.1.1 | 2.1.1 |
| desktop/package.json | 运行时 | drizzle-orm | ^0.45.3 | 0.45.3 |
| desktop/package.json | 运行时 | emoji-picker-react | ^4.18.0 | 4.18.0 |
| desktop/package.json | 运行时 | franc-min | ^6.2.0 | 6.2.0 |
| desktop/package.json | 运行时 | lucide-react | ^0.468.0 | 0.468.0 |
| desktop/package.json | 运行时 | react | ^18.3.1 | 18.3.1 |
| desktop/package.json | 运行时 | react-dom | ^18.3.1 | 18.3.1 |
| desktop/package.json | 运行时 | react-virtuoso | ^4.18.11 | 4.18.11 |
| desktop/package.json | 运行时 | tailwind-merge | ^2.5.5 | 2.6.1 |
| desktop/package.json | 运行时 | zustand | ^5.0.2 | 5.0.14 |
| desktop/package.json | 开发 | @tauri-apps/cli | ^2.0.0 | 2.11.4 |
| desktop/package.json | 开发 | @types/react | ^18.3.12 | 18.3.31 |
| desktop/package.json | 开发 | @types/react-dom | ^18.3.1 | 18.3.7 |
| desktop/package.json | 开发 | @vitejs/plugin-react | ^4.3.4 | 4.7.0 |
| desktop/package.json | 开发 | autoprefixer | ^10.4.20 | 10.5.4 |
| desktop/package.json | 开发 | drizzle-kit | ^0.31.11 | 0.31.11 |
| desktop/package.json | 开发 | postcss | ^8.4.49 | 8.5.28 |
| desktop/package.json | 开发 | tailwindcss | ^3.4.16 | 3.4.19 |
| desktop/package.json | 开发 | typescript | ^5.6.3 | 5.9.3 |
| desktop/package.json | 开发 | vite | ^6.4.3 | 6.4.3 |
| desktop/baileys-bridge/package.json | 运行时 | baileys | 7.0.0-rc14 | 7.0.0-rc14 |
| desktop/baileys-bridge/package.json | 运行时 | pino | 10.3.1 | 10.3.1 |
| desktop/baileys-bridge/package.json | 运行时 | qrcode | 1.5.4 | 1.5.4 |
| desktop/baileys-bridge/package.json | 开发 | bun | 1.3.14 | 1.3.14 |

### Rust：全部 20 项声明

| 依赖 | 用途 | 直接锁定版本 |
|---|---|---|
| tauri-build | 构建 | 2.6.3 |
| tauri | 运行时 | 2.11.5 |
| tauri-plugin-shell | 运行时 | 2.3.5 |
| tauri-plugin-notification | 运行时 | 2.3.3 |
| tauri-plugin-single-instance | 运行时 | 2.4.4 |
| tauri-plugin-updater | 运行时 | 2.11.0 |
| serde | 运行时 | 1.0.229 |
| serde_json | 运行时 | 1.0.151 |
| tokio | 运行时 | 1.53.1 |
| uuid | 运行时 | 1.24.0 |
| chrono | 运行时 | 0.4.45 |
| thiserror | 运行时 | 2.0.19 |
| tracing | 运行时 | 0.1.44 |
| tracing-subscriber | 运行时 | 0.3.23 |
| rusqlite | 运行时 | 0.32.1 |
| tar | 运行时 | 0.4.46 |
| bzip2 | 运行时 | 0.4.4 |
| sherpa-rs | 运行时 | 0.5.1 |
| tauri-winrt-notification | Windows | 0.7.3 |
| windows-registry | Windows | 0.6.1 |

### Android：全部直接声明

| 依赖/工具 | 声明版本 | 实际解析状态 |
|---|---|---|
| com.android.application | 8.7.2 | 8.7.2；完整 classpath 已导出扫描 |
| org.jetbrains.kotlin.android | 2.4.20 | 2.4.20 |
| org.jetbrains.kotlin.plugin.compose | 2.4.20 | 2.4.20 |
| androidx.compose:compose-bom | 2024.10.01 | 2024.10.01 |
| androidx.compose.ui:ui | BOM 管理 | 1.7.5 |
| androidx.compose.ui:ui-tooling-preview | BOM 管理 | 1.7.5 |
| androidx.compose.material3:material3 | BOM 管理 | 1.3.1 |
| androidx.activity:activity-compose | 1.9.3 | 1.9.3 |
| androidx.lifecycle:lifecycle-runtime-ktx | 2.8.7 | 2.8.7 |
| androidx.core:core-ktx | 1.15.0 | 1.15.0 |
| org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.9.0 | 1.9.0 |
| com.squareup.okhttp3:okhttp | 4.12.0 | 4.12.0 |
| org.jetbrains.kotlinx:kotlinx-serialization-json | 1.7.3 | 1.7.3 |
| androidx.compose.ui:ui-tooling (debug) | BOM 管理 | 1.7.5 |
| Gradle Wrapper | 8.14.5 | 已下载并校验 |

Android 直接声明已搜索，运行时、构建 classpath、app 完整配置锁合并 294 个实际 Maven 版本已逐项查询 OSV。全部坐标和解析版本见 dependency-inventory.json 的 Maven 条目；其中运行时 kotlin-stdlib 为 2.4.20，Gradle 构建 classpath 的内嵌 Kotlin 约束仍解析 2.0.21，两者没有混算。构建及内部设备测试工具依赖修复见 D11–D19 和补充审核，这不是无漏洞结论。

### 关键间接依赖（修复后）

| 生态 | 名称 | 所有锁中实际版本 |
|---|---|---|
| npm | sharp | 0.35.5 |
| npm | nanoid | 3.3.19 |
| npm | esbuild | 0.25.12, 0.28.2 |
| npm | ws | 8.21.2, 8.21.1 |
| npm | protobufjs | 7.6.5 |
| crates.io | rustls | 0.23.45 |
| crates.io | reqwest | 0.13.4 |
| crates.io | glib | 0.18.5 |
| crates.io | proc-macro-error | 1.0.4 |
| crates.io | unic-char-property | 0.9.0 |
| crates.io | unic-char-range | 0.9.0 |
| crates.io | unic-common | 0.9.0 |
| crates.io | unic-ucd-ident | 0.9.0 |
| crates.io | unic-ucd-version | 0.9.0 |
| crates.io | sherpa-rs-sys | 0.5.1 |
| crates.io | libsqlite3-sys | 0.30.1 |

### 依赖清单/锁的精确位置

| 条目 | 文件:行 |
|---|---|
| vite | desktop/package.json:7 |
| drizzle-orm | desktop/package.json:25 |
| drizzle-kit | desktop/package.json:11 |
| sherpa-rs | desktop/src-tauri/Cargo.toml:39 |
| node_modules/sharp | package-lock.json:4461 |
| node_modules/nanoid | package-lock.json:4067 |
| node_modules/esbuild | package-lock.json:3703 |
| node_modules/vite | package-lock.json:5263 |
| node_modules/drizzle-orm | package-lock.json:3558 |
| name = "rustls" | desktop/src-tauri/Cargo.lock:3234 |
| name = "glib" | desktop/src-tauri/Cargo.lock:1444 |
| name = "proc-macro-error" | desktop/src-tauri/Cargo.lock:2953 |

## 8. 2026-10-03 供应链与原生组件补充

### 本轮具体修改、原因与验证

1. **C16：Gradle 版本与制品锁定。** `android/build.gradle.kts:3` 为构建 classpath 启用 dependency locking；`android/app/build.gradle.kts:63` 锁定 app 全部已解析配置。新增 `android/buildscript-gradle.lockfile`、`android/app/gradle.lockfile` 和 `android/gradle/verification-metadata.xml`。保留镜像优先顺序，但镜像提供的 bytes 必须匹配受审查的官方哈希，避免同坐标制品被替换。元数据校验开启，未添加通配信任或跳过规则；这是 SHA-256 固定，不是 PGP/发布者签名验证。
2. 初始生成的哈希不直接当作可信基线。`tools/security-verify-gradle-artifacts.py` 使用 Python 标准库对 Google Maven/Maven Central/Gradle Plugin Portal 逐文件重新下载计算 SHA-256，仅全部匹配才允许 `--apply`。686 个制品全部核对成功；Android AAR 的 `-release` 元数据文件名与 Maven 实际文件名作明确映射，Kotlin 插件 marker POM 的官方仓库差异按匹配的官方来源记录，没有接受不匹配内容。
3. **D11/D13/D15：补齐设备测试工具配置。** 全配置锁暴露出 `_internal-unified-test-platform-*` 中仍有 Protobuf 3.22.3、Netty 4.1.93.Final、commons-io 2.13.0。原 root buildscript 的规则不覆盖这些配置；`android/app/build.gradle.kts:67` 增加限定此工具配置的同分支版本解析规则，固定为 3.25.5、4.1.137.Final、2.15.1。公告、风险和利用前提同 D11/D13/D15；不把它们误报为 APK 运行时新增漏洞。真实模拟器/设备 UTP 测试未运行，兼容性待确认。
4. `tools/security-dependency-audit.mjs` 增加 Gradle 锁文件解析，记录实际坐标及所属配置，避免以后只扫描 debugRuntimeClasspath 而漏掉构建/设备工具链。最终 Maven 294 个实际版本 OSV 无命中；原始命中保存在 `osv-before-utp-fixes.json`。
5. `.github/workflows/ci.yml:45` 显式使用 `--dependency-verification strict`，CI 不自动生成或放宽信任基线。隔离临时工程的错误 SHA-256 被 Gradle 拒绝，官方值通过；正常严格模式 Android 测试及 debug/release 构建通过。
6. **C19：前端模型下载资源耗尽。** 原 `downloadSpeechModel` 在 Rust 512 MiB 上限前会无限收集响应，有无进度回调分别走流和无界 arrayBuffer。`desktop/src/lib/localSpeech.ts:59,78` 统一有界流读取：拒绝超过 512 MiB 的 Content-Length，实际流累计也检查同一上限，15 分钟超时，失败取消读取并释放 reader。利用需下载服务器/响应链提供超大或持续数据，可能使 WebView 内存耗尽；未复现产品端崩溃。`desktop/tests/speech-download-security.test.mjs` 用真实导出函数测试两种进度模式、虚假长度、流超限、无 IPC 落盘和正常下载。完整 npm 检查 262 个测试及构建通过。

### 新公告与开发者已决定的例外

**D20 braces 3.0.3**：[GitHub Reviewed GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，High，影响 <=3.0.3，公布修复版本为 None；2026-10-02 完成 GitHub review，本轮 OSV/npm 都命中。[上游问题](https://github.com/micromatch/braces/issues/70)说明递归树遍历缺乏深度保护，嵌套模式能导致栈耗尽。真实依赖链见 `braces-dependency-path.json`：Tailwind/fast-glob/micromatch 及开发文件监视器。当前 `desktop/tailwind.config.js:27` 的内容 glob 是固定配置；未发现聊天正文或 HTTP 输入被传给 braces 模式解析，但没有因此证明所有未来配置安全。npm audit 的根和 desktop 各 5 条 High 是同一根因的传播，sidecar 为 0。

开发者已明确选择「暂时保留，记录风险与输入边界」。不执行 npm 推荐的 Tailwind 4 大版本迁移，不自行改第三方包源码或删功能。后续选项：A，保留并避免从非可信输入构造 glob；B，独立验证替换构建链/上游受维护修复方案。建议当前 A，关注上游发布；如业务引入用户可控 glob，重新评估并在入口限制结构。

### 原生组件实际清单与剩余风险

版本、文件路径、大小和 6 个文件 SHA-256 保存在 `native-inventory.json`。清单来自当前 Windows 主机和 Cargo 锁定源码，不能代表最终安装包或全部用户环境。

| 组件 | 确认版本/来源 | 风险条件、处理与状态 |
|---|---|---|
| SQLite | libsqlite3-sys 0.30.1 的 bundled sqlite3.h 明确为 **3.46.0**；rusqlite 0.32.1 | **D21，Medium，建议关注。** [官方 CVE 表](https://www.sqlite.org/cves.html)列出 concat_ws() 堆写越界在 3.49.1 修复、恶意 FTS5 数据库整数溢出在 3.50.3 修复。项目 SQL 由应用控制并参数绑定，未找到 concat_ws() 调用或直接导入任意 SQLite 文件，备份恢复是 JSON；FTS5 确实启用。没有证明当前远程可利用。绑定/SQLite 更新需兼容迁移，未静默跨 0.x 版本升级。后续若开放原始数据库导入，必须重新审查。 |
| sherpa-onnx / ONNX Runtime | sherpa-rs-sys 0.5.1 的 dist.txt 固定 sherpa **1.10.28** Windows static 制品 SHA-256；[官方标签构建配方](https://github.com/k2-fsa/sherpa-onnx/blob/v1.10.28/cmake/onnxruntime-win-x64-static.cmake)指定 **ONNX Runtime 1.17.1** | **D10，归档维护与供应链风险。** Cargo 构建脚本对新下载验证 SHA-256，但存在的解压目录或 SHERPA_LIB_PATH 会跳过下载验证；当前缓存静态库已记录哈希，尚未逐文件与官方固定归档比较。旧 shared DLL 不作为当前 static 版本证据。[Microsoft Runtime 安全页面](https://github.com/microsoft/onnxruntime/security)未列公开 advisories，不能据此宣称无漏洞，也不能把独立 ONNX Python 包公告直接套到 Runtime。建议维护受控新版本及原生锁；涉及引擎/ABI 迁移，待决定。 |
| FFmpeg / ffprobe | PATH 指向 **C:/ffmpeg/bin/**；版本 **2025-10-19-git-dc39a576ad-essentials_build-www.gyan.dev**；libavcodec 62.16.100 | **D22，Medium，具体公告影响待确认。** 输入包含非可信音视频，格式/协议限制和超时已修复，但不能消除解码器内部内存错误。[官方安全页面](https://ffmpeg.org/security.html)提供后续修复提交，[下载页面](https://ffmpeg.org/download.html)当前列出稳定 9.0.2。Git 快照不能直接等同某个稳定版本范围；未逐一验证 dc39a576ad 的修复提交包含情况，不宣称确认某 CVE 影响。建议固定受维护发行版并验证音频转码、波形、GIF/缩略图；9.x 升级及替换系统文件会影响兼容性/其他程序，未擅自执行。 |
| WebView2 | 本机 msedgewebview2.exe **154.0.4258.48** | [Microsoft Runtime 发布说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime/)当前列 154 分支；本机版本不能替代所有部署主机的更新状态。未确认自动更新策略，未将 Edge Stable 的小版本差异直接报作 WebView2 漏洞。建议维持 Evergreen 更新并在发布环境核实。 |
| Whisper tiny/base 模型归档 | 官方 Releases API 中大小分别 **116,204,861 / 207,557,382 bytes**，digest 为 null | `speech-model-release-assets.json` 保存证据。当前依靠 HTTPS 官方 URL，未找到可用发布者摘要/签名基线，模型真实性完整验证仍待确认；解压资源/路径已限制，本轮另加前端下载上限。不把自行计算的首次下载 hash 描述为发布者签名。建议获得可信摘要后固定模型版本和校验值。 |

剩余选择：保持当前原生版本并记录限制，或先制定 SQLite/语音引擎/FFmpeg 的兼容升级方案后验证再迁移；建议后者，系统 FFmpeg 替换需单独明确范围。glib/Linux 链与本地静态加密仍沿用第 5 节的待决定项。本轮没有发现新的已确认真实密钥泄露；已泄露过的密钥仍必须到对应平台作废重建。

### 后续维护命令与信任边界

- 常规构建：`android/gradlew.bat -p android --dependency-verification strict :app:testDebugUnitTest :app:assembleDebug`。检查应消费已审核基线，不能通过重新写哈希消除错误。
- 依赖复核：`node tools/security-dependency-audit.mjs --online`、三个 npm 安装路径的 `npm audit --json`；数据库会更新，报告中的「零命中」仅对该次范围和时间成立。
- 有意升级依赖时，在受控环境更新 lock/verification metadata，再运行 `python tools/security-verify-gradle-artifacts.py --apply` 核对全部官方 bytes，人工审查坐标/版本/来源/锁差异后严格构建。工具只在全量匹配时写基线；它不能证明官方维护者发布的内容本身无恶意。
- 如果严格校验提示新制品或哈希变化，先核对官方来源与原因，不增加 wildcard trust、不禁用 metadata verification、不在 CI 自动 `--write-verification-metadata`。

## 9. 已授权的原生兼容升级方案与隔离测试

开发者明确选择「先做兼容升级方案与测试，不修改系统 FFmpeg」。本节为该授权的完成结果：候选工程在 `docs/security/native-compatibility/`，原生库/模型/FFmpeg 仅放在被忽略的 `.audit-cache/` 下，未修改产品 Cargo.toml/Cargo.lock 中的原生版本、用户数据库或系统 FFmpeg。测试工程标记 `publish = false`，独立 Cargo.lock 已保留以供复现。

| 组件 | 建议候选与具体迁移点 | 已执行验证 | 尚未覆盖/迁移门槛 |
|---|---|---|---|
| SQLite | `rusqlite = 0.40.2`，实际锁定 libsqlite3-sys 0.38.2，bundled SQLite **3.53.2**。先单独修改依赖版本并沿用现有 db.rs；不需要为了升级而改 SQL/schema。 | 隔离工程直接编译当前产品 db.rs，12 个已有数据库回归测试全部通过；另做运行时版本与 FTS5 创建、插入、查询检查，共 **13 个测试通过**。旧/新保存、删除、账号隔离、冷历史、备份恢复及原子清理行为覆盖现有测试。 | 仍需真实历史数据库的脱敏副本/WAL/大库及旧版本回退读写验证；没有在客户数据上测试。保留迁移前独立备份，不自动重建或重写实际数据库。 |
| 语音引擎 | 用[官方 Rust API](https://k2-fsa.github.io/sherpa/onnx/rust-api/advanced-install.html) 的 **sherpa-onnx 1.13.8** 替代归档 sherpa-rs 0.5.1；候选实际链接 **ONNX Runtime 1.28.2**。WhisperConfig/WhisperRecognizer 改为 OfflineRecognizerConfig/OfflineWhisperModelConfig/OfflineRecognizer；保持 encoder/decoder/tokens、language、CPU 2 线程、16 kHz f32 PCM 与返回 text 的业务契约。 | 官方 static MT Release 归档 123,206,268 bytes 与 GitHub 发布者 digest 匹配：`56ffcf3c454c1f14f7bc9887286cc8143e7e542dc632804e1c447d5f8d534eaf`。测试实际链接并读取原生版本，使用当前 tiny 归档的 **float 与 int8** 两套模型识别官方 WAV 样例，均返回非空文本；启用 speech 的候选工程共 **14 个测试通过**。 | **迁移前必须补原生制品固定/校验步骤。** 新 sys build.rs 依赖 HTTPS 下载及缓存，未见 SHA-256 校验逻辑，不能只换 crate 就宣称供应链更安全。本次先外部核对官方 digest，再用 SHERPA_ONNX_ARCHIVE_DIR 提供可信归档。仍需 Base 模型、多语言/语言配置、长语音、模型错误处理、完整应用打包和性能/识别质量对照。 |
| FFmpeg | 将受维护发行版 **9.0.2 essentials** 固定为后续候选；建议项目专用路径或明确由用户维护的系统安装方式，避免不受控 PATH 选中旧程序。是否随安装包分发另做许可证及包体积决策。 | 官方 FFmpeg 下载页指向的 Gyan 制品 ZIP 与其发布者 SHA-256 匹配：`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`。仅测试进程 PATH 指向隔离 EXE，通过真实应用导出的 WAV→Ogg/Opus、64 字节 waveform、GIF→MP4、视频缩略图与播放列表拒绝 **5 项检查**。系统 EXE 哈希与原清单相同。 | 合成样例不是全部真实媒体格式的兼容证明；还需真实 WhatsApp ogg/webm/m4a/mp4、异常文件、最大时长与发布主机配置验证。候选 bytes 的供应商摘要不等于 FFmpeg 官方源码签名/可复现构建证明。 |

候选锁的 **472 个 registry crate 版本**已单独逐项查询 OSV，结果保存在 `osv-native-candidate.json`；仍为已知 glib/Linux 与 proc-macro-error/unic 维护状态项，没有新增候选 crate 公告命中。这不能覆盖静态库中每个原生组件。产品的 1,286 项依赖扫描和候选扫描分别报告，未混算依赖数量。

推荐顺序：先单独 SQLite 升级验证发布；再迁移官方语音绑定并同时提交可审核的原生版本/摘要基线；最后决定 FFmpeg 的专用路径或系统升级方式。每一步都应有独立变更与回退验证，不需要捆绑成一次大升级。本次授权只覆盖方案和隔离测试，实际产品迁移/系统替换仍待批准。

测试复现：

- SQLite：`cargo test --locked --manifest-path docs/security/native-compatibility/Cargo.toml -- --nocapture`。
- 语音：先核对 `sherpa-candidate-release-assets.json` 的官方归档 digest，设置 `SHERPA_ONNX_ARCHIVE_DIR` 为可信归档目录，设置 `BRIDGECRM_COMPAT_MODEL_DIR` 为 tiny 模型目录；运行 `cargo test --locked --manifest-path docs/security/native-compatibility/Cargo.toml --features speech -- --nocapture`。首次下载 tiny 模型摘要只是本次取证值，不是官方签名；`prepare-model.py` 只在隔离目录解包有界的常规文件。
- FFmpeg：先在 `.audit-cache/ffmpeg-candidate/ffmpeg.exe` 准备已匹配供应商摘要的 9.0.2 候选；运行 `node docs/security/native-compatibility/ffmpeg-check.mjs`。不修改系统 PATH。
- 候选漏洞复核：`node docs/security/native-compatibility/scan-candidate.mjs`。

证据：`native-upgrade-releases.json`、`sqlite-candidate-tests.log`、`sherpa-candidate-verification.json`、`sherpa-candidate-tests.log`、`speech-model-candidate.json`、`ffmpeg-candidate-verification.json`、`ffmpeg-candidate-tests.json`。初次隔离工程独立解析到了与当前 Tauri 不匹配的新版传递宏，随后以产品锁为基线重新解析候选；最终沿用已验证的 Tauri 传递版本并通过测试。不要用这次试验作为放弃现有产品锁的理由。

## 10. 实际使用缺陷：官方模型下载后无法本地转写

**C20 已复现并修复。** 官方 Tiny 归档实际词表名是 `tiny-tokens.txt`，原 `voice.rs` 只匹配 `tokens.txt`。原安装/列表仅检查存在任意 `.onnx`，因此模型会下载成功并显示就绪，但转写时报「模型缺少 tokens.txt」。配置云端 Key 时，现有调用流程会在本地错误后回退云端，增加不必要的上传/费用；本轮未改变既有回退策略。缺少 decoder 或词表的残包也会被误报就绪，重新安装时还可能替换掉正常旧模型。此项属于明确的可用性缺陷，不附加 CVE 或未证明的远程利用结论。

修改集中在 `desktop/src-tauri/src/voice.rs`：

- 第 106 行兼容 `tokens.txt` 与 `*-tokens.txt`，覆盖官方 Tiny/Base 命名；继续保留旧式模型。
- 第 128 行的就绪判断与转写共享三件套解析；第 169 行在替换旧模型前先检查 encoder、decoder 和词表，残包会失败且保留原模型。
- 第 124 行排除 `.install-*` / `.backup-*` 等内部目录，避免残留安装目录被当作可选模型。
- 第 148 行用标准库 Cow 借用 Raw IPC 字节，去掉整份压缩包的额外 Vec 拷贝；Tiny/Base 归档分别可避免约 111/198 MiB 的这一份内存拷贝。JSON 字节数组兼容路径仍保留，512 MiB 与解压边界保持原限制。

回归测试先在原逻辑下失败，错误准确为「模型缺少 tokens.txt」（whisper-model-before.log）；修复后覆盖嵌套目录、Tiny/Base/旧式词表名以及缺 decoder/词表情况。随后设置 `BRIDGECRM_VERIFY_MODEL_DIR` 指向隔离的官方 Tiny 模型，用当前产品 sherpa-rs 0.5.1 引擎和实际模型解析器加载并识别官方 WAV 样例，返回非空文本。完整 Rust 构建/22 个测试通过（whisper-model-after.log），`git diff --check` 通过。真实 Base 推理、UI 手动操作及所有语言的识别质量未在本轮验证。

## 11. 语音读取资源边界与语言设置

**C21（Medium）**：`desktop/src/lib/mediaBlob.ts` 的两个调用方是本地和云端语音转写。原 URL 路径直接 `response.blob()`，data URL 路径直接 `atob()`，均没有实际字节上限。`exportData.ts:234` 允许备份中的 HTTPS 音频链接，因此恶意备份被导入后、用户触发转写且远端持续返回数据时，可进入这个无界读取路径；不需要突破 sidecar 的媒体下载限制。风险是 WebView 内存耗尽，未以实际客户端崩溃作为验证结论。

修复复用现有发送语音的 **14,000,000 bytes** 上限；自动接收音频原本最高 6,000,000 bytes，不降低该既有限制。Base64 在解码前检查编码长度、解码后检查实际字节；百分号编码检查输入和解码后字节；URL 同时检查 Content-Length 和实际流累计，异常取消读取并释放 reader，保留 30 秒超时。这只限制文件字节，不证明压缩音频解码后的 PCM/时长已有完整资源约束，解码器内部资源风险仍待确认。

新增 `media-blob.test.mjs` 回归在旧实现下失败：超限响应未拒绝、超大 data URL 进入了 atob。修复后覆盖虚假/缺失长度、超限实际流、取消/释放、解码前拒绝和正常数据读取。

**C22（Low，可用性缺陷）**：`desktop/src/lib/transcribeVoice.ts:131` 原本忽略 `settings.voiceInputLang`，即使用户明确选择法语/中文，本地调用仍落到后端默认英语。现在复用已有 `normalizeVoiceInputLanguage` 将明确语言传给 `localTranscribe`，空值/无效值继续沿用既有默认，不擅自引入语言自动识别策略。`transcribe-local-language.test.mjs` 调用真实转写入口，模拟引擎边界，验证法语/中文参数及正常本地成功时不上传音频；这不是所有语言的真实识别质量测试。

本轮验证：**265 个 Node 测试全部通过**，TypeScript/Vite 构建、Baileys 506 模块编译及 Bridge 冒烟测试通过，`git diff --check` 通过。首次受限构建在删除旧 dist 文件时遭遇 EPERM，正常权限重试成功。证据为 `audio-input-check.log`、`audio-input-build.log`、`audio-input-bridge-build.log`、`audio-input-smoke.log`。本轮未更改 Rust/Android 源码或依赖，沿用上轮对应构建/测试结果。

## 12. 转写并发与界面线程

**C23（Medium）**：原语音入口只在单条消息的组件上禁用按钮，不同消息、聊天窗口及语音输入共用的转写入口仍能同时读取/解码/上传音频。Rust 原生识别命令同步执行模型加载与推理，占用界面线程。重复操作可叠加内存/CPU 压力并影响界面响应；不把它描述为已证明的无需交互远程攻击。

`transcribeVoice` 增加共享单任务保护，重复请求立即返回明确重试提示，不建立无界队列，也不转入云端；成功/失败均在 finally 中释放。Rust `speech_transcribe` 改为异步命令，通过现有 Tauri blocking runtime 执行原生识别，使用现有 Tokio Semaphore 保证最多一个原生任务；许可由实际工作闭包持有，IPC 等待被取消不会提前释放仍在执行任务的许可。原生推理未实现强制中止或硬超时。

验证：并发请求在解码/上传前拒绝、失败后可以再次转写；Rust 单工作许可拒绝第二次占用并在释放后允许重试。完整 **266 个 Node 测试、23 个 Rust 测试**及 TypeScript/Vite、Baileys 编译、Bridge 冒烟通过。证据为 `speech-resource-check.log`、`speech-resource-rust.log`。

时长上限会影响长音频使用，开发者询问 30 分钟文件是否能用，目前正在等待 10/30 分钟的明确选择；未提前写入新的时长/PCM 采样上限。现有 14 MB 文件边界继续执行，但不能据此保证解码后 PCM 有界。作为 document 类型发送的音频附件，目前界面只显示文档操作，不提供转写按钮；作为 audio/ptt 类型的消息才显示转写入口。补文档音频入口属于后续功能范围，未在本次并发修复中改动。

## 13. 已授权的产品可靠性改进

开发者确认个人销售、多账号、多语言使用定位，并授权在核对同类软件后处理翻译、待回复与自动备份。参考 [Front 的阅读状态说明](https://help.front.com/en/articles/2164)、[respond.io 的会话状态/未读说明](https://respond.io/help/inbox/managing-conversations-in-inbox)和[草稿翻译/恢复原文流程](https://respond.io/help/inbox/interacting-with-ai-prompts)。这些资料支持状态分离和可恢复草稿；“失败不生成演示译文”、每日保留七份 JSON 是本项目的设计取舍，并非宣称竞品具有完全相同策略。SQLite [官方备份说明](https://sqlite.org/backup.html)用于核对活跃数据库备份边界；本轮复用已存在的完整历史 JSON 导出格式，未直接复制活跃 SQLite 文件。

- 翻译失败/仅有演示 AI 时返回空替换文本和错误，不缓存演示结果；真实 Google 翻译路径保留。输入框遇到失败保留原文，等待期间有新编辑时也不覆盖。
- 未读保持原计数，另加待处理会话和手动处理时间戳；阅读不清除待处理，排队/失败发送保持待处理，成功发送清除对应较早任务，新客户消息重新进入。使用现有 store、预览和备份格式，无额外工单系统。旧数据在可用消息历史中补齐，未知方向不推断为待处理。
- 桌面版应用运行时每天备份一次，默认启用、可关闭/立即执行/确认恢复最近一份。读取完整冷历史、复用安全设置导出、不含 API Key、Bridge Token、WhatsApp 登录凭据，不主动读取媒体缓存；沿用手动 JSON 导出的轻量内联媒体规则（消息内 data URL 超过 8,000 字符时剥离）。固定 app_data/crm-backups 目录、256 MiB 大小边界、原子写入，成功后仅清理本功能命名的旧文件并保留七份；失败通知且后续重试，恢复期间暂停。JSON 包含明文业务内容，同盘备份不能防硬盘损坏，仍需外部副本；未新增静态加密或应用关闭后的系统定时服务。

验证：**270 个 Node 测试、24 个 Rust 测试全部通过**；TypeScript/Vite、Baileys 编译和 Bridge 冒烟通过，git diff --check 通过。实际 store 流程、翻译失败后重试、冷历史/凭据排除/恢复解析、重复日跳过、禁用/恢复期间暂停及原生七份保留/失败保留旧文件均有回归覆盖。证据：product-check.log、product-rust.log、product-focused.log、product-reply-flow.log。未用真实 WhatsApp 账号执行操作或进行原生界面手动恢复演练；未发布或提交。

## 14. 产品改动验收（2026-10-03）

- 修复 `crm_backup_latest` 同步读取最高 256 MiB 文件占用桌面主线程的问题：命令改为异步，读取在 blocking runtime 完成；文件打开后检查同一句柄大小，并以 limit + 1 限制实际读取，防止检查后文件增长绕过上限。扩展现有 Rust 回归，验证可恢复内容与超限文件拒绝。
- 实际浏览器预览发现原 `sidebar.unreadChats` 在中/英/法三种语言仍表述为待回复，导致工作台两个不同筛选含义重叠；全部更正为未读，并更新空队列说明。
- 在独立 `http://127.0.0.1:5187` 浏览器预览中，仅使用虚构客户 JSON：确认恢复预览显示覆盖范围及安全策略；恢复后未读 1、待回复 1；打开会话后未读 0、待回复仍 1；全部账号工作台展示该待办；点击已处理后待回复 0，重新加载仍为 0。截图 `product-acceptance-awaiting.jpg` 展示已读但待处理的测试客户。
- 完整检查通过：270 个 Node 测试、24 个 Rust 测试、TypeScript/Vite、Baileys 编译、Bridge 冒烟；日志 `product-acceptance-check.log`、`product-acceptance-rust.log`。原生自动备份按钮的实际桌面交互及真实账号端到端发送仍待确认，浏览器预览不能替代这些验证。

## 15. 主导航收敛（2026-10-03）

按个人/单个销售、多账号和多语言沟通的定位，将顶部常驻入口收敛为工作台、会话、客户库；群发、星标、统计、监测和设备移入「更多」，继续复用原有路由和功能。选中次级页面时，按钮显示「更多 · 页面名称」；监测异常角标同时显示于更多入口和监测条目。菜单支持点击外部关闭、Escape 关闭并返回按钮焦点、Tab 访问；窄窗口保留主导航一行。工作台角标改为 awaitingReplyChats，阅读未处理消息不再导致提醒消失。

验收：独立浏览器预览确认三项主入口、更多中五项功能、统计跳转及当前位置标识、选择后关闭和 Escape 关闭/焦点返回。截图 navigation-more.jpg。270 个已有 Node 测试、TypeScript/Vite 构建、Baileys 编译、Bridge 冒烟均通过（navigation-check.log）；未更改 Rust、Android 或依赖，未发布。

## 16. 多账号/多语言沟通检查（2026-10-03）

参照 Front [发送来源选择](https://help.front.com/en/articles/2218)与 respond.io [输入区通道切换](https://respond.io/help/inbox/managing-conversations-in-inbox)，核对本项目现有发送账号条、线程归属解析及翻译入口。已有 PersonMultiAccountPanel 发送账号选择和客户 preferredLang 记忆，本轮未重复添加入口或改变发送账号策略。

**C24（Medium）**：原 Composer 只比较请求前后的草稿文字，翻译服务响应较慢时，用户切换到同文草稿的另一个客户，旧译文仍可能回填该会话；旧请求 finally 也会影响新请求忙碌状态。利用条件是操作者发起翻译并在返回前切换会话，不是已证明的远程未授权攻击；可能导致错写草稿及误发内容。现在请求序号随会话切换/卸载失效，结果、错误、finally 均检查序号。实际网络请求可能仍完成，但其旧结果被丢弃。还原底稿只在成功且当前草稿未变时保存。

TranslateBar 的自动检测提示、翻译按钮、忙碌状态、还原、快捷键及 Composer 成功提示改用已有中/英/法字典；保持现有语言检测和手动选择策略。

验证：composer-translation-race.test.mjs 运行源码中的实际异步处理函数，受控延迟响应验证同文跨会话拒绝、旧请求不清除新请求 busy、旧错误静默、编辑/失败保留草稿与还原状态；这是处理函数回归，并非真实浏览器切换操作或在线翻译质量评测。完整 272 个 Node 测试、TypeScript/Vite 构建、Baileys 编译和 Bridge 冒烟通过（composer-safety-check.log）。本轮未更改依赖、Rust 或 Android，未连接或发送真实 WhatsApp 消息，未发布。

## 17. 客户/账号切换时的发送隔离（2026-10-03）

**C25（High）**：useComposerMedia 原附件循环跨 await 后仍继续调用父级 useEventCallback，而该回调转向当前客户/账号。操作者在第一项上传期间切换客户，后续附件可能发送给后来选中的客户。若文件读取后 enqueue 未显式指定 chatId，本地气泡也可能落到新选中的会话。修复把批次绑定会话/发送账号的生命周期，切换或卸载后不再发起后续项；已开始的单项仍按原目标完成，不宣称能撤回在途发送。清理已发项仅作用原会话，保留未发及后来新加的附件；同一 hook 的批次有同步锁并确保 finally 释放。主聊天文件/图片/音频/GIF、群发媒体明确传入原 chatId。

**C26（Medium）**：原异步发送成功直接清空全局当前草稿；切换客户或同会话继续输入时会丢失新草稿。图片/文档的说明也曾在读取后才取得，可能包含新客户文本。现在说明在读取前固定；通过 clearSentChatDraft 检查原会话草稿仍与已发文本一致才清理，主聊天使用输入框读取引用保护尚未写回 store 的内容，多窗口继续按自身会话清理；编辑、引用、提及清理也核对原上下文。

**C27（Medium）**：语音输入的异步启动期间重置无法取消尚未返回的 session，stop 返回时也未核对会话，可能向新客户草稿回填旧识别内容。现在启动、临时结果、错误、最终结果及 finally 核对请求序号；取消/会话重置/卸载令旧请求失效，迟到 session 返回后立即 cancel。

验证：新增受控 React 状态/effect 和外部 I/O 的实际 hook/发送器回归。覆盖 A 第一项未完成时切到 B（B 附件不被覆盖，A 第二项保留）、只换发送账号、文本成功后的原会话清理、尚未落盘输入保护、四种媒体延迟读取后的原 chat/account/caption，以及语音启动与最终结果迟到。未连接或发送真实 WhatsApp 消息；这不是原生窗口/真实账号端到端验收。完整 281 个 Node 测试、TypeScript/Vite 构建、Baileys 编译与 Bridge 冒烟全部通过（chat-switch-check.log）；没有依赖或原生后端改动，未发布。

桌面原生拖入文件还增加独立的会话版本检查，异步读取后仅在原会话生命周期仍有效时暂存附件；不会因同会话发起翻译而丢弃拖入文件。最终构建再次通过（chat-switch-build.log）。

## 18. 稳定性复查（2026-10-03）

本轮优先复查已有修改，未扩展账号策略或接入新依赖。新增受控失败与异步时序回归先复现问题，再实施最小修复；这些是本地可靠性缺陷，不宣称存在未经授权的远程利用。

- **C28**：同批次贴纸成功、带说明附件失败时，原逻辑只要求任一附件成功就清空输入框，导致尚未发送的说明丢失。现在以 captionUsed 为清理条件，只有说明确实随成功项发送且原草稿未改动才清理；失败项和说明可继续重试。
- **C29**：自动备份取得旧 state 后异步读取完整历史，若恢复在此期间开始并结束，结束时单独检查 restoring 已变回 false，会继续将恢复前快照写入当天备份。复用恢复保护模块增加单调递增的恢复序号，备份开始记录序号，写入前核对恢复仍未发生。恢复仍进行或已完成都丢弃本次导出；失败、并发及丢弃路径释放既有锁。已经交给原生端执行的文件写入不能由该检查撤销，不声称实现跨进程备份/恢复事务。
- **C30**：隔离浏览器刷新后，附件从 IndexedDB 恢复但说明只恢复到内部状态，输入框空白，发送内容不可见。加载完成时将说明回填空输入框；加载等待期间已有新文字则保留新文字并用它作为说明，避免后台旧说明覆盖或隐式发送。

回归证据：stability-before.log 为 C28/C29 原逻辑失败（17 项中 2 项失败）；stability-caption-before.log 为 C30 原逻辑失败。修复后的 stability-focused.log **19 项通过**，覆盖贴纸部分成功后重试、异常后锁释放、A→B→A 快速切换时新附件/说明保留、卸载不继续发后续项且重挂保留未发项、备份写入失败后重试、并发手动/后台请求、恢复进行/完成两种时序、附件说明恢复与新输入保护。

最终完整检查 **291 个 Node 测试、24 个 Rust 测试全部通过**；TypeScript/Vite 构建、Baileys 506 模块编译和 Bridge 冒烟通过（stability-check.log、stability-rust.log），git diff --check 通过。Rust 原生七份备份保留、失败不损坏旧文件及大小限制再次通过现有测试。Android 本轮无修改，未重新构建设备端。

独立 localhost:5187 浏览器只使用虚构验收客户、本地自聊和无业务内容的 txt：切换后两个草稿各自保留；暂存附件、切换、刷新后附件恢复；修复后原说明也在输入框恢复可见。截图 stability-attachment-restored.jpg；未发送消息、未连接真实 WhatsApp 账号。纯文字草稿当前仅在运行内存保留，独立的重启恢复尚未实现，应作为下一项明确的可靠性改进。原生界面手动备份/恢复、真实账号发送及长时间连续运行仍待确认；测试通过不能代替这些验收。未打包发布或提交。

## 19. 草稿与待回复一致性（2026-10-04）

按开发者同意的前两项优先级，补齐单个销售在多账号、多语言沟通中容易丢内容或漏任务的边界。继续复用现有状态、SQLite settings 表和 IndexedDB，不引入新依赖、云同步或工单系统。参考 [Front 草稿说明](https://help.front.com/en/articles/2257)确认未发送内容恢复的实际用途，具体实现按本项目现有架构选择。本节替代第 18 节「纯文字仅在运行内存保留」的当前状态描述。

- **C31（Medium，可靠性）**：此前普通文字输入主要停留在 DOM/内存，刷新或进程退出可丢失未发报价；连续输入还会让普通防抖保存一直等待。新增输入 400 ms 合并同步、5 秒检查点及切换/隐藏/退出同步；桌面检查点只写独立 `chat_drafts` 行，浏览器复用完整快照保存。启动仅恢复仍存在会话的字符串草稿，按会话 ID 隔离，兼容旧快照无字段的情况。使用恢复代次和会话存在检查，避免备份恢复已完成或会话已删除后，旧定时器/卸载清理重新写回旧稿；退出读取快照前先同步输入框，取消原 500 ms 去重以免漏最后一次编辑。
- **C31 容量边界**：前后端一致限制单条 65,536 个 UTF-16 单元、1,000 条、实际 JSON 共 2 MiB。写入前验证，原生在同一事务提交；失败回滚，单个草稿删除不影响其它会话。前端遇到容量超限保留内存文字并提示复制/缩短或清理，跳过草稿字段、保留磁盘旧稿，同时继续保存消息/联系人等业务数据，不截断草稿。草稿存于本地普通 SQLite/IndexedDB，与其它聊天内容同属明文业务数据；不新增静态加密。JSON 手动/自动备份仍不导出草稿，成功替换恢复清空旧草稿，恢复失败保留原稿；不是跨设备草稿同步。
- **C32（Low，任务一致性）**：统计页待回复卡片原来实际使用未读数，点击进入未读筛选；多窗口和列表还会将未知方向的未读消息推断为待回复。现在按账号新增独立 awaitingReplyChats，卡片、排序和跳转使用待回复字段，账号表分别列出待回复、未读会话和未读消息。继续保留既有未读字段兼容调用；列表、多窗口、统计统一调用 isAwaitingReply，排除归档、本地自聊、已处理和已回复会话。未知方向不靠未读数猜测；历史缺失导致方向无法确定时仍应人工核对。
- **C33（Medium，可靠性）**：实际乐观 enqueueOutgoingMessage 在结果返回前就清空草稿，后续失败会丢失输入。移除入队阶段的清稿，由发送结果接管：成功或进入既有重试队列时，才清理原会话仍未改动的文字；明确失败、不支持、结果未知都保留。其它会话和等待期间的新输入保留。重试队列已持有待发正文，排队时清稿沿用原产品行为，避免重复发送。

验证：定向 **62 项通过**（drafts-focused.log），覆盖连续输入检查点、恢复进行/完成、删除会话、A/B 草稿隔离、容量失败不阻断业务保存、发送各结果与多窗口/统计判断。SQLite 真实文件关闭重开、设置增量、单项/全部清理、格式/UTF-16/JSON 容量、事务回滚均通过原生 DB 测试。完整 npm run check 通过 TypeScript/Vite、Baileys 编译和 Bridge 冒烟（drafts-check.log）；最终新增结果分支与备份不导出草稿断言后 npm test **310 项全部通过**（drafts-tests-final.log）。Rust security/protocol/db/bridge **27 项全部通过**（drafts-rust.log）。git diff --check 通过。现有大 bundle、MSVC 链接及未使用函数警告保留，未将其称为漏洞。

实际浏览器验收：独立 localhost:5187、虚构客户、无真实账号连接；关闭之前的测试附件预览后输入中法双语纯文本，刷新再打开客户，输入框完整恢复且无附件（drafts-reloaded.jpg）。统计页确认待回复和未读分列，选账号 1 后点击卡片，进入账号 1 的待回复筛选（drafts-stats.jpg）；页面未发现控制台 error。未发送任何 WhatsApp 消息，未发布或提交。

剩余边界：异步保存不能保证进程被强杀时最后几秒或仍在写入的内容零丢失，磁盘写入失败明确报错并保留内存稿。真实账号端到端、实际桌面关闭重开和长时间运行验收仍待确认；浏览器刷新和数据库重开测试不等于这几项已完成。长音频解码/时长与硬取消、云端转写回退授权、离盘备份、原生组件升级和本地业务数据静态加密仍按已有决策项处理，本轮未擅自修改。

## 20. 2026-10-04 已授权的语音、重发与语言选择修复

本轮针对开发者确认的三项产品流程缺陷，继续在现有 React/TypeScript 桌面前端中修复；没有增加依赖、升级原生组件或调整语言推断优先级。以下严重级别描述业务可靠性风险，不声称为新的 CVE。

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
| --- | --- | --- | --- | --- |
| C34 | 代码：转写失败替换内容、成功回填不同步 | Medium | `desktop/src/lib/transcribeVoice.ts:33`、`desktop/src/components/chat/useMessageActions.ts:35`、`desktop/src/components/chat/useComposerVoiceInput.ts:44` | 已修复 |
| C35 | 代码：未知送达状态导致重复重发 | Medium | `desktop/src/components/chat/retryMessageAction.ts:40`、`desktop/src/lib/baileysCore.ts:111`、`desktop/src/store/hydrateMessageCleanup.ts:84` | 已修复现有消息气泡重试入口；商品流程边界见下文 |
| C36 | 代码：语言偏好无法恢复自动、来源提示失真 | Low | `desktop/src/components/chat/Composer.tsx:648`、`desktop/src/components/chat/TranslateBar.tsx:47`、`desktop/src/lib/translateDraft.ts:254` | 已修复 |

**C34：利用/触发条件与修改。** 转写没有凭据、服务失败或返回空内容时，旧实现可能把错误/示例文字当转写或消息草稿，覆盖原有报价；浏览器实时识别的临时内容也会留在失败后的输入框。转写服务现返回空 `text` 与 `error`，消息操作不覆盖已有转写/译文。语音输入记录原稿，失败或取消只在输入仍属于本次识别时恢复；用户手工补充、切换会话和迟到结果均受保护。成功路径先更新可见输入框，再同步保存，避免内部稿与 DOM 不一致而发送旧内容。已有本地失败回落云端策略未改变，失败并不保证从未发生云端上传。

**C35：利用/触发条件与修改。** WhatsApp 可能已经收到请求，而响应在超时、连接中断或应用退出时丢失；此时把消息当普通失败直接重发，会重复发送报价或附件。增加可持久化的 `deliveryUncertain` 标记，兼容旧中/英/法错误提示。未知结果不进入自动重试，气泡显示「发送结果待核对 / 核对后重发」，聊天及多窗口使用现有确认框，明确要求先检查 WhatsApp。取消不改变状态；确认期间收到回执、删除消息或修改正文、目标、账号及媒体 URL 时终止旧操作。媒体重发固定原消息账号，重试中的 `pending` 在重启后重新标为未知，不能沿用前一次确认。

共享请求只对实际开始的 `/send`、`/catalog/send` 发送标记不确定；传输异常、5xx、截断 JSON 及缺少 `ok:true` 的成功 HTTP 响应不再误报成功。缺桌面 runtime、请求开始前取消、发送门闸和明确 4xx 拒绝保留普通失败语义。POST 仍只执行一次，GET 重试策略保留。文字通道、图片、贴纸、文件、音频附件、录制语音、GIF 首发及媒体重试均保存该标记；包装错误保留原错误属性及 `cause`。商品发送失败补充明确核对提示，不创建成功消息、不自动重放。

**C36：触发条件与修改。** 一次手选语言会记入客户偏好，以前输入栏没有清除入口，而且国家推断/默认语言会被统称为检测。现在手选后显示「恢复自动」，只清除该客户 `preferredLang` 并立即重新计算目标；不发起翻译、不发送消息、不更改当前稿或还原原文。来源明确显示客户指定、国家推断、消息检测或默认语言；沿用既有「客户偏好 > 国家 > 来信检测 > 默认」顺序。翻译运行期间禁用语言切换，既有会话切换/迟到结果保护保留。

实际界面验收使用独立 `http://127.0.0.1:5187/`、虚构客户及原有测试稿，未连接真实账号：先选法语，出现客户指定和恢复自动；点击恢复后立即回到中文/消息检测，原稿不变；刷新重开仍为自动结果且稿件完整。截图为 `workflow-translation-manual.png`、`workflow-translation-auto.png`，验收过程中未发现控制台 error。语音和发送边界使用真实入口代码配合受控服务/网络替身测试，没有实际录音、云端转写或 WhatsApp 发送。

最终验证：`npm run check` **364 项 Node 测试全部通过**，TypeScript/Vite 构建、Baileys 506 模块编译及 Bridge 冒烟通过（`workflow-check.log`）；三项流程定向 **59 项**和媒体/录音/商品定向 **19 项**通过（`workflow-focused.log`、`workflow-media-focused.log`）。另一次独立 TypeScript 检查通过。`git diff --check` 通过；现有前端大 bundle 警告保留。没有修改原生 Rust/Android 源码或依赖，本轮未重跑它们的构建；上一轮 27 项 Rust 验证记录仍见第 19 节。修改尚未提交或发布。

剩余边界与后续建议：商品卡片目前只有失败提示，没有持久的失败消息气泡和重试确认入口；已补未知结果警告，但不能据此宣称商品重复发送流程已完全闭环。应后续统一商品发送状态和恢复操作。人工核对也不能从技术上保证用户不重复发送；未增加服务端幂等协议。真实账号端到端、桌面退出重开和长期运行仍待确认。跟进字段与正式提醒不同步、客户库默认筛选/账号范围提示、辅助文字对比度仍是上轮只读评估的后续项，本轮未擅自改变业务含义。长音频时长、强制取消和云端回退授权继续待开发者决定；系统 FFmpeg 和已接受的 braces 构建输入边界未改。

## 21. 跟进提醒一致性与取消历史（2026-10-04）

本轮按开发者授权处理跟进日期与正式待办不同步的问题，并落实其明确选择：「增加明确的取消按钮，只取消当前一条并保留历史」。范围为现有 React/TypeScript 前端、状态动作、JSON 恢复和通知去重，无新依赖或数据库结构变更。以下级别指业务可靠性风险，不声称为 CVE。

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
| --- | --- | --- | --- | --- |
| C37 | 代码：日期与正式任务不同步、改期吞提醒 | Medium | `desktop/src/components/crm/ContactEditor.tsx:53`、`desktop/src/store/followUpActions.ts:50`、`desktop/src/lib/followUpDueNotify.ts:69` | 已修复 |
| C38 | 代码：看板按钮覆盖姓名导致误排期 | Low | `desktop/src/components/views/CrmBoardCard.tsx:75` | 已修复 |

**C37：触发条件与具体改动。** 原客户详情直接修改 `nextFollowUpAt`，不会建立正式任务；用户以为已经安排提醒，但工作台及通知读取另一份任务数据。此前单条改期还会按数组顺序选任务、覆盖原备注，通知仅按 ID 去重可吞掉改期后的到期提醒。

- 客户详情显示该客户最早未完成任务的完整本地日期、时间和备注；设置与改期复用现有排期弹窗，成功后统一调用正式任务动作。只有旧客户日期、没有正式任务时明确显示「尚未安排提醒」，日期仅用于预填；关闭弹窗不会建立提醒，没有把历史导入日期静默转成任务。
- 单条改期只更新最早待办，保留任务 ID 和未显式替换的备注，其它任务及客户不变。客户摘要重新取剩余任务的最早时间；将原最早任务移到另一条之后时，摘要正确指向另一条。单条新建使用 UUID。既有批量操作仍更新所选客户的全部未完成任务，未擅自改变其业务语义。
- `取消当前提醒` 按 ID 只取消当前这一条，设置 `done:true,cancelled:true`，保留 ID、备注、日期与活动记录，并按剩余任务更新摘要。已完成或已取消不重复取消。历史明确区分「已完成 / 已取消」，均可按原 ID 重新打开；重开清除取消状态。
- JSON 恢复保留取消标记，并将取消记录规范为非待办。原生存储已有 JSON 行机制可保留该字段，未新增 SQL 迁移；旧备份无取消字段仍可读。旧版恢复器可能丢掉取消标签，但 `done:true` 仍使它留在完成历史，不应将其称为完全保留新版状态。
- 排期动作验证真实日历日期与本地时间，拒绝不存在的日期、越界时间和夏令时跳过的时间；无效输入不写任务、不记活动或保存。沿用现有不带时区的本地日期约定，未增加跨时区调度。
- 通知去重改为 ID 加到期时间，改期后到新时间才提醒；完成、取消和重新打开清除该 ID 的旧去重记录。前台、批量与六小时抑制规则沿用现有行为。客户切换、任务完成/取消/替换、同 ID 时间或备注变化后，旧弹窗提交会被拒绝。

**C38：触发条件与具体改动。** 实际浏览器验收发现，没有备注或日期的短看板卡片，其悬浮快捷按钮覆盖客户姓名，点击姓名会误触「今天跟进」。在非多选模式给卡片底部预留按钮空间；修复后使用同一虚构客户短卡片点击姓名，正常打开详情，没有新建提醒或活动。

验证：新增组件、状态一致性、通知及历史测试共 **34 项**，连同原有跟进动作/规则定向 **36 项通过**（`followup-focused.log`）。完整 `npm run check` **398 项 Node 测试、TypeScript/Vite、Baileys 506 模块编译和 Bridge 冒烟通过**（`followup-check.log`）。最后按钮布局改动后再次运行已有检查，398 项测试及 TypeScript 通过；沙箱清理旧 dist 时出现 EPERM，因此单独在允许的构建环境重跑前端构建，成功（`followup-check-final.log`、`followup-build-final.log`）。`git diff --check` 通过；现有大 bundle 警告保留。Rust/Android 源码本轮无改动，未重新运行其构建；原生验证记录见第 19 节。

实际页面验收：独立 `http://127.0.0.1:5187/`、虚构客户、账号未连接。将提醒改至 `2030-12-20 10:30`，原备注保留；取消后显示尚未安排提醒、待办为零、历史为已取消；重新打开后恢复同一任务的完整时间与备注，再次取消。预览服务及标签页重新打开后，取消历史仍存在且待办为零，未发现控制台 error。截图 `followup-rescheduled.png`、`followup-cancelled-history.png`。未发送 WhatsApp 消息，未接受新的通知权限，未提交、打包或发布。

剩余边界：通知回归使用真实入口配合通知替身，实际 Windows 桌面通知、程序关闭期间的提醒和长期运行仍「待确认」；本项目没有后台系统调度服务，程序关闭时不能承诺提醒。改期覆盖同一任务，活动日志保留改期/取消过程，未新增不可变任务版本系统。历史列表沿用最多显示 30 条的边界，其余记录仍保存在数据中。商品发送失败恢复、客户库筛选/账号范围提示、辅助文字对比度仍是后续项；长音频、云端回退、原生升级与已接受依赖边界沿用已有决定。本节更新第 20 节跟进不同步的当前状态，不代表全部产品风险已经消除。

## 22. 本地试用修正与推送前复核（2026-10-04）

本地桌面开发版重新编译并启动，确认主窗口存在、进程响应正常；最初沙箱内启动遇到只读数据库限制，正常本地权限启动成功，没有据此更改数据库或删除用户数据。开发者试用后指出普通提示遮挡导航、工作台两个按钮偏大，分别在 `ToastHost.tsx:16` 将普通提示移至左下角，在 `TodayView.tsx:338` 将多窗口和查看统计改为已有 xs 尺寸。浏览器仅使用虚构客户验收：通知存在时可点击主导航且可关闭；四个工具栏按钮实测均为 28px 高、11px 字号、左右 8px 内边距及相同垂直中心。当前开发服务器提供最新模块，两个布局修改的独立构建均通过。

开发者授权推送 GitHub 后，重新运行完整检查：**398 项 Node 测试、TypeScript/Vite、Baileys 编译和 Bridge 冒烟全部通过；27 项 Rust 测试通过；Android 严格依赖校验、单元测试任务及调试 APK 构建通过**。Android 本次任务为 up-to-date，另行执行 `javac` 和启用断言的 `BoundedInputCheck` 成功，官方制品校验工具的离线正负检查也通过。Java 首次因本机临时 Unix socket 路径失败，复用先前成功的工作区 socket 目录后构建通过，未改产品配置。

再次 npm audit 为 5 项 High、0 项 Critical，仍为开发者已接受的 braces 漏洞及其构建链传播，不是 5 个独立漏洞；本次没有执行大版本自动升级。凭据规则扫描当前源码与产物仍只有上游字典、编译数据碰撞和测试假连接串命中，没有确认的项目凭据；规则存在原报告描述的覆盖边界。原始扫描 JSON、运行日志和界面截图只保存在本机，已忽略，防止带入工作站路径或客户界面数据；提交保留本报告、复现工具和回归源码。

推送目标为现有 `origin/main`，仅提交源码，不创建版本标签或启动安装包发布。真实账号发送、长时间运行以及已记录的原生迁移等边界仍按前文处理。前述各节的「未提交/未发布」描述是对应验收时的状态；本节记录本次提交前的最终检查，不宣称 GitHub CI 或安装包验收已完成。
