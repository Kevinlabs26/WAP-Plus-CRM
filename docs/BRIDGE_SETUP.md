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

或在桌面 **手机** 页点 **Forward :17890**。

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

手机应尝试打开 WhatsApp Business 并填入文字（不同 WA 版本控件 id 可能需微调）。

## 三、WIFI

MVP 暂不开放：Bridge 仅监听手机本机回环地址，必须通过 `adb forward` 连接。
需要 WIFI 时先增加配对认证与加密，不能直接暴露通知内容。

## 四、常见问题

| 现象 | 处理 |
|------|------|
| 顶栏显示「无壳」 | 用 `npm run tauri dev`，不要只用浏览器 |
| 连接失败 | 先 mock-bridge 验证桌面；真机查服务是否启动、reverse 是否成功 |
| 连上但不发 WA | 检查无障碍是否开启；看 `adb logcat \| grep WaAssist` |
| 端口占用 | 改设置里 Port，Android `BridgeApp.DEFAULT_WS_PORT` 需一致 |
| ADB 找不到 | 安装 platform-tools 并加入 PATH |

## 五、主要命令类型

| type | 含义 |
|------|------|
| `device.hello` | 手机上线问候 |
| `contacts.sync` / `messages.sync` | 收到的新 WhatsApp 通知（不含历史记录） |
| `wa.open_chat` | 打开聊天 |
| `wa.type_text` / `wa.send` | 输入 / 发送 |
| `wa.open_and_send` | 打开 + 输入 + 发送（桌面发送默认） |
| `overlay.show_card` | 悬浮客户卡 |

## 六、安全提示

- Accessibility 仅用于用户明确授权后的辅助操作  
- Bridge 必须先通过 Token 鉴权才会发送设备信息或接受命令；Token 不进入备份文件  
- 不要把 Bridge 端口暴露到公网  
- API Key 仅存本机，勿提交 Git  
