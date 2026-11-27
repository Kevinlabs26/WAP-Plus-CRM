//! Android Bridge TCP 客户端（行协议：每行一条 JSON envelope）

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
#[cfg(not(test))]
use tauri::{AppHandle, Emitter};

pub use crate::protocol::make_envelope;

/// 前端 `listen` 的事件名
pub const BRIDGE_EVENT: &str = "bridge://event";
pub const BRIDGE_STATUS_EVENT: &str = "bridge://status";
const MAX_BUFFERED_BRIDGE_EVENTS: usize = 1000;

#[derive(Default)]
struct BufferedBridgeEvents {
    queue: VecDeque<serde_json::Value>,
    dropped_events: u64,
    listener_generation: u64,
    active_generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeEventDrain {
    pub events: Vec<serde_json::Value>,
    pub dropped_events: u64,
    pub active: bool,
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut String,
    limit: usize,
) -> std::io::Result<usize> {
    let size = reader.take(limit as u64 + 1).read_line(line)?;
    if size > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Bridge line too long",
        ));
    }
    Ok(size)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectedDevice {
    pub id: String,
    pub name: String,
    pub online: bool,
    pub battery: u8,
    pub transport: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConnectionInfo {
    pub host: String,
    pub port: u16,
    pub connected: bool,
    pub last_error: Option<String>,
    pub last_hello: Option<serde_json::Value>,
    pub adb_serial: Option<String>,
    pub devices: Vec<ConnectedDevice>,
}

impl Default for BridgeConnectionInfo {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 17890,
            connected: false,
            last_error: None,
            last_hello: None,
            adb_serial: None,
            devices: vec![],
        }
    }
}

struct LiveSocket {
    writer: TcpStream,
    reader: Option<std::thread::JoinHandle<()>>,
    device_id: String,
    max_request_bytes: usize,
}

pub struct BridgeState {
    pub info: Arc<Mutex<BridgeConnectionInfo>>,
    socket: Mutex<Option<LiveSocket>>,
    lifecycle: Mutex<()>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>,
    events: Arc<Mutex<BufferedBridgeEvents>>,
    alive: Arc<AtomicBool>,
    /// setup 后注入，用于向 WebView 推送事件
    #[cfg(not(test))]
    app: Mutex<Option<AppHandle>>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            info: Arc::new(Mutex::new(BridgeConnectionInfo::default())),
            socket: Mutex::new(None),
            lifecycle: Mutex::new(()),
            pending: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(Mutex::new(BufferedBridgeEvents::default())),
            alive: Arc::new(AtomicBool::new(false)),
            #[cfg(not(test))]
            app: Mutex::new(None),
        }
    }
}

impl BridgeState {
    #[cfg(not(test))]
    pub fn attach_app(&self, app: AppHandle) {
        if let Ok(mut g) = self.app.lock() {
            *g = Some(app);
        }
    }

    fn emit_raw(&self, event: &str, payload: &impl Serialize) -> bool {
        #[cfg(not(test))]
        if let Ok(g) = self.app.lock() {
            if let Some(app) = g.as_ref() {
                return app.emit(event, payload).is_ok();
            }
        }
        #[cfg(test)]
        let _ = (event, payload);
        false
    }

    pub fn emit_status(&self) {
        let snap = self.snapshot();
        self.emit_raw(BRIDGE_STATUS_EVENT, &snap);
    }

    fn push_event_queue(events: &Mutex<BufferedBridgeEvents>, value: serde_json::Value) {
        Self::buffer_event(events, value, false);
    }

    fn buffer_event(events: &Mutex<BufferedBridgeEvents>, value: serde_json::Value, failed_push: bool) {
        if let Ok(mut buffer) = events.lock() {
            if buffer.active_generation.is_some() && !failed_push {
                return;
            }
            if buffer.queue.len() >= MAX_BUFFERED_BRIDGE_EVENTS {
                buffer.queue.pop_front();
                buffer.dropped_events = buffer.dropped_events.saturating_add(1);
            }
            buffer.queue.push_back(value);
        }
    }

    pub fn attach_event_listener(&self, generation: u64) -> BridgeEventDrain {
        let mut buffer = self.events.lock().unwrap_or_else(|error| error.into_inner());
        if generation < buffer.listener_generation ||
            (generation == buffer.listener_generation && buffer.active_generation != Some(generation)) {
            return BridgeEventDrain {
                events: Vec::new(),
                dropped_events: 0,
                active: false,
            };
        }
        buffer.listener_generation = generation;
        buffer.active_generation = Some(generation);
        BridgeEventDrain {
            events: buffer.queue.drain(..).collect(),
            dropped_events: std::mem::take(&mut buffer.dropped_events),
            active: true,
        }
    }

    pub fn detach_event_listener(&self, generation: u64) {
        let mut buffer = self.events.lock().unwrap_or_else(|error| error.into_inner());
        if generation >= buffer.listener_generation {
            buffer.listener_generation = generation;
            buffer.active_generation = None;
        }
    }

    pub fn snapshot(&self) -> BridgeConnectionInfo {
        let mut info = self.info.lock().map(|g| g.clone()).unwrap_or_default();
        info.connected &= self.alive.load(Ordering::SeqCst);
        info
    }

    pub fn disconnect(&self) {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.disconnect_inner(true);
    }

    fn disconnect_inner(&self, emit: bool) {
        self.alive.store(false, Ordering::SeqCst);
        let live = self.socket.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut live) = live {
            let _ = live.writer.shutdown(Shutdown::Both);
            // 旧读线程完全退出后才允许下一次连接复用共享状态。
            if let Some(reader) = live.reader.take() {
                let _ = reader.join();
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
        if let Ok(mut info) = self.info.lock() {
            info.connected = false;
            info.devices.iter_mut().for_each(|device| device.online = false);
        }
        if emit {
            self.emit_status();
        }
    }

    pub fn connect(
        &self,
        host: &str,
        port: u16,
        token: &str,
        adb_serial: Option<String>,
    ) -> Result<BridgeConnectionInfo, String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        let token = token.trim();
        if token.is_empty() {
            return Err("缺少 Android Bridge Token，请先在手机 Bridge 页面复制 Token".into());
        }

        let host = host.trim();
        let ip = if host.eq_ignore_ascii_case("localhost") {
            std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        } else {
            host.trim_matches(['[', ']']).parse::<std::net::IpAddr>()
                .map_err(|_| "Android Bridge 仅允许 localhost 或回环 IP 地址")?
        };
        if !ip.is_loopback() {
            return Err("Android Bridge 仅允许 USB/ADB 回环连接；不通过明文网络发送 Token".into());
        }
        let sock_addr = std::net::SocketAddr::new(ip, port);
        let stream = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(3))
            .map_err(|e| format!("连接 Bridge 失败 {sock_addr}: {e}"))?;

        stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(3))).ok();
        stream.set_nodelay(true).ok();

        let mut reader_stream = stream
            .try_clone()
            .map_err(|e| format!("clone stream: {e}"))?;
        let mut writer = stream;

        let auth = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "bridge.auth",
            "ts": chrono::Utc::now().timestamp_millis(),
            "payload": { "token": token },
        });
        let auth_line = serde_json::to_string(&auth).map_err(|e| e.to_string())?;
        writer
            .write_all(format!("{auth_line}\n").as_bytes())
            .map_err(|e| format!("发送 Bridge 鉴权失败: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("发送 Bridge 鉴权失败: {e}"))?;

        // 逐字节读一行，避免 BufReader 预读后续 hello/status 行并被丢弃。
        let deadline = Instant::now() + Duration::from_secs(3);
        let read_line = |reader: &mut TcpStream| -> Result<String, String> {
            let mut bytes = Vec::with_capacity(256);
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err("等待 Android Bridge 握手超时".into());
                }
                reader.set_read_timeout(Some(remaining)).map_err(|e| e.to_string())?;
                let mut byte = [0u8; 1];
                reader
                    .read_exact(&mut byte)
                    .map_err(|e| format!("读取 Bridge 握手失败: {e}"))?;
                if byte[0] == b'\n' {
                    return Ok(String::from_utf8_lossy(&bytes).trim().to_string());
                }
                bytes.push(byte[0]);
                if bytes.len() > 64 * 1024 {
                    return Err("Bridge 握手行过长".into());
                }
            }
        };

        let auth_response = read_line(&mut reader_stream)?;
        let auth_response = serde_json::from_str::<serde_json::Value>(&auth_response)
            .map_err(|e| format!("Bridge 鉴权响应无效: {e}"))?;
        if !crate::protocol::response_ok(&auth_response) {
            let message = auth_response
                .pointer("/payload/message")
                .and_then(|v| v.as_str())
                .unwrap_or("Bridge Token 无效");
            return Err(message.to_string());
        }
        if auth_response["type"] != "ack"
            || auth_response.pointer("/payload/refId") != auth.get("id")
            || auth_response.pointer("/payload/status").and_then(|value| value.as_str()) != Some("authenticated")
        {
            return Err("Bridge 鉴权响应与当前请求不匹配".into());
        }

        let hello: serde_json::Value = serde_json::from_str(&read_line(&mut reader_stream)?)
            .map_err(|e| format!("Bridge 设备握手无效: {e}"))?;
        if hello["type"] != "device.hello" {
            return Err("Bridge 未返回设备握手".into());
        }
        let device_id = hello.get("deviceId").or_else(|| hello.pointer("/payload/id"))
            .and_then(|id| id.as_str()).filter(|id| !id.is_empty() && *id != "android-bridge")
            .ok_or("Bridge 未返回有效的设备身份")?.to_owned();

        reader_stream.set_read_timeout(None).ok();
        self.disconnect_inner(false);

        // 后台读线程：分发 ACK；其它上报入队并 emit 给前端
        self.alive.store(true, Ordering::SeqCst);
        let alive = self.alive.clone();
        let pending = self.pending.clone();
        let events = self.events.clone();
        let info_arc = self.info.clone();
        // AppHandle 与 events 同生命周期推送；单元测试不加载 Tauri GUI 运行时。
        #[cfg(not(test))]
        let app_for_thread = {
            // 读线程需要能 emit：复制当前 AppHandle（若已 attach）
            self.app.lock().ok().and_then(|g| g.clone())
        };

        {
            let mut sock = self.socket.lock().map_err(|e| e.to_string())?;
            *sock = Some(LiveSocket {
                writer,
                reader: None,
                device_id: device_id.clone(),
                max_request_bytes: if hello.pointer("/payload/maxRequestBytes").and_then(|value| value.as_u64()) == Some(20 * 1024 * 1024) {
                    20 * 1024 * 1024
                } else {
                    16 * 1024 * 1024
                },
            });
        }

        let mut device = ConnectedDevice {
            id: device_id,
            name: "Android Bridge".into(),
            online: true,
            battery: 0,
            transport: if adb_serial.is_some() {
                "usb/adb-forward".into()
            } else {
                "loopback".into()
            },
        };

        {
            let h = &hello;
            if let Some(p) = h.get("payload") {
                if let Some(name) = p
                    .get("name")
                    .or_else(|| p.get("model"))
                    .and_then(|x| x.as_str())
                {
                    device.name = name.to_string();
                }
                if let Some(battery) = p.get("battery").and_then(|x| x.as_u64()) {
                    device.battery = battery.min(100) as u8;
                }
            }
        }

        let info = BridgeConnectionInfo {
            host: host.to_string(),
            port,
            connected: true,
            last_error: None,
            last_hello: Some(hello),
            adb_serial,
            devices: vec![device],
        };

        if let Ok(mut g) = self.info.lock() {
            *g = info.clone();
        }
        if let Some(hello) = info.last_hello.clone() {
            Self::push_event_queue(&self.events, hello.clone());
            if !self.emit_raw(BRIDGE_EVENT, &hello) {
                // The inactive listener already buffered this event.
                let active = self.events.lock().map(|b| b.active_generation.is_some()).unwrap_or(false);
                if active { Self::buffer_event(&self.events, hello, true); }
            }
        }

        let reader_handle = std::thread::spawn(move || {
            let mut reader = BufReader::new(reader_stream);
            let mut line = String::new();
            while alive.load(Ordering::SeqCst) {
                line.clear();
                match read_bounded_line(&mut reader, &mut line, 16 * 1024 * 1024) {
                    Ok(0) => break,
                    Ok(_) => {
                        let t = line.trim();
                        if !t.is_empty() {
                            tracing::debug!(bytes = t.len(), "bridge <<");
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(t) {
                                let handled = value
                                    .get("type")
                                    .and_then(|kind| kind.as_str())
                                    .filter(|kind| matches!(*kind, "ack" | "error"))
                                    .and_then(|_| value.get("payload"))
                                    .and_then(|p| p.get("refId"))
                                    .and_then(|id| id.as_str())
                                    .and_then(|ref_id| {
                                        pending.lock().ok().and_then(|mut p| p.remove(ref_id))
                                    })
                                    .map(|tx| tx.send(value.clone()).is_ok())
                                    .unwrap_or(false);
                                if !handled {
                                    // 入队 + 即时推前端（不再只靠 drain 轮询）
                                    Self::push_event_queue(&events, value.clone());
                                    #[cfg(not(test))]
                                    if let Some(ref handle) = app_for_thread {
                                        if handle.emit(BRIDGE_EVENT, &value).is_err() {
                                            let active = events.lock().map(|b| b.active_generation.is_some()).unwrap_or(false);
                                            if active { Self::buffer_event(&events, value, true); }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            alive.store(false, Ordering::SeqCst);
            if let Ok(mut pending) = pending.lock() {
                pending.clear();
            }
            if let Ok(mut info) = info_arc.lock() {
                info.connected = false;
                info.devices.iter_mut().for_each(|device| device.online = false);
                let snap = info.clone();
                drop(info);
                #[cfg(not(test))]
                if let Some(ref handle) = app_for_thread {
                    let _ = handle.emit(BRIDGE_STATUS_EVENT, &snap);
                }
                #[cfg(test)]
                let _ = snap;
            }
        });
        if let Ok(mut socket) = self.socket.lock() {
            if let Some(live) = socket.as_mut() {
                live.reader = Some(reader_handle);
            }
        }

        tracing::info!(%sock_addr, "bridge connected");
        self.emit_status();
        Ok(self.snapshot())
    }

    fn send_line(&self, line: &str, device_id: Option<&str>) -> Result<(), String> {
        let mut sock = self.socket.lock().map_err(|e| e.to_string())?;
        let live = sock
            .as_mut()
            .ok_or_else(|| "未连接 Bridge。请先在设置或手机页连接。".to_string())?;
        if device_id.is_some_and(|id| live.device_id != id) {
            return Err("所选手机与实际连接的手机不匹配".into());
        }
        if line.len() >= live.max_request_bytes {
            return Err("命令超过当前手机 Bridge 的传输上限，请减小文件或更新手机端".into());
        }

        let payload = if line.ends_with('\n') {
            line.to_string()
        } else {
            format!("{line}\n")
        };

        if let Err(error) = live.writer.write_all(payload.as_bytes()) {
            self.alive.store(false, Ordering::SeqCst);
            let _ = live.writer.shutdown(Shutdown::Both);
            return Err(format!("写入失败: {error}"));
        }
        if let Err(error) = live.writer.flush() {
            self.alive.store(false, Ordering::SeqCst);
            let _ = live.writer.shutdown(Shutdown::Both);
            return Err(format!("flush 失败: {error}"));
        }

        tracing::debug!(bytes = line.len(), "bridge >>");
        Ok(())
    }

    pub fn send_json(&self, value: &serde_json::Value) -> Result<(), String> {
        let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.send_line(&line, value.get("deviceId").and_then(|id| id.as_str()))
    }

    pub fn send_json_wait_ack(
        &self,
        value: &serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        let guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        let (id, rx) = self.start_request(value)?;
        drop(guard);
        let ack = self.wait_response(&id, rx, timeout)?;
        if crate::protocol::response_ok(&ack) {
            Ok(ack)
        } else {
            let detail = ["/payload/error", "/payload/message"].into_iter()
                .filter_map(|path| ack.pointer(path).and_then(|value| value.as_str()))
                .find(|detail| !detail.trim().is_empty())
                .unwrap_or("Android 执行失败");
            Err(detail.to_owned())
        }
    }

    pub fn request_verified_text(
        &self,
        selected_device: Option<&str>,
        phone: &str,
        text: &str,
        confirm_sent: bool,
    ) -> Result<(String, Result<serde_json::Value, String>), String> {
        let guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        let info = self.snapshot();
        if !info.connected {
            return Err("未连接 Android Bridge".into());
        }
        let hello = info.last_hello.as_ref().ok_or("未收到手机身份，请重新连接 Android Bridge")?;
        if hello.pointer("/payload/verifiedTextSend").and_then(|value| value.as_bool()) != Some(true) {
            return Err("请更新手机端 Bridge 后再发送文本".into());
        }
        if confirm_sent && hello.pointer("/payload/phoneSentConfirmation").and_then(|value| value.as_bool()) != Some(true) {
            return Err("请更新手机端 Bridge 后再使用真机群发".into());
        }
        let device_id = info.devices.first().map(|device| device.id.as_str())
            .ok_or("无法核验已连接手机的身份")?;
        if selected_device.is_some_and(|selected| selected != device_id) {
            return Err("所选手机与实际连接的手机不匹配".into());
        }
        let request = make_envelope(
            "wa.open_and_send",
            Some(device_id),
            serde_json::json!({ "phoneE164": phone, "text": text, "confirmSent": confirm_sent }),
        );
        let started = self.start_request(&request);
        drop(guard);
        let timeout = Duration::from_secs(if confirm_sent { 10 } else { 7 });
        let response = started.and_then(|(id, rx)| self.wait_response(&id, rx, timeout));
        Ok((device_id.to_owned(), response))
    }

    fn start_request(
        &self,
        value: &serde_json::Value,
    ) -> Result<(String, mpsc::Receiver<serde_json::Value>), String> {
        let id = value
            .get("id")
            .and_then(|id| id.as_str())
            .ok_or_else(|| "Bridge envelope 缺少 id".to_string())?
            .to_string();
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);

        if let Err(error) = self.send_json(value) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }

        Ok((id, rx))
    }

    fn wait_response(
        &self,
        id: &str,
        rx: mpsc::Receiver<serde_json::Value>,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        rx.recv_timeout(timeout).map_err(|error| {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(id);
            }
            match error {
                mpsc::RecvTimeoutError::Disconnected => {
                    "Android Bridge 已断开，未收到执行回执".to_string()
                }
                mpsc::RecvTimeoutError::Timeout => {
                    format!("等待 Android ACK 超时（{} 秒）", timeout.as_secs())
                }
            }
        })
    }

    pub fn drain_events(&self) -> Vec<serde_json::Value> {
        self.events
            .lock()
            .map(|mut buffer| buffer.queue.drain(..).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn failed_push_is_recovered_once_and_overflow_is_reported() {
        let state = BridgeState::default();
        assert!(state.attach_event_listener(1).active);
        BridgeState::buffer_event(&state.events, serde_json::json!({"id":"failed"}), true);
        assert_eq!(state.attach_event_listener(1).events.len(), 1);
        assert!(state.attach_event_listener(1).events.is_empty());
        for i in 0..MAX_BUFFERED_BRIDGE_EVENTS + 2 {
            BridgeState::buffer_event(&state.events, serde_json::json!({"id":i}), true);
        }
        let recovered = state.attach_event_listener(1);
        assert_eq!(recovered.events.len(), MAX_BUFFERED_BRIDGE_EVENTS);
        assert_eq!(recovered.dropped_events, 2);
        state.detach_event_listener(1);
        assert!(!state.attach_event_listener(1).active);
    }

    #[test]
    fn oversized_line_is_rejected_before_unbounded_allocation() {
        let mut line = String::new();
        let mut input = std::io::Cursor::new(b"ok\n12345678901234567890");
        assert_eq!(read_bounded_line(&mut input, &mut line, 8).unwrap(), 3);
        assert_eq!(line, "ok\n");
        line.clear();
        assert_eq!(
            read_bounded_line(&mut input, &mut line, 8)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
        assert_eq!(line.len(), 9);
    }

    #[test]
    fn remote_bridge_is_rejected_before_sending_auth() {
        let state = BridgeState::default();
        for host in ["192.168.1.10", "8.8.8.8", "[2001:4860:4860::8888]"] {
            assert!(state
                .connect(host, 17890, "test-token", None)
                .unwrap_err()
                .contains("仅允许"));
        }
    }

    #[test]
    fn verified_text_rejects_wrong_device_and_waits_for_matching_ack() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut auth_line = String::new();
            BufReader::new(socket.try_clone().unwrap())
                .read_line(&mut auth_line)
                .unwrap();
            let auth = serde_json::from_str::<serde_json::Value>(&auth_line).unwrap();
            assert_eq!(auth["type"], "bridge.auth");
            assert_eq!(auth["payload"]["token"], "test-token");
            let auth_id = auth["id"].as_str().unwrap();
            writeln!(
                socket,
                r#"{{"type":"ack","payload":{{"refId":"{auth_id}","ok":true,"status":"authenticated"}}}}"#
            )
            .unwrap();
            writeln!(socket, r#"{{"type":"device.hello","deviceId":"phone-b","payload":{{"verifiedTextSend":true}}}}"#).unwrap();
            let mut line = String::new();
            BufReader::new(socket.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            let request: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["type"], "wa.open_and_send");
            assert_eq!(request["deviceId"], "phone-b");
            assert_eq!(request["payload"]["phoneE164"], "+33600000000");
            let id = request["id"].as_str().unwrap();
            writeln!(
                socket,
                r#"{{"type":"device.status","payload":{{"online":true}}}}"#
            )
            .unwrap();
            writeln!(
                socket,
                r#"{{"type":"ack","payload":{{"refId":"{id}","ok":true,"status":"clicked"}}}}"#
            )
            .unwrap();
        });

        let state = BridgeState::default();
        state.connect("127.0.0.1", port, "test-token", None).unwrap();
        assert!(state.connect("192.0.2.1", port, "test-token", None).is_err());
        assert!(state.snapshot().connected);
        let wrong_device = make_envelope("wa.open_chat", Some("phone-a"), serde_json::json!({}));
        assert!(state.send_json(&wrong_device).unwrap_err().contains("不匹配"));
        let mismatch = state.request_verified_text(Some("phone-a"), "+33600000000", "hello", false);
        assert!(mismatch.unwrap_err().contains("不匹配"));
        assert!(state.request_verified_text(Some("phone-b"), "+33600000000", "hello", true)
            .unwrap_err().contains("更新手机端"));
        let (device, ack) = state.request_verified_text(None, "+33600000000", "hello", false).unwrap();
        assert_eq!(device, "phone-b");
        assert_eq!(ack.unwrap()["payload"]["status"], "clicked");
        assert_eq!(state.drain_events().len(), 2);
        assert!(state.drain_events().is_empty());
    }
    #[test]
    fn reconnect_keeps_new_reader_alive_and_ack_usable() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let clients: Vec<_> = (0..10).map(|i| {
                let (mut socket, _) = listener.accept().unwrap();
                std::thread::spawn(move || {
                    socket
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut reader = BufReader::new(socket.try_clone().unwrap());
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    let auth: serde_json::Value = serde_json::from_str(&line).unwrap();
                    let id = auth["id"].as_str().unwrap();
                    writeln!(socket, r#"{{"type":"ack","payload":{{"refId":"{id}","ok":true,"status":"authenticated"}}}}"#).unwrap();
                    writeln!(socket, r#"{{"type":"device.hello","payload":{{"id":"legacy-phone"}}}}"#).unwrap();
                    line.clear();
                    if i == 9 {
                        reader.read_line(&mut line).unwrap();
                        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
                        let id = value["id"].as_str().unwrap();
                        writeln!(
                            socket,
                            r#"{{"type":"ack","payload":{{"refId":"{id}","ok":true}}}}"#
                        )
                        .unwrap();
                        line.clear();
                    }
                    assert_eq!(reader.read_line(&mut line).unwrap(), 0);
                })
            }).collect();
            for client in clients {
                client.join().unwrap();
            }
        });
        let state = BridgeState::default();
        for _ in 0..10 {
            assert!(state.connect("127.0.0.1", port, "token", None).unwrap().connected);
            assert!(state.snapshot().connected);
        }
        assert!(state.request_verified_text(None, "+33600000000", "hello", false)
            .unwrap_err().contains("更新手机端"));
        let message = make_envelope("wa.open_and_send", None, serde_json::json!({}));
        assert!(state
            .send_json_wait_ack(&message, Duration::from_secs(1))
            .is_ok());
        state.disconnect();
        assert!(!state.snapshot().connected);
        server.join().unwrap();
    }
}
