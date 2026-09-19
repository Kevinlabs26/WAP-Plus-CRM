# 阶段 7：验证与交付

## 自动检查

每个阶段完成后运行受影响范围的最小检查，最终运行：

1. Desktop TypeScript 类型检查和构建。
2. Rust `cargo check` 或现有测试命令。
3. Android Kotlin 编译。
4. 已有桌面端测试。
5. 协议消息覆盖检查：源码中的消息名均存在于共享协议。

## 真机验收清单

1. USB/ADB Bridge 可以连接、断开和重连。
2. 设备电量、充电与权限状态正确更新。
3. 文本发送成功时收到 ACK。
4. Accessibility 关闭时返回明确错误。
5. 图片和 PDF 可以发送。
6. 文件无效时不会误报成功。
7. 客户悬浮卡片能显示、更新和隐藏。
8. Bridge 断开时桌面端不丢失本地 CRM 数据。

## 回归检查

- Baileys 文本与媒体发送保持可用。
- 联系人、消息和回执同步不重复入库。
- 旧版 `device.hello` 缺少新字段时仍可读取。
- 未实施联系人搜索时，电话号码发送流程不受影响。

## 交付记录

每个阶段完成时只更新 `README.md` 中对应优先级或状态，并记录：

- 完成日期
- 实际修改文件
- 自动检查结果
- 真机验收结果
- 仍存在的限制

## 2026-08-01 验收结果

- [x] Desktop TypeScript 类型检查与生产构建
- [x] 3 个现有 Desktop 测试
- [x] Rust `cargo check`
- [x] Android Debug APK 编译
- [x] Baileys Bridge 全部 `.mjs` 文件语法检查
- [x] 协议消息覆盖检查：源码使用项无缺失
- [ ] 真机验收：当前 `adb devices -l` 未检测到设备

交付 APK：`android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256：`92C41F98EA660F8C8DEB5EC7E3D337AAAF79DBDCFA76651A1983F717848F30B1`
