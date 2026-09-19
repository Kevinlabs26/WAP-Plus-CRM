//! Baileys sidecar 管理：按 accountId 一号一进程（独立 auth 目录 + 端口）
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MAX_BRIDGE_LOG_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
pub struct BaileysState(Mutex<HashMap<String, BaileysProcess>>);

struct BaileysProcess {
    child: Child,
    runtime: BaileysRuntime,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaileysRuntime {
    pub base_url: String,
    pub token: String,
    pub account_id: String,
}

fn sanitize_account_id(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return "wa-default".into();
    }
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect()
}

fn resolve_baileys_bin() -> Result<(Command, String), String> {
    let dev_script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../baileys-bridge/index.mjs");

    #[cfg(debug_assertions)]
    {
        if dev_script.is_file() {
            let mut command = Command::new("node");
            command.arg(&dev_script);
            if let Some(dir) = dev_script.parent() {
                command.current_dir(dir);
            }
            return Ok((command, format!("node {}", dev_script.display())));
        }
    }

    // Tauri externalBin 打包后 sidecar 与主程序同目录，文件名是
    // 「wap-plus-baileys-<target三元组>.exe」（如 wap-plus-baileys-x86_64-pc-windows-msvc.exe）。
    // 不能假设固定文件名，按前缀扫描安装目录。
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    if let Some(dir) = exe_dir {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut matches: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.extension().and_then(|ext| ext.to_str()) == Some("exe")
                        && p.file_stem().and_then(|s| s.to_str()).is_some_and(|stem| {
                            stem == "wap-plus-baileys" || stem.starts_with("wap-plus-baileys-")
                        })
                })
                .collect();
            if !matches.is_empty() {
                // 多个候选并存时取字典序第一个，保证确定性
                matches.sort();
                let path = matches.swap_remove(0);
                let label = path.display().to_string();
                return Ok((Command::new(path), label));
            }
        }
    }

    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/debug/wap-plus-baileys.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/wap-plus-baileys-x86_64-pc-windows-msvc.exe"),
        dev_script.clone(),
    ];
    for path in candidates {
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("mjs") {
            let mut command = Command::new("node");
            command.arg(&path);
            if let Some(dir) = path.parent() {
                command.current_dir(dir);
            }
            return Ok((command, format!("node {}", path.display())));
        }
        let label = path.display().to_string();
        return Ok((Command::new(path), label));
    }
    Err(
        "找不到 Baileys 后端（wap-plus-baileys.exe 或 baileys-bridge/index.mjs）。请用 npm run tauri dev，并确保已构建 sidecar。"
            .into(),
    )
}

fn wait_http_ready(port: u16, token: &str, child: &mut Child) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let mut last = "等待 Baileys HTTP 启动…".to_string();

    while std::time::Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Baileys 进程已退出（{status}）。请检查本机 Node/sidecar，或重新 npm run tauri dev。"
            ));
        }

        match TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(400),
        ) {
            Ok(mut stream) => {
                let req = format!(
                    "GET /status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Wap-Token: {token}\r\nConnection: close\r\n\r\n"
                );
                if stream.write_all(req.as_bytes()).is_ok() {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
                    let mut buf = vec![0u8; 2048];
                    if let Ok(n) = stream.read(&mut buf) {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        if text.contains("200") || text.contains("connection") {
                            return Ok(());
                        }
                        last = format!(
                            "HTTP 已响应但未就绪：{}",
                            text.chars().take(120).collect::<String>()
                        );
                    }
                }
            }
            Err(e) => {
                last = format!("连接 127.0.0.1:{port}：{e}");
            }
        }
        thread::sleep(Duration::from_millis(250));
    }

    let _ = child.kill();
    Err(format!("Baileys 启动超时（20s）。{last}"))
}

fn spawn_account(app: &AppHandle, account_id: &str) -> Result<BaileysProcess, String> {
    let account_id = sanitize_account_id(account_id);
    let port = TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map_err(|e| format!("无法分配 Baileys 端口：{e}"))?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    let auth_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("baileys-auth")
        .join(&account_id);
    std::fs::create_dir_all(&auth_dir)
        .map_err(|e| format!("无法创建 Baileys 会话目录：{e}"))?;

    // 兼容旧版单目录 auth：仅默认槽且新目录为空时尝试迁移
    if account_id == "wa-default" {
        let legacy = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("baileys-auth");
        let empty = std::fs::read_dir(&auth_dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(true);
        if empty && legacy.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&legacy) {
                for ent in rd.flatten() {
                    let name = ent.file_name();
                    let n = name.to_string_lossy();
                    // 跳过子账号目录
                    if n.starts_with("wa-") && ent.path().is_dir() {
                        continue;
                    }
                    let dest = auth_dir.join(&name);
                    if !dest.exists() {
                        let _ = std::fs::rename(ent.path(), &dest)
                            .or_else(|_| std::fs::copy(ent.path(), &dest).map(|_| ()));
                    }
                }
            }
        }
    }

    let (mut command, bin_label) = resolve_baileys_bin()?;
    let log_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(format!("baileys-bridge-{account_id}.log"));
    if std::fs::metadata(&log_path)
        .map(|meta| meta.len() > MAX_BRIDGE_LOG_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::File::create(&log_path);
    }
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();

    command
        .env("WAP_BAILEYS_PORT", port.to_string())
        .env("WAP_BAILEYS_TOKEN", &token)
        .env("WAP_BAILEYS_AUTH_DIR", &auth_dir)
        .env("WAP_BAILEYS_ACCOUNT_ID", &account_id)
        .env("WAP_PARENT_PID", std::process::id().to_string())
        // 仅显式开启时记录同步细节，避免把客户数据长期写入本地日志。
        .env(
            "WAP_SYNC_DEBUG",
            std::env::var("WAP_SYNC_DEBUG").unwrap_or_else(|_| "0".into()),
        )
        .env(
            "WAP_BAILEYS_LOG",
            std::env::var("WAP_BAILEYS_LOG").unwrap_or_else(|_| "warn".into()),
        )
        .stdin(Stdio::null());
    if let Some(file) = log_file {
        let err = file.try_clone().ok();
        command.stdout(Stdio::from(file));
        if let Some(err) = err {
            command.stderr(Stdio::from(err));
        } else {
            command.stderr(Stdio::null());
        }
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    tracing::info!(%bin_label, port, %account_id, "starting baileys sidecar");
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 Baileys 失败（{bin_label}）：{e}"))?;

    wait_http_ready(port, &token, &mut child)?;

    Ok(BaileysProcess {
        child,
        runtime: BaileysRuntime {
            base_url: format!("http://127.0.0.1:{port}"),
            token,
            account_id,
        },
    })
}

impl BaileysState {
    pub fn runtime_for(
        &self,
        app: &AppHandle,
        account_id: &str,
    ) -> Result<BaileysRuntime, String> {
        let key = sanitize_account_id(account_id);
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(process) = guard.get_mut(&key) {
            if process.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(process.runtime.clone());
            }
            let _ = process.child.kill();
            guard.remove(&key);
        }
        let process = spawn_account(app, &key)?;
        let runtime = process.runtime.clone();
        guard.insert(key, process);
        Ok(runtime)
    }

    pub fn stop_account(&self, account_id: &str) -> Result<(), String> {
        let key = sanitize_account_id(account_id);
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut process) = guard.remove(&key) {
            let _ = process.child.kill();
        }
        Ok(())
    }
}

/// 兼容旧调用：无 accountId 时用 wa-default
#[tauri::command]
pub fn baileys_runtime(
    app: AppHandle,
    state: tauri::State<'_, BaileysState>,
    account_id: Option<String>,
) -> Result<BaileysRuntime, String> {
    let id = account_id.unwrap_or_else(|| "wa-default".into());
    state.runtime_for(&app, &id)
}

#[tauri::command]
pub fn baileys_stop_account(
    state: tauri::State<'_, BaileysState>,
    account_id: String,
) -> Result<(), String> {
    state.stop_account(&account_id)
}

impl Drop for BaileysState {
    fn drop(&mut self) {
        if let Ok(map) = self.0.get_mut() {
            for (_, process) in map.iter_mut() {
                let _ = process.child.kill();
            }
        }
    }
}
