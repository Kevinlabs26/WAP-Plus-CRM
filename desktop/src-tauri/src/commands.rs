//! Tauri 命令：前端通过 invoke 调用

use crate::bridge::{make_envelope, BridgeConnectionInfo, BridgeState};
use crate::db::{self, AppSnapshot, DbState};
use crate::protocol::{response_error, response_ok};
use serde::{Deserialize, Serialize};
#[cfg(any(windows, target_os = "macos"))]
pub(crate) use crate::dpapi::{protect_secrets, unprotect_secrets};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
const NOTIFICATION_APP_ID: &str = "com.wapplus.crm";

#[cfg(windows)]
fn notification_app_icon(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("wapplus-notification-icon.png");
    if !path.exists() {
        std::fs::write(&path, include_bytes!("../icons/icon.png")).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[cfg(windows)]
fn register_notification_identity(app: &AppHandle) -> Result<(), String> {
    use windows_registry::CURRENT_USER;

    let icon = notification_app_icon(app)?;
    let key = CURRENT_USER
        .create(format!(
            r"SOFTWARE\Classes\AppUserModelId\{NOTIFICATION_APP_ID}"
        ))
        .map_err(|e| e.to_string())?;
    key.set_string("DisplayName", "WAP Plus CRM")
        .map_err(|e| e.to_string())?;
    key.set_string("IconBackgroundColor", "0")
        .map_err(|e| e.to_string())?;
    key.set_hstring("IconUri", &icon.as_path().into())
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn notification_avatar(app: &AppHandle, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    use std::hash::{DefaultHasher, Hash, Hasher};

    if bytes.is_empty() || bytes.len() > 512_000 {
        return Ok(None);
    }
    let extension = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        "jpg"
    } else {
        return Ok(None);
    };
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "notification-avatar-{:x}.{extension}",
        hasher.finish()
    ));
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(Some(path))
}

/** Windows 自适应通知：品牌身份、会话头像、未读汇总与打开按钮。 */
#[tauri::command]
pub fn show_windows_branded_notification(
    app: AppHandle,
    title: String,
    body: String,
    tag: Option<String>,
    avatar_bytes: Option<Vec<u8>>,
    unread_count: Option<u32>,
    open_download_folder: Option<bool>,
    action_label: Option<String>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{IconCrop, Toast};

        register_notification_identity(&app)?;
        let avatar = avatar_bytes
            .as_deref()
            .map(|bytes| notification_avatar(&app, bytes))
            .transpose()?
            .flatten();
        let click_app = app.clone();
        let mut toast = Toast::new(NOTIFICATION_APP_ID).title(&title).text1(&body);
        if let Some(count) = unread_count.filter(|count| *count > 0) {
            toast = toast.text2(&format!("{count} 条未读消息"));
        }
        if let Some(avatar) = avatar.as_deref() {
            toast = toast.icon(avatar, IconCrop::Circular, "会话头像");
        }
        let downloads = open_download_folder.unwrap_or(false);
        toast
            .add_button(action_label.as_deref().filter(|label| !label.trim().is_empty() && label.chars().count() <= 40).unwrap_or(if downloads { "打开下载文件夹" } else { "打开会话" }), "open")
            .on_activated(move |_| {
                if downloads {
                    let _ = open_chat_media_folder(click_app.clone());
                } else {
                    crate::show_main_window(&click_app);
                    if let Some(tag) = tag.as_ref() {
                        let _ = click_app.emit("wapplus://notification-click", tag);
                    }
                }
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }

    #[cfg(not(windows))]
    {
        let _ = (app, title, body, tag, avatar_bytes, unread_count, open_download_folder, action_label);
        Ok(false)
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SecureSecrets {
    pub openai_key: String,
    pub groq_key: String,
    #[serde(default)]
    pub gemini_key: String,
    #[serde(default)]
    pub vertex_credential: String,
    #[serde(default)]
    pub openrouter_key: String,
    #[serde(default)]
    pub custom_ai_key: String,
    #[serde(default)]
    pub transcription_api_key: String,
    #[serde(default)]
    pub translation_api_key: String,
    #[serde(default)]
    pub bridge_token: String,
}

fn secure_secrets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.dpapi"))
}

#[tauri::command(async)]
pub fn typing_diagnostic_write(app: AppHandle, line: String, reset: bool) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("typing-diagnostics.log");
    let clean = line.replace(['\r', '\n'], " ");
    let clean = clean.chars().take(4096).collect::<String>();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!reset)
        .truncate(reset)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{clean}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_save_secrets(app: AppHandle, secrets: SecureSecrets) -> Result<(), String> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let raw = serde_json::to_vec(&secrets).map_err(|e| e.to_string())?;
        let encrypted = protect_secrets(&raw)?;
        crate::atomic_file::write_atomic(&secure_secrets_path(&app)?, &encrypted)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, secrets);
        Err("安全密钥存储仅支持 Windows 桌面版".into())
    }
}

#[tauri::command]
pub fn secure_load_secrets(app: AppHandle) -> Result<Option<SecureSecrets>, String> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let path = secure_secrets_path(&app)?;
        let encrypted = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let raw = unprotect_secrets(&encrypted)?;
        serde_json::from_slice(&raw)
            .map(Some)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Err("安全密钥存储仅支持 Windows 桌面版".into())
    }
}

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub mvp: bool,
}

#[derive(Debug, Serialize)]
pub struct DroppedFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

const MAX_CHAT_MEDIA_SAVE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMediaSaveProgress {
    request_id: String,
    written: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedChatMedia {
    file_name: String,
    path: String,
}

fn safe_chat_media_filename(input: &str) -> String {
    let leaf = input.replace('\\', "/");
    let leaf = leaf.rsplit('/').next().unwrap_or_default();
    let safe: String = leaf
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim().trim_matches('.');
    if safe.is_empty() {
        "media.bin".into()
    } else {
        let mut name: String = safe.chars().take(120).collect();
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) {
            name.insert(0, '_');
        }
        name
    }
}

fn chat_media_candidate(folder: &std::path::Path, name: &str, suffix: usize) -> PathBuf {
    if suffix == 0 {
        return folder.join(name);
    }
    let split = name
        .rfind('.')
        .filter(|index| *index > 0)
        .unwrap_or(name.len());
    folder.join(format!("{} ({suffix}){}", &name[..split], &name[split..]))
}

#[tauri::command]
pub async fn save_chat_media(
    app: AppHandle,
    data_url: String,
    filename: String,
    request_id: String,
) -> Result<SavedChatMedia, String> {
    use base64::Engine;

    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "媒体数据格式无效".to_string())?;
    let max_encoded = 4 * MAX_CHAT_MEDIA_SAVE_BYTES.div_ceil(3);
    if !header.starts_with("data:")
        || !header.to_ascii_lowercase().contains(";base64")
        || encoded.is_empty()
        || encoded.len() > max_encoded
    {
        return Err("媒体数据格式无效或超过 16 MB".into());
    }
    let encoded = encoded.to_string();
    let filename = safe_chat_media_filename(&filename);
    let request_id: String = request_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(80)
        .collect();
    if request_id.is_empty() {
        return Err("下载请求编号无效".into());
    }
    let folder = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法定位系统下载文件夹：{error}"))?
        .join("WAP Plus CRM");
    let worker_app = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("媒体解码失败：{error}"))?;
        if bytes.is_empty() || bytes.len() > MAX_CHAT_MEDIA_SAVE_BYTES {
            return Err("媒体为空或超过 16 MB".into());
        }
        std::fs::create_dir_all(&folder).map_err(|error| format!("无法创建下载文件夹：{error}"))?;
        let temporary = folder.join(format!(".media-{request_id}.part"));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("无法开始保存媒体：{error}"))?;
        let total = bytes.len();
        let mut written = 0;
        let mut last_reported = 0;
        for chunk in bytes.chunks(256 * 1024) {
            if let Err(error) = file.write_all(chunk) {
                drop(file);
                let _ = std::fs::remove_file(&temporary);
                return Err(format!("写入媒体失败：{error}"));
            }
            written += chunk.len();
            if written - last_reported >= 1024 * 1024 || written == total {
                let _ = worker_app.emit(
                    "chat-media-save-progress",
                    ChatMediaSaveProgress {
                        request_id: request_id.clone(),
                        written,
                        total,
                    },
                );
                last_reported = written;
            }
        }
        if let Err(error) = file.sync_all() {
            drop(file);
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("媒体保存未完成：{error}"));
        }
        drop(file);

        let mut suffix = 0;
        let path = loop {
            let candidate = chat_media_candidate(&folder, &filename, suffix);
            match std::fs::hard_link(&temporary, &candidate) {
                Ok(()) => break candidate,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => suffix += 1,
                Err(error) => {
                    let _ = std::fs::remove_file(&temporary);
                    return Err(format!("无法完成媒体保存：{error}"));
                }
            }
        };
        let _ = std::fs::remove_file(&temporary);
        Ok(SavedChatMedia {
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("media.bin")
                .to_string(),
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| format!("媒体保存任务失败：{error}"))?
}

#[tauri::command]
pub fn open_chat_media_folder(app: AppHandle) -> Result<(), String> {
    let folder = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法定位系统下载文件夹：{error}"))?
        .join("WAP Plus CRM");
    std::fs::create_dir_all(&folder).map_err(|error| format!("无法打开下载文件夹：{error}"))?;
    #[cfg(windows)]
    let result = Command::new("explorer.exe").arg(&folder).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&folder).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&folder).spawn();
    result
        .map(|_| ())
        .map_err(|error| format!("无法打开下载文件夹：{error}"))
}

fn read_binary_attachment(path: String, extensions: &[&str]) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed))) {
        return Err("附件格式不支持".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("无法读取附件：{e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let limit = 100 * 1024 * 1024;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit { return Err("附件为空或超过 100 MiB".into()); }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit { return Err("附件超过 100 MiB".into()); }
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn read_dropped_video(path: String) -> Result<tauri::ipc::Response, String> { read_binary_attachment(path, &["mp4"]) }

#[tauri::command]
pub fn read_dropped_audio(path: String) -> Result<tauri::ipc::Response, String> {
    read_binary_attachment(path, &["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"])
}

#[tauri::command]
pub fn read_dropped_file(path: String) -> Result<DroppedFile, String> {
    let file_path = PathBuf::from(&path);
    let file = std::fs::File::open(&file_path).map_err(|e| format!("无法读取拖入文件：{e}"))?;
    let metadata = file.metadata().map_err(|e| format!("无法读取拖入文件：{e}"))?;
    if !metadata.is_file() {
        return Err("拖入的项目不是文件".into());
    }
    let mp4 = file_path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("mp4"));
    let audio = file_path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext|
        matches!(ext.to_ascii_lowercase().as_str(), "m4a" | "aac" | "mp3" | "wav" | "flac" | "ogg" | "oga" | "opus"));
    let limit = (if mp4 { 24 } else if audio { 16 } else { 14 }) * 1024 * 1024;
    if metadata.len() > limit {
        return Err(if mp4 { "视频超过 24 MB，请先压缩" } else if audio { "音频超过 16 MiB" } else { "文件请小于 14MB" }.into());
    }
    // Bound the actual read too: a selected file can grow after the metadata check.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("无法读取拖入文件：{e}"))?;
    if bytes.len() as u64 > limit { return Err("拖入文件超过大小限制".into()); }
    let mime = match file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };
    Ok(DroppedFile {
        name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("dropped-file")
            .to_string(),
        mime: mime.to_string(),
        bytes,
    })
}

#[tauri::command]
pub fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app.get_webview_window("main").ok_or("主窗口不可用")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        crate::clipboard::write_text(hwnd.0, &text)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        crate::clipboard_macos::write_text(&text)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    { let _ = (app, text); Err("请使用系统复制按钮".into()) }
}

#[tauri::command]
pub fn clipboard_write_image(app: AppHandle, png_base64: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不可用".to_string())?;
        let hwnd = window
            .hwnd()
            .map_err(|e| format!("获取窗口句柄失败：{e}"))?;
        crate::clipboard::write_png(hwnd.0, &png_base64)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        crate::clipboard_macos::write_png(&png_base64)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, png_base64);
        Err("当前平台暂不支持原生图片剪贴板".into())
    }
}

#[derive(Debug, Serialize)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
}

fn adb_command() -> Command {
    let executable = format!("adb{}", std::env::consts::EXE_SUFFIX);
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(root) = std::env::var_os(key) {
            let path = PathBuf::from(root).join("platform-tools").join(&executable);
            if path.is_file() {
                return Command::new(path);
            }
        }
    }
    let default_sdk = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Android/Sdk"))
    } else {
        std::env::var_os("HOME").map(|root| PathBuf::from(root).join(if cfg!(target_os = "macos") {
            "Library/Android/sdk"
        } else {
            "Android/Sdk"
        }))
    };
    if let Some(root) = default_sdk {
        let path = root.join("platform-tools").join(&executable);
        if path.is_file() {
            return Command::new(path);
        }
    }
    #[cfg(target_os = "macos")]
    for path in ["/opt/homebrew/bin/adb", "/usr/local/bin/adb"] {
        if std::path::Path::new(path).is_file() {
            return Command::new(path);
        }
    }
    Command::new(executable)
}

const ANDROID_BRIDGE_PORT: u16 = 17890;

fn adb_output(args: &[&str]) -> Result<Vec<u8>, String> {
    let output = adb_command().args(args).output()
        .map_err(|e| format!("无法执行 adb：{e}。请安装 Android platform-tools。"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(if detail.is_empty() {
            format!("ADB 执行失败：{}", output.status)
        } else {
            detail.to_owned()
        });
    }
    Ok(output.stdout)
}

fn adb_forward_serial(port: u16) -> Option<String> {
    let output = adb_output(&["forward", "--list"]).ok()?;
    forwarded_android_serial(&String::from_utf8_lossy(&output), port)
}

fn forwarded_android_serial(output: &str, port: u16) -> Option<String> {
    let local = format!("tcp:{port}");
    let remote = format!("tcp:{ANDROID_BRIDGE_PORT}");
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let serial = parts.next()?;
        (parts.next()? == local && parts.next()? == remote).then(|| serial.to_owned())
    })
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "WAP Plus CRM",
        version: env!("CARGO_PKG_VERSION"),
        mvp: true,
    }
}

#[tauri::command(async)]
pub fn list_adb_devices() -> Result<Vec<AdbDevice>, String> {
    let output = adb_output(&["devices"])?;
    let stdout = String::from_utf8_lossy(&output);
    let mut devices = Vec::new();
    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        if let (Some(serial), Some(state)) = (parts.next(), parts.next()) {
            devices.push(AdbDevice {
                serial: serial.to_string(),
                state: state.to_string(),
            });
        }
    }
    Ok(devices)
}

#[tauri::command(async)]
pub fn adb_forward(port: u16, serial: Option<String>) -> Result<String, String> {
    if port == 0 { return Err("电脑端口必须在 1 到 65535 之间".into()); }
    let devices = list_adb_devices()?;
    let online: Vec<_> = devices.iter().filter(|device| device.state == "device").collect();
    let serial = match (serial, online.as_slice()) {
        (Some(serial), choices) if choices.iter().any(|device| device.serial == serial) => serial,
        (Some(_), _) => return Err("所选 ADB 设备未连接或未授权".into()),
        (None, [device]) => device.serial.clone(),
        (None, []) => return Err("未检测到已授权的 ADB 设备，请检查 USB 调试".into()),
        (None, _) => return Err("请先扫描 ADB 并选择要连接的手机".into()),
    };
    let local = format!("tcp:{port}");
    let remote = format!("tcp:{ANDROID_BRIDGE_PORT}");
    if adb_forward_serial(port).as_deref() != Some(serial.as_str()) {
        adb_output(&["-s", &serial, "forward", "--no-rebind", &local, &remote])?;
    }
    Ok(format!("adb -s {serial} forward {local} {remote} OK"))
}

#[tauri::command(async)]
pub fn adb_install_bridge(app: AppHandle, serial: Option<String>) -> Result<bool, String> {
    let devices = list_adb_devices()?;
    let device = match serial.as_deref() {
        Some(serial) => devices
            .iter()
            .find(|device| device.serial == serial)
            .ok_or("找不到所选手机，请重新扫描 ADB")?,
        None => match devices.as_slice() {
            [device] => device,
            [] => return Err("未检测到手机，请连接 USB 数据线并开启 USB 调试".into()),
            _ => return Err("检测到多个设备，请先扫描 ADB 并选择目标手机".into()),
        },
    };
    match device.state.as_str() {
        "device" => {}
        "unauthorized" => return Err("手机尚未授权，请解锁手机并允许 USB 调试".into()),
        _ => return Err("手机当前不可用，请重新连接 USB 后重试".into()),
    }

    let target = device.serial.as_str();
    let installed = adb_output(&[
        "-s", target, "shell", "pm", "list", "packages", "--user", "current", "com.wapplus.bridge",
    ])?;
    if String::from_utf8_lossy(&installed)
        .lines()
        .any(|line| line.trim() == "package:com.wapplus.bridge")
    {
        return Ok(false);
    }

    let mut apk = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/android-bridge/bridge.apk");
    if cfg!(debug_assertions) && !apk.is_file() {
        apk = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../android/app/build/outputs/apk/debug/app-debug.apk");
    }
    if !apk.is_file() {
        return Err("当前桌面版本缺少 WAP Plus Bridge 安装包".into());
    }
    let apk = apk.to_str().ok_or("无法读取 Bridge 安装包路径")?;
    adb_output(&["-s", target, "install", "--user", "current", apk])?;
    Ok(true)
}

#[tauri::command(async)]
pub fn phone_screenshot(state: State<'_, BridgeState>, device_id: Option<String>) -> Result<Vec<u8>, String> {
    let info = state.snapshot();
    if device_id.as_deref().is_some_and(|id| info.devices.first().map(|device| device.id.as_str()) != Some(id)) {
        return Err("所选手机与实际连接的手机不匹配".into());
    }
    let serial = info.adb_serial.as_deref().filter(|_| info.connected)
        .ok_or("请先通过 ADB 转发连接手机，再打开屏幕预览")?;
    if adb_forward_serial(info.port).as_deref() != Some(serial) {
        return Err("ADB 转发已变化，请重新连接目标手机".into());
    }
    let png = adb_output(&["-s", serial, "exec-out", "screencap", "-p"])?;
    let current = state.snapshot();
    if !current.connected || current.port != info.port || current.adb_serial.as_deref() != Some(serial) {
        return Err("手机连接已变化，请重新打开屏幕预览".into());
    }
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("手机没有返回有效的 PNG 截图".into());
    }
    Ok(png)
}

#[tauri::command]
pub fn bridge_status(state: State<'_, BridgeState>) -> BridgeConnectionInfo {
    state.snapshot()
}

#[tauri::command(async)]
pub fn bridge_connect(
    state: State<'_, BridgeState>,
    host: String,
    port: u16,
    token: String,
) -> Result<BridgeConnectionInfo, String> {
    let serial = (host.trim() == "127.0.0.1" || host.trim().eq_ignore_ascii_case("localhost"))
        .then(|| adb_forward_serial(port)).flatten();
    state.connect(&host, port, &token, serial)
}

#[tauri::command(async)]
pub fn bridge_disconnect(state: State<'_, BridgeState>) -> Result<(), String> {
    state.disconnect();
    Ok(())
}

#[tauri::command]
pub fn bridge_drain_events(state: State<'_, BridgeState>) -> Vec<serde_json::Value> {
    state.drain_events()
}

#[tauri::command]
pub fn bridge_attach_event_listener(
    state: State<'_, BridgeState>,
    generation: u64,
) -> crate::bridge::BridgeEventDrain {
    state.attach_event_listener(generation)
}

#[tauri::command]
pub fn bridge_detach_event_listener(state: State<'_, BridgeState>, generation: u64) {
    state.detach_event_listener(generation);
}

#[tauri::command(async)]
pub fn bridge_send_raw(
    state: State<'_, BridgeState>,
    envelope: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if envelope["type"] != "wa.prepare_media" {
        return Err("Bridge 仅支持在此入口准备语音回传".into());
    }
    state.send_json_wait_ack(&envelope, Duration::from_secs(7))
}

#[tauri::command(async)]
pub fn save_phone_contact(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    name: String,
    phone_e164: String,
) -> Result<serde_json::Value, String> {
    let name = name.trim();
    let phone = phone_e164.trim();
    let digits = phone.strip_prefix('+').unwrap_or("");
    if name.is_empty()
        || !(7..=15).contains(&digits.len())
        || !digits.chars().all(|c| c.is_ascii_digit())
    {
        return Err("联系人姓名或号码无效".into());
    }
    let envelope = make_envelope(
        "contacts.save",
        device_id.as_deref(),
        serde_json::json!({ "name": name, "phoneE164": phone }),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(7))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(ack)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneContactInput {
    pub name: String,
    pub phone_e164: String,
}

#[tauri::command(async)]
pub fn save_phone_contacts(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    contacts: Vec<PhoneContactInput>,
) -> Result<serde_json::Value, String> {
    if contacts.is_empty() || contacts.len() > 500 {
        return Err("联系人批次应包含 1 至 500 项".into());
    }
    for contact in &contacts {
        let name = contact.name.trim();
        let phone = contact.phone_e164.trim();
        let digits = phone.strip_prefix('+').unwrap_or("");
        if name.is_empty()
            || name.chars().count() > 100
            || !(7..=15).contains(&digits.len())
            || !digits.chars().all(|c| c.is_ascii_digit())
        {
            return Err("批次中包含无效的联系人姓名或号码".into());
        }
    }
    let envelope = make_envelope(
        "contacts.save_batch",
        device_id.as_deref(),
        serde_json::json!({ "items": contacts }),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(45))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(ack)
}

#[tauri::command(async)]
pub fn open_whatsapp_chat(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    phone_e164: String,
    display_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let did = device_id.as_deref();
    let envelope = make_envelope(
        "wa.open_chat",
        did,
        serde_json::json!({
            "phoneE164": phone_e164,
            "displayName": display_name,
        }),
    );
    tracing::debug!(phone_length = phone_e164.len(), "open_whatsapp_chat");

    let response = state.send_json_wait_ack(&envelope, Duration::from_secs(7))?;
    let delivered = response_ok(&response);
    Ok(serde_json::json!({
        "envelope": envelope,
        "ack": response,
        "delivered": delivered,
        "note": if delivered { "Android 已打开聊天" } else { "Android 未打开聊天" },
    }))
}

#[tauri::command(async)]
pub fn sync_whatsapp_conversations(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let envelope = make_envelope(
        "wa.sync_conversations",
        device_id.as_deref(),
        serde_json::json!({}),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(60))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(serde_json::json!({ "ack": ack, "synced": true }))
}

#[tauri::command(async)]
pub fn search_whatsapp_contact(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    query: String,
) -> Result<serde_json::Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("搜索名称为空".into());
    }
    let envelope = make_envelope(
        "wa.search_contact",
        device_id.as_deref(),
        serde_json::json!({ "query": query }),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(15))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(serde_json::json!({
        "opened": ack.pointer("/payload/opened").and_then(|v| v.as_bool()).unwrap_or(false),
        "candidates": ack.pointer("/payload/items").cloned().unwrap_or_else(|| serde_json::json!([])),
        "ack": ack,
    }))
}

#[tauri::command(async)]
pub fn send_whatsapp_media(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    phone_e164: Option<String>,
    data_url: String,
    file_name: String,
    mime: String,
    caption: Option<String>,
) -> Result<serde_json::Value, String> {
    validate_android_media(&data_url)?;
    let envelope = make_envelope(
        "wa.send_media",
        device_id.as_deref(),
        serde_json::json!({
            "phoneE164": phone_e164,
            "dataUrl": data_url,
            "fileName": file_name,
            "mime": mime,
            "caption": caption,
        }),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(20))?;
    if ack.pointer("/payload/status").and_then(|status| status.as_str()) != Some("opened") {
        return Err("手机未确认打开 WhatsApp 分享页".into());
    }
    Ok(serde_json::json!({
        "ack": ack,
        "opened": true,
        "delivered": false,
        "note": "请在手机核对收件人并确认发送",
    }))
}

fn validate_android_media(data_url: &str) -> Result<(), String> {
    use base64::Engine as _;
    const MAX_BYTES: usize = 14 * 1024 * 1024;
    let (_, encoded) = data_url.split_once(',')
        .filter(|(header, _)| header.starts_with("data:") && header.ends_with(";base64") && header.len() <= 512)
        .ok_or("媒体数据无效")?;
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("手机分享文件上限为 14 MiB".into());
    }
    let size = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "媒体数据无效")?.len();
    if size == 0 || size > MAX_BYTES {
        return Err("文件为空或超过 14 MiB".into());
    }
    Ok(())
}

#[cfg(test)]
mod android_bridge_tests {
    use super::{forwarded_android_serial, validate_android_media};
    use base64::Engine as _;

    #[test]
    fn forwards_only_the_port_leading_to_android_bridge() {
        let listing = "phone-a tcp:17890 tcp:9999\nphone-b tcp:17891 tcp:17890\n";
        assert_eq!(forwarded_android_serial(listing, 17890), None);
        assert_eq!(forwarded_android_serial(listing, 17891).as_deref(), Some("phone-b"));
    }

    #[test]
    fn android_media_enforces_the_decoded_limit() {
        let encode = |size| format!("data:audio/ogg;base64,{}", base64::engine::general_purpose::STANDARD.encode(vec![0; size]));
        assert!(validate_android_media(&encode(14 * 1024 * 1024)).is_ok());
        assert!(validate_android_media(&encode(14 * 1024 * 1024 + 1)).is_err());
        assert!(validate_android_media("data:audio/ogg;base64,").is_err());
    }
}

#[tauri::command(async)]
pub fn show_overlay_card(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    contact_name: String,
    tags: Vec<String>,
    stage: String,
    next_follow_up: Option<String>,
    ai_summary: Option<String>,
) -> Result<serde_json::Value, String> {
    if contact_name.trim().is_empty() {
        return Err("客户名称为空".into());
    }
    let envelope = make_envelope(
        "overlay.show_card",
        device_id.as_deref(),
        serde_json::json!({
            "contactName": contact_name,
            "tags": tags,
            "stage": stage,
            "nextFollowUp": next_follow_up,
            "aiSummary": ai_summary,
        }),
    );
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(7))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(serde_json::json!({ "ack": ack, "shown": true }))
}

#[tauri::command(async)]
pub fn hide_overlay(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let envelope = make_envelope("overlay.hide", device_id.as_deref(), serde_json::json!({}));
    let ack = state.send_json_wait_ack(&envelope, Duration::from_secs(5))?;
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(serde_json::json!({ "ack": ack, "hidden": true }))
}

#[tauri::command(async)]
pub fn type_and_send(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    text: String,
    phone_e164: Option<String>,
    confirm_sent: Option<bool>,
) -> Result<serde_json::Value, String> {
    let phone = phone_e164
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "缺少客户电话".to_string())?;
    tracing::debug!(
        phone_length = phone.len(),
        text_length = text.len(),
        "type_and_send open_and_send"
    );

    let (device_id, response) = match state.request_verified_text(device_id.as_deref(), &phone, &text, confirm_sent.unwrap_or(false)) {
        Ok(result) => result,
        Err(error) => return Ok(serde_json::json!({ "status": "failed", "note": error })),
    };
    let (status, note) = match response {
        Ok(ack) if ack.get("type").and_then(|value| value.as_str()) == Some("error") => {
            ("failed", response_error(&ack))
        }
        Ok(ack) if response_ok(&ack) => {
            match ack.pointer("/payload/status").and_then(|value| value.as_str()) {
                Some("delivered") => ("delivered", "Android 已确认 WhatsApp 投递".into()),
                Some("phone_sent") => ("phone_sent", "已在手机 WhatsApp 中确认发出".into()),
                Some("clicked") => ("clicked", "Android 已尝试点击发送，但未收到 WhatsApp 回执".into()),
                _ => ("unknown", "手机未返回明确的发送结果".into()),
            }
        }
        Ok(_) => ("unknown", "手机未返回明确的发送结果".into()),
        Err(error) => ("unknown", error),
    };
    Ok(serde_json::json!({
        "deviceId": device_id,
        "status": status,
        "delivered": status == "delivered",
        "note": note,
    }))
}

// ── SQLite ──────────────────────────────────────────────

static CHAT_HISTORY_CHANGED: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub(crate) fn start_chat_history_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            CHAT_HISTORY_CHANGED.notified().await;
            tokio::time::sleep(Duration::from_secs(2)).await;
            loop {
                let app = app.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let db = app.state::<DbState>();
                    let conn = db.0.lock().map_err(|e| e.to_string())?;
                    db::refresh_chat_history_batch(&conn)
                }).await;
                match result {
                    Ok(Ok(true)) => tokio::time::sleep(Duration::from_millis(25)).await,
                    Ok(Ok(false)) => break,
                    Ok(Err(error)) => { tracing::warn!(%error, "chat history summary refresh failed"); break; }
                    Err(error) => { tracing::warn!(%error, "chat history summary worker failed"); break; }
                }
            }
        }
    });
}

#[tauri::command]
pub async fn db_load(app: AppHandle) -> Result<Option<AppSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DbState>();
        loop {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            if !db::refresh_chat_history_batch(&conn)? {
                return db::load_snapshot(&conn);
            }
            drop(conn);
            std::thread::yield_now();
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn db_save(state: State<'_, DbState>, snapshot: AppSnapshot) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Err(error) = db::save_snapshot(&conn, &snapshot) {
        tracing::error!(
            error = %error,
            phones = snapshot.phones.len(),
            contacts = snapshot.contacts.len(),
            chats = snapshot.chats.len(),
            messages = snapshot.messages.len(),
            "db_save failed"
        );
        return Err(error);
    }
    if snapshot.dirty.as_ref().is_none_or(|dirty| dirty.chats || dirty.messages)
        || !snapshot.chat_account_remaps.is_empty() || !snapshot.chat_message_remaps.is_empty()
    {
        CHAT_HISTORY_CHANGED.notify_one();
    }
    tracing::info!(
        phones = snapshot.phones.len(),
        contacts = snapshot.contacts.len(),
        messages = snapshot.messages.len(),
        "db_save ok"
    );
    Ok(())
}

#[tauri::command(async)]
pub fn db_clear(state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_all(&conn)
}

#[tauri::command(async)]
pub fn db_clear_chat_messages(state: State<'_, DbState>, chat_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_chat_messages(&conn, &chat_id)?;
    CHAT_HISTORY_CHANGED.notify_one();
    Ok(())
}

#[tauri::command(async)]
pub fn db_clear_remote_messages(
    state: State<'_, DbState>,
    remote_jid: String,
    account_id: Option<String>,
    before: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_remote_messages_before(&conn, &remote_jid, account_id.as_deref(), before.as_deref())?;
    CHAT_HISTORY_CHANGED.notify_one();
    Ok(())
}

#[tauri::command(async)]
pub fn db_update_message_acks(
    state: State<'_, DbState>,
    items: Vec<serde_json::Value>,
    account_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_message_acks(&conn, &items, &account_id)?;
    CHAT_HISTORY_CHANGED.notify_one();
    Ok(())
}

#[tauri::command(async)]
pub fn db_delete_messages_by_keys(
    state: State<'_, DbState>,
    keys: Vec<String>,
    account_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_messages_by_keys(&conn, &keys, account_id.as_deref())?;
    CHAT_HISTORY_CHANGED.notify_one();
    Ok(())
}

#[tauri::command(async)]
pub fn db_info(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::db_info(&conn)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStorageUsage {
    total_bytes: u64,
    database_bytes: u64,
    whatsapp_accounts_bytes: u64,
    backups_bytes: u64,
    other_app_data_bytes: u64,
    local_profile_bytes: u64,
    scan_incomplete: bool,
}

fn directory_size(root: &std::path::Path) -> (u64, bool) {
    let mut total = 0u64;
    let mut incomplete = false;
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                match entry.metadata() {
                    Ok(metadata) => total = total.saturating_add(metadata.len()),
                    Err(_) => incomplete = true,
                }
            }
        }
    }
    (total, incomplete)
}

fn scan_app_storage(data_dir: &std::path::Path, local_dir: &std::path::Path) -> AppStorageUsage {
    let mut usage = AppStorageUsage {
        total_bytes: 0,
        database_bytes: 0,
        whatsapp_accounts_bytes: 0,
        backups_bytes: 0,
        other_app_data_bytes: 0,
        local_profile_bytes: 0,
        scan_incomplete: false,
    };
    let entries = std::fs::read_dir(data_dir);
    match entries {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        usage.scan_incomplete = true;
                        continue;
                    }
                };
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                let kind = match entry.file_type() {
                    Ok(kind) => kind,
                    Err(_) => {
                        usage.scan_incomplete = true;
                        continue;
                    }
                };
                if kind.is_symlink() {
                    continue;
                }
                let (bytes, incomplete) = if kind.is_file() {
                    (
                        entry
                            .metadata()
                            .map(|metadata| metadata.len())
                            .unwrap_or_else(|_| {
                                usage.scan_incomplete = true;
                                0
                            }),
                        false,
                    )
                } else if kind.is_dir() {
                    directory_size(&entry.path())
                } else {
                    continue;
                };
                usage.scan_incomplete |= incomplete;
                if name == "baileys-auth" {
                    usage.whatsapp_accounts_bytes =
                        usage.whatsapp_accounts_bytes.saturating_add(bytes);
                } else if name == "crm-backups" {
                    usage.backups_bytes = usage.backups_bytes.saturating_add(bytes);
                } else if name == "wap-plus.db" || name.starts_with("wap-plus.db-") {
                    usage.database_bytes = usage.database_bytes.saturating_add(bytes);
                } else {
                    usage.other_app_data_bytes = usage.other_app_data_bytes.saturating_add(bytes);
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => usage.scan_incomplete = true,
    }
    let (local_bytes, local_incomplete) = directory_size(local_dir);
    usage.local_profile_bytes = local_bytes;
    usage.scan_incomplete |= local_incomplete;
    usage.total_bytes = usage
        .database_bytes
        .saturating_add(usage.whatsapp_accounts_bytes)
        .saturating_add(usage.backups_bytes)
        .saturating_add(usage.other_app_data_bytes)
        .saturating_add(usage.local_profile_bytes);
    usage
}

#[tauri::command]
pub async fn app_storage_usage(app: AppHandle) -> Result<AppStorageUsage, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let local_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || scan_app_storage(&data_dir, &local_dir))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn db_load_full_history(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::load_full_history(&conn)
}

/// 只检查指定会话的完整来信历史，不传输消息正文。
#[tauri::command(async)]
pub fn db_chats_with_inbound(
    state: State<'_, DbState>,
    chat_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::chats_with_inbound(&conn, &chat_ids)
}

#[tauri::command(async)]
pub fn db_latest_outgoing_message(
    state: State<'_, DbState>,
    chat_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::latest_outgoing_message(&conn, &chat_id)
}

/// 冷历史分页：按 chat 倒序取消息（不含内存已有的更新部分时由前端 before* 游标控制）
#[tauri::command(async)]
pub fn db_load_messages_page(
    state: State<'_, DbState>,
    chat_id: String,
    before_sent_at: Option<String>,
    before_id: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(80);
    let items = db::load_messages_page(
        &conn,
        &chat_id,
        before_sent_at.as_deref(),
        before_id.as_deref(),
        lim,
    )?;
    let total = db::count_messages_for_chat(&conn, &chat_id).unwrap_or(0);
    Ok(serde_json::json!({
        "ok": true,
        "chatId": chat_id,
        "items": items,
        "total": total,
        "limit": lim.clamp(1, 500),
    }))
}

static MESSAGE_SEARCH_WORKER: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// 全局消息搜索（含磁盘冷历史）
#[tauri::command]
pub async fn db_search_messages(
    app: AppHandle,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    let permit = MESSAGE_SEARCH_WORKER.acquire().await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Release the slot only when SQLite finishes, even if the caller stops waiting.
        let _permit = permit;
        let lim = limit.unwrap_or(40).clamp(1, 80);
        let items = match db::open_db_readonly(&app) {
            Ok(conn) => {
                let snapshot = conn.unchecked_transaction().map_err(|e| e.to_string())?;
                db::search_messages(&snapshot, &query, lim)
            }
            Err(error) => {
                tracing::warn!(%error, "read-only message search unavailable; using primary connection");
                let state = app.state::<DbState>();
                let conn = state.0.lock().map_err(|e| e.to_string())?;
                db::search_messages(&conn, &query, lim)
            }
        }?;
        Ok(serde_json::json!({ "ok": true, "query": query, "items": items, "limit": lim }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn db_get_message(state: State<'_, DbState>, id: String) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let item = db::get_message_by_id(&conn, &id)?;
    Ok(serde_json::json!({
        "ok": true,
        "item": item,
    }))
}
