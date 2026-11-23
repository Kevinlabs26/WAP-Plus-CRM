# Android Bridge 联调说明

## 架构

```
桌面 Tauri (Rust TCP 客户端)
        │  JSON 行协议 :17890
        ▼
手机 WAP Plus Bridge (TCP Server)
        │  Accessibility（用户授权后）
        ▼
WhatsApp Business
```

协议字段见 `shared/protocol.ts`。

## 一、无手机（协议自测）

```bash
# 终端 1
cd BridgeCRM
node tools/mock-bridge.mjs

# 终端 2
cd desktop
npm run tauri dev
```

桌面 → **手机** → Host `127.0.0.1` Port `17890` → **连接**。  
顶栏应出现绿色 Bridge 灯。聊天发送后，mock 终端打印 `wa.open_and_send`。

> `npm run dev` 仅浏览器预览 UI，**不能**建立真实 TCP。

## 二、USB 真机

### 1. 安装 Bridge APK

Android Studio 打开 `android/`，Run；或：

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 2. 手机授权

1. 打开 **WAP Plus Bridge** → **启动 Bridge 服务**
2. **授权无障碍** → 打开 WAP Plus Bridge（否则无法输入/发送）
3. （可选）**授权悬浮窗** → 客户信息卡
4. 复制手机页面显示的 **桌面端连接 Token**，填入桌面「设置 → 连接与账号」

### 3. 端口转发

```bash
adb forward tcp:17890 tcp:17890
```

或在桌面 **手机 → 真机 → ADB 排障 / 端口转发** 扫描并选择已授权的手机，再点 **Forward**。多台手机接入 ADB 时，需要先选择设备，桌面一次操作当前连接的一台手机。不同手机可以使用各自的电脑端口，例如 `adb -s SERIAL forward tcp:17891 tcp:17890`。手机端口固定为 `17890`，电脑端口应与桌面设置一致。

### 4. 桌面连接

```bash
cd desktop
npm run tauri dev
```

- Host: `127.0.0.1`
- Port: `17890`
- Token：手机 Bridge 页面显示的 Token
- 点 **连接** → 顶栏 Bridge 变绿
- 打开聊天，对有电话的联系人发一条消息

桌面和手机需使用支持会话核验的 Bridge 版本。手机只在核验目标会话后尝试点击发送。桌面显示「发送结果待核对」时，请在手机的目标聊天中确认，系统不会自动重发。

新版 Bridge 支持最多 14 MiB 的单个媒体文件。桌面收到分享页回执后会提示在手机核对收件人并确认发送。语音回传一次准备一条，按桌面提示分享对应的 WhatsApp 语音。

真机文本群发需要新版桌面和 APK。连接手机后进入「群发」，选择联系人名单、填写文本并设置间隔，默认 20–30 秒。任务绑定启动时显示的手机。手机确认上一条已发出后，队列才按间隔发送下一位。断线或结果待核对时任务暂停。重新连接原手机后，需要手动点「继续」。结果待核对的条目保留原状态，请先在 WhatsApp 核对。

真机测试可以先检查连接、锁屏状态和截图，再给测试联系人发一条文本。尝试在手机打开目标聊天期间断开 USB，检查电脑是否显示「发送结果待核对」及是否保持不重发。最后用图片、PDF 和语音检查分享页，以及语音回传能否更新原消息。语音回传上限为 8 MiB。

## 三、WIFI

MVP 暂不开放：Bridge 仅监听手机本机回环地址，必须通过 `adb forward` 连接。
需要 WIFI 时先增加配对认证与加密，不能直接暴露通知内容。

## 四、常见问题

| 现象 | 处理 |
|------|------|
| 顶栏显示「无壳」 | 用 `npm run tauri dev`，不要只用浏览器 |
| 连接失败 | 先用 mock-bridge 验证桌面，再检查手机服务、ADB 授权和端口转发 |
| 连上但不发 WA | 检查无障碍是否开启；看 `adb logcat \| grep WaAssist` |
| 端口占用 | 换一个空闲的电脑端口，将它转发到手机端口 `17890` |
| ADB 找不到 | 安装 platform-tools 并加入 PATH |

## 五、主要命令类型

| type | 含义 |
|------|------|
| `device.hello` | 手机上线问候 |
| `contacts.sync` / `messages.sync` | 收到的新 WhatsApp 通知（不含历史记录） |
| `wa.open_chat` | 打开聊天 |
| `wa.open_and_send` | 核验设备与目标会话后输入并尝试发送 |
| `overlay.show_card` | 悬浮客户卡 |

## 六、安全提示

- Accessibility 仅用于用户明确授权后的辅助操作  
- Bridge 必须先通过 Token 鉴权才会发送设备信息或接受命令；Token 不进入备份文件  
- 不要把 Bridge 端口暴露到公网  
- API Key 仅存本机，勿提交 Git  
