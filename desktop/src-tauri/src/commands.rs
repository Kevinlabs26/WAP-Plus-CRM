//! Tauri 命令：前端通过 invoke 调用

use crate::bridge::{make_envelope, BridgeConnectionInfo, BridgeState};
use crate::db::{self, AppSnapshot, DbState};
use crate::protocol::{response_error, response_ok};
use serde::{Deserialize, Serialize};
#[cfg(windows)]
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
    pub deepseek_key: String,
    #[serde(default)]
    pub qwen_key: String,
    #[serde(default)]
    pub zhipu_key: String,
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
    #[cfg(windows)]
    {
        let raw = serde_json::to_vec(&secrets).map_err(|e| e.to_string())?;
        let encrypted = protect_secrets(&raw)?;
        crate::atomic_file::write_atomic(&secure_secrets_path(&app)?, &encrypted)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, secrets);
        Err("安全密钥存储仅支持 Windows 桌面版".into())
    }
}

#[tauri::command]
pub fn secure_load_secrets(app: AppHandle) -> Result<Option<SecureSecrets>, String> {
    #[cfg(windows)]
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
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
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
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(root) = std::env::var_os(key) {
            let path = PathBuf::from(root).join("platform-tools").join("adb.exe");
            if path.is_file() {
                return Command::new(path);
            }
        }
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(root)
            .join("Android")
            .join("Sdk")
            .join("platform-tools")
            .join("adb.exe");
        if path.is_file() {
            return Command::new(path);
        }
    }
    Command::new("adb")
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "WAP Plus CRM",
        version: env!("CARGO_PKG_VERSION"),
        mvp: true,
    }
}

#[tauri::command]
pub fn list_adb_devices() -> Result<Vec<AdbDevice>, String> {
    let output = adb_command()
        .args(["devices"])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}。请安装 Android platform-tools 并加入 PATH。"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
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

/// adb forward tcp:PORT tcp:PORT — USB 调试时把电脑端口转到手机
#[tauri::command]
pub fn adb_forward(port: u16) -> Result<String, String> {
    let arg = format!("tcp:{port}");
    let output = adb_command()
        .args(["forward", &arg, &arg])
        .output()
        .map_err(|e| format!("adb forward 失败: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(format!("adb forward {arg} {arg} ok"))
}

#[tauri::command]
pub fn phone_screenshot() -> Result<Vec<u8>, String> {
    let output = adb_command()
        .args(["exec-out", "screencap", "-p"])
        .output()
        .map_err(|e| format!("手机截图失败: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn bridge_status(state: State<'_, BridgeState>) -> BridgeConnectionInfo {
    state.snapshot()
}

#[tauri::command]
pub fn bridge_connect(
    state: State<'_, BridgeState>,
    host: String,
    port: u16,
    token: String,
) -> Result<BridgeConnectionInfo, String> {
    state.connect(&host, port, &token)
}

#[tauri::command]
pub fn bridge_disconnect(state: State<'_, BridgeState>) -> Result<(), String> {
    state.disconnect();
    Ok(())
}

#[tauri::command]
pub fn bridge_drain_events(state: State<'_, BridgeState>) -> Vec<serde_json::Value> {
    state.drain_events()
}

#[tauri::command]
pub fn bridge_send_raw(
    state: State<'_, BridgeState>,
    envelope: serde_json::Value,
) -> Result<(), String> {
    state.send_json(&envelope)
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn send_whatsapp_media(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    phone_e164: Option<String>,
    data_url: String,
    file_name: String,
    mime: String,
    caption: Option<String>,
) -> Result<serde_json::Value, String> {
    let limit = if mime.starts_with("audio/") { 24 } else { 20 };
    if !data_url.starts_with("data:") || data_url.len() > limit * 1024 * 1024 {
        return Err(if mime.starts_with("audio/") { "音频数据无效或超过 16 MiB" } else { "媒体数据无效或超过 14MB" }.into());
    }
    if mime.starts_with("audio/") {
        use base64::Engine as _;
        let payload = data_url.split_once(',').filter(|(header, _)| header.ends_with(";base64"))
            .ok_or("音频数据无效")?.1;
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload).map_err(|_| "音频数据无效")?;
        if bytes.len() > 16 * 1024 * 1024 { return Err("音频超过 16 MiB".into()); }
    }
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
    if !response_ok(&ack) {
        return Err(response_error(&ack));
    }
    Ok(serde_json::json!({
        "ack": ack,
        "opened": true,
        "delivered": false,
        "note": "已在手机打开 WhatsApp 分享页，请确认发送",
    }))
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn type_and_send(
    state: State<'_, BridgeState>,
    device_id: Option<String>,
    text: String,
    phone_e164: Option<String>,
) -> Result<serde_json::Value, String> {
    let did = device_id.as_deref();
    let phone = phone_e164
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "缺少客户电话".to_string())?;
    let envelope = make_envelope(
        "wa.open_and_send",
        did,
        serde_json::json!({ "phoneE164": phone, "text": text }),
    );
    tracing::debug!(
        phone_length = phone.len(),
        text_length = text.len(),
        "type_and_send open_and_send"
    );

    match state.send_json_wait_ack(&envelope, Duration::from_secs(7)) {
        Ok(ack) if response_ok(&ack) => {
            // Android 的 ACTION_CLICK 只能证明按钮被点击，不能证明 WhatsApp
            // 已接受消息。只有未来收到明确 delivered 回执时才算真正投递。
            let delivered = ack
                .pointer("/payload/status")
                .and_then(|value| value.as_str())
                == Some("delivered");
            Ok(serde_json::json!({
                "envelope": envelope,
                "ack": ack,
                "delivered": delivered,
                "status": if delivered { "delivered" } else { "clicked" },
                "note": if delivered {
                    "Android 已确认 WhatsApp 投递"
                } else {
                    "Android 已点击发送，但未收到 WhatsApp 回执"
                },
            }))
        }
        Ok(ack) => Ok(serde_json::json!({
            "envelope": envelope,
            "ack": ack,
            "delivered": false,
            "error": response_error(&ack),
            "note": "Android 未确认发送",
        })),
        Err(error) => Ok(serde_json::json!({
            "envelope": envelope,
            "delivered": false,
            "error": error,
            "note": "Android 未确认发送",
        })),
    }
}

// ── SQLite ──────────────────────────────────────────────

#[tauri::command(async)]
pub fn db_load(state: State<'_, DbState>) -> Result<Option<AppSnapshot>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::load_snapshot(&conn)
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
    db::clear_chat_messages(&conn, &chat_id)
}

#[tauri::command(async)]
pub fn db_clear_remote_messages(
    state: State<'_, DbState>,
    remote_jid: String,
    account_id: Option<String>,
    before: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_remote_messages_before(&conn, &remote_jid, account_id.as_deref(), before.as_deref())
}

#[tauri::command(async)]
pub fn db_update_message_acks(
    state: State<'_, DbState>,
    items: Vec<serde_json::Value>,
    account_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_message_acks(&conn, &items, &account_id)
}

#[tauri::command(async)]
pub fn db_delete_messages_by_keys(
    state: State<'_, DbState>,
    keys: Vec<String>,
    account_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_messages_by_keys(&conn, &keys, account_id.as_deref())
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

/// 全局消息搜索（含磁盘冷历史）
#[tauri::command(async)]
pub fn db_search_messages(
    state: State<'_, DbState>,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(40);
    let items = db::search_messages(&conn, &query, lim)?;
    Ok(serde_json::json!({
        "ok": true,
        "query": query,
        "items": items,
        "limit": lim.clamp(1, 80),
    }))
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
