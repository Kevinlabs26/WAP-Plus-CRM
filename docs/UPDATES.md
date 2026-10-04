# 桌面端自动更新

WAP Plus CRM 使用 Tauri updater，通过 GitHub Release 分发 Windows 更新包。

## 首次配置

1. 确认 `desktop/src-tauri/tauri.conf.json` 中的 updater endpoint 保持为
   `https://github.com/Kevinlabs26/WAP-Plus-CRM/releases/latest/download/latest.json`；仓库改名时同步更新。
2. 私下备份 `desktop/.tauri/wap-plus-crm.key`。这是更新签名私钥，不能提交到 GitHub，也不能丢失。
3. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 新建：
   - `TAURI_SIGNING_PRIVATE_KEY`：粘贴 `desktop/.tauri/wap-plus-crm.key` 的完整内容
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：本项目生成的密钥没有密码，留空即可

公钥已经写入 `desktop/src-tauri/tauri.conf.json`，可以提交；私钥只能放在本机或 GitHub Actions Secret。

## 发布更新

1. 同步递增根目录与 `desktop/package.json`、`desktop/src-tauri/tauri.conf.json`、`desktop/src-tauri/Cargo.toml` 的版本，并更新 `package-lock.json`、`desktop/src-tauri/Cargo.lock`。当前版本为 `0.1.34`，变更见 [CHANGELOG.md](../CHANGELOG.md)。
2. 提交并推送版本标签：

   ```bash
   git tag v0.1.34
   git push origin v0.1.34
   ```

3. GitHub Actions 先运行前端、sidecar、Bridge 检查和 Rust 测试，再构建签名安装包及 `latest.json`，创建 Draft Release。
4. 工作流运行 Windows 安装包冒烟测试，通过后自动公开发布；检查或安装失败时不会执行发布步骤。冒烟测试严格匹配当前版本，并要求无运行中 CRM 进程、无已有 CRM 数据的干净 Windows 用户环境；启动后同时检查进程存活和数据库初始化，避免缺失运行库导致误判。只有公开发布后，客户端才能检查到更新。

发布前还应在有旧数据的 Windows 电脑上验收：升级并重启后账号仍可连接；旧密钥迁移后可用；备份恢复期间的新消息保留；自动更新能验证签名并完成重启。CI 安装冒烟测试不能替代这些真实数据验收。

本地构建需要先设置签名私钥环境变量：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw desktop/.tauri/wap-plus-crm.key
npm run release:win
```

## 客户端行为

- 桌面端启动约 12 秒后后台检查一次更新。
- 用户也可以在 **设置 → 关于与更新** 手动检查。
- 下载并安装后会按 Tauri Windows 安装流程重启应用。
- 更新包签名不匹配时会被拒绝；不要关闭签名校验。
