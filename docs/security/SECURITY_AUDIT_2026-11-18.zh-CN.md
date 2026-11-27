# BridgeCRM 安全复审 · 2026-11-18

## 范围与证据

本次检查当前未提交工作区。产品包含 React / TypeScript / Vite、Tauri / Rust / SQLCipher、Node / Bun Baileys sidecar、Kotlin / Java / Gradle Android Bridge。依赖管理为 npm workspaces、Cargo 和 Gradle。Git 跟踪清单有 958 项，不等于逐文件人工审查数。

本次为增量复审，重点是最近工作区修改、Muse 请求边界、CI、关键依赖版本和凭据规则。此前 11 月 15 日报告附有直接依赖全表及锁文件库存。当前依赖清单以根、desktop 和 sidecar 的 package.json，产品及兼容性工程 Cargo.toml，以及 Android build.gradle.kts 为准。历史 CSV 仅可作对照，当前没有重新逐个查询全部依赖，也没有完成全量逐文件人工审查。

实际锁定版本抽查：React 18.3.1、Vite 6.4.6、Baileys 7.0.0-rc14、Rust Tauri 2.12.5、Tauri updater 2.14.1、OpenSSL 源包 300.6.1+3.6.3、glib 0.18.5。根及独立 npm 锁中的 Vite、Baileys 对应条目一致。三处 npm audit 都未能连通审计接口；本地没有发现 cargo-audit、osv-scanner 或 gitleaks 命令。精确版本的全量公告复核待确认。

## 问题汇总

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
|---|---|---|---|---|
| C01 | 代码 | Medium | desktop/src/lib/museWeb.ts:107 | 已修复。取消与结果返回并发时丢弃结果 |
| C02 | 代码 / CI | Low | .github/workflows/ci.yml:15 | 已修复。检出后不留 Git 认证配置 |
| R01 | 代码 / 凭据 | Medium | desktop/baileys-bridge/index.mjs | 历史保留风险，迁移需开发者决定 |
| R02 | 依赖 | Medium | desktop/src-tauri/Cargo.lock:2717 | OpenSSL 支持周期及迁移待开发者决定 |
| R03 | 依赖 | Medium（Linux 条件） | desktop/src-tauri/Cargo.lock:1456 | glib 旧分支；平台迁移待开发者决定 |
| R04 | 依赖 | Low | desktop/src-tauri/Cargo.toml:46 | sherpa-rs 维护风险；替换需兼容性验证 |

## 加固和实际适用性

- C01：以前的界面取消只向原生层发送取消消息。若请求完成与取消交错，返回结果有可能仍被回复流程接受。现在前端在提交取消时记录该请求，并在解析结果前将它作废，结束后清理记录。该防护不撤回取消前已经发出的消息。
- C02：CI 的 checkout 默认会保留认证配置供后续 Git 命令使用。构建和测试会执行仓库及依赖代码，CI 使用只读 token，但无需在这些步骤中保留 checkout 凭据。已关闭持久化。现有 workflow 的 actions 已固定提交 SHA，也未见 pull_request_target。
- [Vite 公告](https://github.com/vitejs/vite/security/advisories/GHSA-p4f5-76q4-ffq7) 的 6.x 修复版为 6.4.6，已锁定。公告针对显式暴露到网络的开发服务。当前默认不对外绑定，但 TAURI_DEV_HOST 可以显式启用网络监听。
- [Tauri IPC 公告](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv) 修复于 2.11.6；当前 2.12.5。另对照 [CSP 公告](https://github.com/advisories/GHSA-757j-xrg3-9g6p)，当前 script-src 不包含 data: 或 blob:，这两个源只出现在其他指令。
- [Baileys 公告](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg) 的 v7 修复为 rc12，当前锁定 rc14。[名称相似的恶意包](https://github.com/advisories/GHSA-7c38-xq8m-xr7x) 并非项目直接依赖，三个 npm 锁中也未发现该名字。未对所有间接包逐一确认维护状态。

## 凭据与开发者决定

本地检索覆盖工作区常见私钥标记及若干云服务 token 的格式，包括前端构建目录。未见匹配；未进行 Git 全历史扫描，也不据此排除非标准密钥、连接串和 webhook。Git 只跟踪示例环境文件，验证 .env、.env.local、desktop/.env.local 被忽略。已有 .env.example，无需新增。将来若确认任意密钥已提交或外泄，须先到对应平台撤销并重新生成；仅删除代码不够。

- Baileys 登录材料：保留当前存储方式或迁移到 OS 保护的存储。建议先做可回滚的迁移与重启验证，避免用户被迫重新扫码。
- OpenSSL / glib / sherpa-rs：保持当前锁与平台限制，或用单独分支验证升级及替代。建议优先验证 Windows 实际携带的 OpenSSL；Linux 恢复发布前重新梳理 GTK 相关依赖。
- [OpenSSL 官方公告](https://openssl-library.org/post/2026-11-01-eol34-36/)确认 3.6 已于 2026-11-01 停止公开支持。[3.6 安全补丁说明](https://mirror.openssl-library.org/news/openssl-3.6-notes/)显示 3.6.5 已修复多项问题，当前锁为 3.6.3。该依赖由 SQLCipher 构建使用。高危的具体 TLS、DTLS 和 QUIC 路径是否由产品可达待确认，不能仅由锁版本推导。已有的历史迁移决定继续保留；建议优先验证迁移至 3.5 LTS 的数据库和备份兼容性。
- [RustSec glib 公告](https://rustsec.org/packages/glib.html)及 [sherpa-rs 归档状态](https://github.com/thewh1teagle/sherpa-rs/issues)用于复核既有依赖风险。
- 全量复审仍需可用的漏洞查询和凭据扫描环境；应补全全锁扫描、全部直接依赖公告查证，以及未覆盖的 IPC、Android、备份与构建产物人工检查。

## 构建与测试

- TypeScript 构建阶段通过。默认 Vite 输出目录中有文件无法删除（EPERM），改用临时输出目录后生产构建成功。
- Rust 本地锁定版本测试通过，275 项通过，16 项忽略。
- 首次桌面全量运行 1,534 项，1,512 通过、21 失败、1 取消。失败涉及主动联系、菜单、Bun 可用性和 Muse 取消。调整 Muse 测试在取消前注册预期拒绝后，Muse 适配、队列和 Playbook 定向测试全部通过（70 项）。未建立其余全量失败的干净基线，不把它们定性为既有回归。
- Android 已尝试运行严格依赖验证的测试及构建。Gradle Wrapper 需要下载 8.14.7，网络权限拒绝，未运行到测试及 APK 构建。
