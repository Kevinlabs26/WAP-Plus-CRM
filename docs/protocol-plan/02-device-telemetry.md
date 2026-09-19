# 阶段 2：设备状态与电量上报

## 目标

桌面端显示真实且会更新的 Android Bridge 状态。

## 修改范围

- `android/app/src/main/java/com/wapplus/bridge/net/BridgeServer.kt`
- `android/app/src/main/java/com/wapplus/bridge/service/BridgeForegroundService.kt`
- `android/app/src/main/java/com/wapplus/bridge/a11y/WaAssistService.kt`
- `desktop/src/types/crm.ts`
- `desktop/src/store/deviceIngest.ts`
- `desktop/src/components/views/PhonesView.tsx`

## Android 任务

1. Bridge 建连时依次上报 `device.hello`、`device.status`、`device.battery`。
2. `device.status` 包含：
   - `online`
   - `whatsappInstalled`
   - `accessibilityEnabled`
   - `overlayEnabled`
3. `device.battery` 包含：
   - `level`
   - `charging`
4. 监听电池变化后上报，不增加高频轮询。
5. Accessibility 状态或悬浮窗权限发生变化时刷新状态。

## 桌面端任务

1. 扩展 `PhoneDevice` 保存充电、WhatsApp、Accessibility 和悬浮窗状态。
2. `applyDeviceStatus` 同时处理完整状态与电量。
3. 手机页面显示这些状态，并为缺失值保留兼容降级。

## 验收标准

- 连接手机后能看到真实电量。
- 插拔充电器后桌面状态更新。
- 开关 Accessibility 后桌面状态更新。
- 未安装 WhatsApp 或没有悬浮窗权限时显示明确状态。
