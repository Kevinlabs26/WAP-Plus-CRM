# WAP Plus — Android Bridge

Kotlin + Jetpack Compose 端，负责：

- 与桌面端 TCP/WebSocket 通信（默认端口 `17890`）
- 设备状态上报
- 用户授权后的 Accessibility 辅助打开/输入/发送 WhatsApp Business
- 悬浮客户信息卡（Overlay）

## 打开工程

用 **Android Studio** 打开 `android/` 目录（会自动 Gradle Sync）。

或命令行（需本机已装 Android SDK）：

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 首次授权

1. 打开 App →「启动 Bridge 服务」
2. 「授权无障碍」→ 启用 **WAP Plus Bridge**
3. 「授权悬浮窗」
4. 将页面显示的桌面端连接 Token 复制到桌面「连接与账号」设置

## 与桌面联调

完整步骤见仓库 **`docs/BRIDGE_SETUP.md`**。

摘要：

1. 本 App 启动服务 + 开启无障碍  
2. USB：`adb forward tcp:17890 tcp:17890`  
3. 桌面：`cd desktop && npm run tauri dev` → 手机页连接 `127.0.0.1:17890`
4. 无手机：`BRIDGE_TOKEN=dev-bridge-token node tools/mock-bridge.mjs`

协议见 `shared/protocol.ts`。

## 包名

- App：`com.wapplus.bridge`
- WhatsApp Business：`com.whatsapp.w4b`

## 日志

```bash
adb logcat -s BridgeService WaAssist MsgDispatch BridgeServer
```
