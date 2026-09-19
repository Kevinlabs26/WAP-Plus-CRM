# WAP Plus CRM 发布验收清单

这份清单只覆盖 MVP 必须稳定的主路径。新功能不应替代这些验收项。

## 自动检查

```bash
npm run check
cargo test --manifest-path desktop/src-tauri/Cargo.toml
android/gradlew.bat :app:testDebugUnitTest
npm run release:win
```

前三条由 `.github/workflows/ci.yml` 在 Windows runner 自动执行；`npm run release:win` 负责本地验证正式安装包。真实 WhatsApp 扫码与收发仍保留为发布前手工验收。

自动更新发布还需要遵循 [自动更新发布说明](UPDATES.md)：确认 updater endpoint 指向真实仓库，GitHub Actions 已配置 `TAURI_SIGNING_PRIVATE_KEY`，并在发布前递增 Tauri 版本号。

## 桌面主路径

- [ ] 全新安装能启动，空工作台能正常显示
- [ ] 扫码连接一个 Baileys 账号
- [ ] 收到一条新消息，联系人、会话、未读数都更新
- [ ] 发送文本一次且只产生一条出站消息
- [ ] 断开连接后发送进入队列，重连后只发送一次
- [ ] 重启应用后联系人、会话、消息、跟进仍存在
- [ ] 导出数据后清空，再导入能恢复 CRM 数据

## 多账号与安全边界

- [ ] 两个账号的联系人、会话、发送目标不串号
- [ ] 暂停账号后普通发送和群发都被阻止
- [ ] 新账号保护期内不能启动群发
- [ ] 导出文件不包含 OpenAI/Groq API Key 或 Baileys 凭证

## Android Bridge 备用路径

- [ ] ADB forward 后能连接设备
- [ ] 设备离线/端口断开时 UI 有明确错误
- [ ] `wa.open_and_send` 失败不会伪报成功
- [ ] 无障碍权限关闭时发送被阻止并给出提示

## 发布前记录

- Windows 版本：
- Node 版本：
- Baileys 版本：
- 测试日期：
- 未通过项及复现步骤：

## 自动更新验收

- [ ] 用旧版本安装包安装并启动，设置页显示当前版本
- [ ] 发布更高版本并 Publish Release 后，手动检查能发现新版本
- [ ] 更新说明和新版本号显示正确
- [ ] 下载、安装、重启后仍能打开应用，SQLite/登录状态等本地数据仍存在
- [ ] 使用错误签名的安装包时更新会被拒绝
