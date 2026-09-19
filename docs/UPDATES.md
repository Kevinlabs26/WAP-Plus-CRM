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

1. 修改 `desktop/src-tauri/tauri.conf.json` 的 `version`，例如从 `0.1.0` 改为 `0.1.1`。
2. 提交并推送版本标签：

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. GitHub Actions 构建安装包、签名文件和 `latest.json`，并创建一个 Draft Release。
4. 检查产物后点击 **Publish release**。只有公开发布后，客户端才能从 GitHub 的 `latest.json` 检查到它。

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
