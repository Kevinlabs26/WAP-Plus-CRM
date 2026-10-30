# 安全审核进度（2026-10-30）

## 最终复核状态

- 当前 npm、Android Maven 锁和 Windows 实际 Cargo resolve 图的已知漏洞扫描：零命中。全平台锁仍有五个 Linux 相关包命中，详见 D8；没有移除这些包的扫描或忽略公告。
- Guava 在 AGP 构建和设备测试两条依赖链均为 33.7.2-jre；702 个 Gradle 制品全部匹配官方摘要。
- 完整 `npm run check` 通过：767 项前端测试、TypeScript/Vite 构建、sidecar 编译、Bridge 冒烟。
- Rust 测试 73 项通过；Java 有界输入检查、制品校验反例测试和依赖盘点回归测试通过。
- Android 最终 `--dependency-verification strict :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease buildEnvironment :app:dependencies` 通过，91 个任务实际执行。未签名 release APK 未发布。
- 当前工作区及 Git 历史凭据规则扫描完成，命中已取证为测试数据或上游字典/编码数据，未确认真实凭据。
- 仍未覆盖：完整逐文件人工审核、所有原生外部组件的漏洞与版本验证、真实设备 UTP 测试、真实签名更新安装、Linux 构建。不能据此声称全平台或所有代码不存在漏洞。

这是一份未完成的审核记录：尚未逐文件审查全部代码、逐包用搜索引擎查询，不能据此认定项目安全。范围包括 npm workspace 和两个独立锁文件、桌面 Rust/Tauri、Android Gradle 锁、CI 配置及当前工作区凭据规则扫描。项目包含 TypeScript/React/Vite、Node/Baileys、Rust/Tauri、Kotlin/Android/Gradle；版本控制文件 727 个。OSV 盘点 1,306 个去重的生态/名称/版本组合，其中 Maven 294 个（还包含旧依赖树日志，需以锁文件区分实际状态）。

| 编号 | 类别 | 严重级别 | 位置 | 状态与条件 |
|---|---|---|---|---|
| D1 | 依赖 | High | desktop/package.json、npm 锁 | Vite 6.4.3 的开发服务器 Windows 编辑器调用问题；升级至 6.4.5。使用开发服务器及受攻击路径时才可能触发，生产静态包不运行该服务器。参见 [公告](https://github.com/advisories/GHSA-587h-7wmj-h5pm)。 |
| D2 | 依赖 | Medium | npm 锁 | Baileys 使用 music-metadata 解析媒体；11.14.0 升至 11.16.1，修复已报告的解析器资源耗尽问题。各公告的实际可达条件尚未逐一复现。参见 [公告](https://github.com/advisories/GHSA-5gfj-9q3v-qfp3)。 |
| D3 | 依赖 | Medium | package.json、desktop/package.json、npm 锁 | postcss-selector-parser 6.1.4 升至 6.1.5；恶意选择器可耗尽 CPU，本项目主要在构建时处理可信源码。参见 [公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)。 |
| D4 | 依赖 | High | desktop/package-lock.json | 独立锁 source-map-js 1.2.1 升至 1.2.2；处理恶意 source map 可阻塞事件循环，项目可达性待确认。参见 [公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。 |
| D5 | 依赖 | Medium | desktop/src-tauri/Cargo.lock | rustls 0.23.45 升至 0.23.46，rustls-webpki 0.103.15 升至 0.103.16，webpki-root-certs / webpki-roots 1.0.9 升至 1.0.11，tokio 1.53.1 升至 1.54.1；覆盖 OSV 所列安全修复，具体特性可达性待确认。参见 [rustls 公告](https://github.com/advisories/GHSA-c8m5-c952-6cm4)和 [证书验证公告](https://rustsec.org/advisories/RUSTSEC-2026-0382.html)。 |
| D6 | 依赖 | Critical | desktop/src-tauri/Cargo.toml、Cargo.lock、build.rs | 已修复：官方更新器升至 2.14.1，zip 升至 9.1.3，高于[公告](https://github.com/advisories/GHSA-m665-v7pm-7grj)修复下限 9.0.5。新版 Tauri 默认静态链接 VC 运行库时测试进程启动卡住；build.rs 明确保持旧版动态 VC 运行库行为后，73 项 Rust 测试通过。OSV 复核未再命中 zip 公告。签名更新安装端到端验证尚未执行。 |
| D7 | 依赖 | High（OSV；上游评为 Medium） | android/build.gradle.kts、app/build.gradle.kts、两份 Gradle 锁和 verification-metadata.xml | 已修复：AGP 构建 classpath 和设备测试工具配置均升级 Guava 至 33.7.2-jre；全部 702 个制品与官方仓库摘要匹配，无失败，无通配信任。最终 OSV 对 Maven 当前锁零命中。此前审批拦截后，在用户进一步授权及官方摘要取证基础上，新的审批通过。 |
| D8 | 依赖 | Low（维护告警；glib 为内存安全公告） | desktop/src-tauri/Cargo.lock | unic 系列已从锁文件移除。glib 0.18.5、proc-macro-error 1.0.4、zbus_names 4.3.4、zvariant/zvariant_derive 5.14.0 仍有全平台 OSV 命中。`cargo metadata --filter-platform x86_64-pc-windows-msvc` 的 resolve 图证实五个包均未进入当前 Windows 构建，Windows 无这些公告的受影响组件。Linux GTK/通知依赖链仍需上游迁移，不能宣称全平台已修复；见 [Tauri 上游讨论](https://github.com/tauri-apps/tauri/issues/12564)及 [glib 公告](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)。 |
| S1 | 密钥 | Low | .gitignore、.env.example、扫描规则覆盖范围 | 规则扫描完成：当前 3,757 个文件；历史 158 个提交、2,952 个 blob，超大 blob 跳过数 0。历史仅命中 remote-media-security.test.mjs 的测试假连接串。当前二进制中的 Google 模式命中与 Baileys WABinary/constants.js 字典条目相同，AWS 模式命中与 whatsapp-rust-bridge/dist/index.js 内 WASM Base64 数据相同，已追溯来源，未确认真实凭据。环境文件已忽略，示例只列变量名；未发现受跟踪真实 .env。规则不能穷尽所有凭据格式；真实泄露密钥仍必须到提供方撤销轮换。 |

三份 npm audit 更新后均为 0；这只说明当时数据库没有命中。OSV 对三个 npm 锁、产品 Cargo 锁和 Gradle 锁逐版本查询；并未逐包使用 WebSearch。原报告中 braces 公告现已被 [GitHub 撤回](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，不再按现行高危公告报告。Baileys 是预发布版；未确认仿冒包。现有报告中其他历史风险需独立复核，不能当作本次新结论。

现有工作区未提交改动予以保留。更新器升级后 `npm test` 767 项及 Rust 测试 73 项通过。最终在常规权限环境下完整 `npm run check` 通过，包含测试、TypeScript/Vite 生产构建、Baileys 编译和 Bridge 冒烟；此前 EPERM 是受限执行环境下的产物权限问题。Java `BoundedInputCheck`、官方制品校验工具的正常/篡改/重定向测试、审计锁文件来源回归测试均通过。`npm ci --dry-run` 和 `git diff --check` 通过，但 dry-run 不能代替干净安装。审计工具现只用当前 Gradle 锁，不再把旧依赖树日志混入当前结果；全平台 Cargo 锁仍完整扫描，没有过滤公告。以下清单从首次盘点生成，后续升级版本以锁文件为准；Rust 存在多个版本时列出锁中同名版本，并非都为直接引用版本。

## 直接依赖（盘点时锁定版本）

### npm

- @tauri-apps/api 2.11.1 (dependencies)
- @tauri-apps/plugin-notification 2.3.3 (dependencies)
- @tauri-apps/plugin-shell 2.3.5 (dependencies)
- @tauri-apps/plugin-updater 2.11.0 (dependencies)
- clsx 2.1.1 (dependencies)
- countries-and-timezones 3.11.0 (dependencies)
- drizzle-orm 0.45.3 (dependencies)
- emoji-picker-react 4.18.0 (dependencies)
- franc-min 6.2.0 (dependencies)
- libphonenumber-js 1.13.15 (dependencies)
- lucide-react 0.468.0 (dependencies)
- react 18.3.1 (dependencies)
- react-dom 18.3.1 (dependencies)
- react-virtuoso 4.18.11 (dependencies)
- tailwind-merge 2.6.1 (dependencies)
- zustand 5.0.14 (dependencies)
- @tauri-apps/cli 2.11.4 (devDependencies)
- @types/react 18.3.31 (devDependencies)
- @types/react-dom 18.3.7 (devDependencies)
- @vitejs/plugin-react 4.7.0 (devDependencies)
- autoprefixer 10.5.4 (devDependencies)
- drizzle-kit 0.31.11 (devDependencies)
- postcss 8.5.28 (devDependencies)
- tailwindcss 3.4.19 (devDependencies)
- typescript 5.9.3 (devDependencies)
- vite 6.4.5 (devDependencies)
- baileys 7.0.0-rc14 (dependencies)
- pino 10.3.1 (dependencies)
- qrcode 1.5.4 (dependencies)
- bun 1.3.14 (devDependencies)

### Cargo

- tauri-build 2.6.3
- base64 0.21.7, 0.22.1
- reqwest 0.13.4
- sha2 0.10.9
- url 2.5.8
- png 0.17.16, 0.18.1
- tauri 2.11.5
- tauri-plugin-shell 2.3.5
- tauri-plugin-notification 2.3.3
- tauri-plugin-single-instance 2.4.4
- tauri-plugin-updater 2.11.0
- serde 1.0.229
- serde_json 1.0.151
- tokio 1.54.1
- uuid 1.24.0
- chrono 0.4.45
- thiserror 1.0.69, 2.0.19
- tracing 0.1.44
- tracing-subscriber 0.3.23
- rusqlite 0.32.1
- tar 0.4.46
- bzip2 0.4.4
- sherpa-rs 0.5.1
- tauri-winrt-notification 0.7.3
- windows-registry 0.6.1
- windows-sys 0.45.0, 0.52.0, 0.59.0, 0.60.2, 0.61.2

### Android

Compose BOM 2024.10.01；ui、ui-tooling-preview、material3 和 ui-tooling 由 BOM 约束；activity-compose 1.9.3、lifecycle-runtime-ktx 2.8.7、core-ktx 1.15.0、kotlinx-coroutines-android 1.9.0、okhttp 4.12.0、kotlinx-serialization-json 1.7.3；构建插件 AGP 8.7.2、Kotlin 2.4.20。实际解析版本及全部间接依赖见本地生成的 dependency-inventory.json 和各锁文件。
