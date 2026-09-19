# Android Bridge envelope fixtures

示例 JSON 与 `shared/protocol.ts` 的 `Envelope` / `MessageType` 对齐，供桌面测试与 Android 手工对照。

- 每行/每个文件一个完整 envelope：`id`、`type`、`ts`、`payload`（可选 `deviceId`）。
- **现行字段 SSOT** 仍是 TypeScript 类型；此处只固定「形状快照」，改协议时请同步更新 fixture 与测试。

`contacts.save` 由桌面端下发，用于在用户已授予通讯录写入权限时保存姓名和 E.164 号码。

`contacts.save_batch` 一次下发多个联系人，Android 逐项返回 `saved`、`exists` 或 `failed`。
