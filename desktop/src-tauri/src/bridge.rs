//! Android Bridge TCP 客户端（行协议：每行一条 JSON envelope）

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
#[cfg(not(test))]
use tauri::{AppHandle, Emitter};

pub use crate::protocol::make_envelope;

/// 前端 `listen` 的事件名
pub const BRIDGE_EVENT: &str = "bridge://event";
pub const BRIDGE_STATUS_EVENT: &str = "bridge://status";

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
            devices: vec![],
        }
    }
}

struct LiveSocket {
    writer: TcpStream,
}

pub struct BridgeState {
    pub info: Arc<Mutex<BridgeConnectionInfo>>,
    socket: Mutex<Option<LiveSocket>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>,
    events: Arc<Mutex<VecDeque<serde_json::Value>>>,
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
            pending: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(Mutex::new(VecDeque::new())),
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

    fn emit_raw(&self, event: &str, payload: &impl Serialize) {
        #[cfg(not(test))]
        if let Ok(g) = self.app.lock() {
            if let Some(app) = g.as_ref() {
                let _ = app.emit(event, payload);
            }
        }
        #[cfg(test)]
        let _ = (event, payload);
    }

    pub fn emit_status(&self) {
        let snap = self.snapshot();
        self.emit_raw(BRIDGE_STATUS_EVENT, &snap);
    }

    fn push_event_queue(events: &Mutex<VecDeque<serde_json::Value>>, value: serde_json::Value) {
        if let Ok(mut queue) = events.lock() {
            // ponytail: bounded inbox; move to durable event storage if bursts exceed 1000.
            if queue.len() == 1000 {
                queue.pop_front();
            }
            queue.push_back(value.clone());
        }
    }

    pub fn snapshot(&self) -> BridgeConnectionInfo {
        let mut info = self
            .info
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        info.connected &= self.alive.load(Ordering::SeqCst);
        info
    }

    pub fn disconnect(&self) {
        self.disconnect_inner(true);
    }

    fn disconnect_inner(&self, emit: bool) {
        if let Ok(mut guard) = self.socket.lock() {
            if let Some(live) = guard.take() {
                let _ = live.writer.shutdown(Shutdown::Both);
            }
        }
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut info) = self.info.lock() {
            info.connected = false;
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
    ) -> Result<BridgeConnectionInfo, String> {
        // 重连过程中不推断开，避免前端连闪 toast
        self.disconnect_inner(false);

        let token = token.trim();
        if token.is_empty() {
            return Err("缺少 Android Bridge Token，请先在手机 Bridge 页面复制 Token".into());
        }

        let addr_label = format!("{host}:{port}");
        // 先按 IP 字面量解析；失败再走系统域名解析（支持 localhost / 主机名）。
        let resolved = addr_label
            .parse::<std::net::SocketAddr>()
            .ok()
            .or_else(|| {
                use std::net::ToSocketAddrs;
                (host, port).to_socket_addrs().ok().and_then(|mut addrs| addrs.next())
            });
        let Some(sock_addr) = resolved else {
            return Err(format!("地址无效 {addr_label}"));
        };
        let stream = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(3))
            .map_err(|e| format!("连接 Bridge 失败 {addr_label}: {e}"))?;

        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .ok();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .ok();
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
        let read_line = |reader: &mut TcpStream| -> Result<String, String> {
            let mut bytes = Vec::with_capacity(256);
            loop {
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
        if auth_response.pointer("/payload/ok").and_then(|v| v.as_bool()) != Some(true) {
            let message = auth_response
                .pointer("/payload/message")
                .and_then(|v| v.as_str())
                .unwrap_or("Bridge Token 无效");
            return Err(message.to_string());
        }

        // 读一行 hello（可选）：
        // Android 在 hello 后会立刻连发 status/battery 行，若用临时
        // BufReader 只读一行，缓冲区里的后续行会随 reader 一起被丢弃。
        let mut hello: Option<serde_json::Value> = None;
        {
            match read_line(&mut reader_stream) {
                Ok(line) if !line.is_empty() => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                        hello = Some(v);
                    }
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "read hello"),
            }
        }

        reader_stream.set_read_timeout(None).ok();

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
            self.app
                .lock()
                .ok()
                .and_then(|g| g.clone())
        };

        std::thread::spawn(move || {
            let mut reader = BufReader::new(reader_stream);
            let mut line = String::new();
            while alive.load(Ordering::SeqCst) {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let t = line.trim();
                        if !t.is_empty() {
                            tracing::debug!(bytes = t.len(), "bridge <<");
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(t) {
                                let handled = value
                                    .get("payload")
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
                                        let _ = handle.emit(BRIDGE_EVENT, &value);
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            alive.store(false, Ordering::SeqCst);
            if let Ok(mut info) = info_arc.lock() {
                info.connected = false;
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

        {
            let mut sock = self.socket.lock().map_err(|e| e.to_string())?;
            *sock = Some(LiveSocket { writer });
        }

        let mut device = ConnectedDevice {
            id: "bridge-1".into(),
            name: "Android Bridge".into(),
            online: true,
            battery: 0,
            transport: if host == "127.0.0.1" || host == "localhost" {
                "usb/adb-reverse".into()
            } else {
                "wifi".into()
            },
        };

        if let Some(ref h) = hello {
            if let Some(p) = h.get("payload") {
                if let Some(id) = h
                    .get("deviceId")
                    .or_else(|| p.get("id"))
                    .and_then(|x| x.as_str())
                {
                    device.id = id.to_string();
                }
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
            last_hello: hello,
            devices: vec![device],
        };

        if let Ok(mut g) = self.info.lock() {
            *g = info.clone();
        }
        if let Some(hello) = info.last_hello.clone() {
            Self::push_event_queue(&self.events, hello.clone());
            self.emit_raw(BRIDGE_EVENT, &hello);
        }

        tracing::info!(%addr_label, "bridge connected");
        self.emit_status();
        Ok(info)
    }

    pub fn send_line(&self, line: &str) -> Result<(), String> {
        let mut sock = self.socket.lock().map_err(|e| e.to_string())?;
        let live = sock
            .as_mut()
            .ok_or_else(|| "未连接 Bridge。请先在设置或手机页连接。".to_string())?;

        let payload = if line.ends_with('\n') {
            line.to_string()
        } else {
            format!("{line}\n")
        };

        if let Err(error) = live.writer.write_all(payload.as_bytes()) {
            self.alive.store(false, Ordering::SeqCst);
            return Err(format!("写入失败: {error}"));
        }
        if let Err(error) = live.writer.flush() {
            self.alive.store(false, Ordering::SeqCst);
            return Err(format!("flush 失败: {error}"));
        }

        tracing::debug!(bytes = line.len(), "bridge >>");
        Ok(())
    }

    pub fn send_json(&self, value: &serde_json::Value) -> Result<(), String> {
        let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.send_line(&line)
    }

    pub fn send_json_wait_ack(
        &self,
        value: &serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
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

        let ack = rx.recv_timeout(timeout).map_err(|_| {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            format!("等待 Android ACK 超时（{} 秒）", timeout.as_secs())
        })?;
        if ack
            .get("payload")
            .and_then(|p| p.get("ok"))
            .and_then(|ok| ok.as_bool())
            == Some(true)
        {
            Ok(ack)
        } else {
            // Android 失败信封是 {refId, code, message}（无 ok/error 键）；
            // 兼容读取 error → message，避免具体失败原因被笼统文案覆盖。
            let payload = ack.get("payload");
            let detail = payload
                .and_then(|p| p.get("error"))
                .and_then(|e| e.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    payload
                        .and_then(|p| p.get("message"))
                        .and_then(|m| m.as_str())
                })
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("Android 执行失败")
                .to_string();
            Err(detail)
        }
    }

    pub fn drain_events(&self) -> Vec<serde_json::Value> {
        self.events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn waits_for_matching_ack() {
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
            writeln!(socket, r#"{{"type":"device.hello","payload":{{}}}}"#).unwrap();
            let mut line = String::new();
            BufReader::new(socket.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            let id = serde_json::from_str::<serde_json::Value>(&line).unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string();
            writeln!(socket, r#"{{"type":"device.status","payload":{{"online":true}}}}"#).unwrap();
            writeln!(socket, r#"{{"type":"ack","payload":{{"refId":"{id}","ok":true}}}}"#).unwrap();
        });

        let state = BridgeState::default();
        state.connect("127.0.0.1", port, "test-token").unwrap();
        let message = make_envelope("wa.open_and_send", None, serde_json::json!({}));
        assert!(state
            .send_json_wait_ack(&message, Duration::from_secs(1))
            .is_ok());
        assert_eq!(state.drain_events().len(), 2);
        assert!(state.drain_events().is_empty());
    }
}
