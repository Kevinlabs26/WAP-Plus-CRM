# 阶段 6：联系人搜索

## 优先级

P2。电话号码打开聊天已经覆盖主流程，只有按名称查找确实是产品需求时才实施。

## 启动条件

满足任一条件再开始：

- 客户没有可用电话号码。
- WhatsApp 只提供显示名。
- 用户明确需要在 WhatsApp 联系人列表里搜索。

## 修改范围

- `android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt`
- `android/app/src/main/java/com/wapplus/bridge/a11y/WaAssistService.kt`
- `desktop/src-tauri/src/commands.rs`
- 需要该入口的桌面组件

## 任务

1. 定义 `WaSearchContact` payload：搜索词和可选设备 ID。
2. Android 打开 WhatsApp 搜索并读取匹配项。
3. 零结果返回明确错误。
4. 唯一结果可以打开聊天。
5. 多个同名结果必须返回候选列表，禁止自动猜测。

## 验收标准

- 能按完整显示名找到联系人。
- 无结果和多结果均有确定响应。
- 不会误开同名联系人聊天。

## 实施决定

用户明确要求继续执行计划，因此已按“客户缺少可用电话号码或会话地址”的最小入口实施。
