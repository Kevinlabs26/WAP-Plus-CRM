//! Tauri 命令：前端通过 invoke 调用

use crate::bridge::{make_envelope, BridgeConnectionInfo, BridgeState};
use crate::db::{self, AppSnapshot, DbState};
use crate::protocol::{response_error, response_ok};
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::io::Write;
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
        .create(format!(r"SOFTWARE\Classes\AppUserModelId\{NOTIFICATION_APP_ID}"))
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
    let path = dir.join(format!("notification-avatar-{:x}.{extension}", hasher.finish()));
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
        let mut toast = Toast::new(NOTIFICATION_APP_ID)
            .title(&title)
            .text1(&body);
        if let Some(count) = unread_count.filter(|count| *count > 0) {
            toast = toast.text2(&format!("{count} 条未读消息"));
        }
        if let Some(avatar) = avatar.as_deref() {
            toast = toast.icon(avatar, IconCrop::Circular, "会话头像");
        }
        toast
            .add_button("打开会话", "open")
            .on_activated(move |_| {
                crate::show_main_window(&click_app);
                if let Some(tag) = tag.as_ref() {
                    let _ = click_app.emit("wapplus://notification-click", tag);
                }
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }

    #[cfg(not(windows))]
    {
        let _ = (app, title, body, tag, avatar_bytes, unread_count);
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
    pub bridge_token: String,
}

#[cfg(windows)]
#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[cfg(windows)]
#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        data_in: *const DataBlob,
        description: *const u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *mut c_void,
        flags: u32,
        data_out: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        data_in: *const DataBlob,
        description: *mut *mut u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *mut c_void,
        flags: u32,
        data_out: *mut DataBlob,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

fn secure_secrets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.dpapi"))
}

#[tauri::command(async)]
pub fn typing_diagnostic_write(
    app: AppHandle,
    line: String,
    reset: bool,
) -> Result<(), String> {
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

#[cfg(windows)]
fn protect_secrets(value: &[u8]) -> Result<Vec<u8>, String> {
    let input = DataBlob { cb_data: value.len() as u32, pb_data: value.as_ptr() as *mut u8 };
    let mut output = DataBlob { cb_data: 0, pb_data: std::ptr::null_mut() };
    let ok = unsafe { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 0, &mut output) };
    if ok == 0 { return Err("Windows DPAPI 加密失败".into()); }
    let bytes = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
    unsafe { LocalFree(output.pb_data as *mut c_void); }
    Ok(bytes)
}

#[cfg(windows)]
fn unprotect_secrets(value: &[u8]) -> Result<Vec<u8>, String> {
    let input = DataBlob { cb_data: value.len() as u32, pb_data: value.as_ptr() as *mut u8 };
    let mut output = DataBlob { cb_data: 0, pb_data: std::ptr::null_mut() };
    let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 0, &mut output) };
    if ok == 0 { return Err("Windows DPAPI 解密失败".into()); }
    let bytes = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
    unsafe { LocalFree(output.pb_data as *mut c_void); }
    Ok(bytes)
}

#[tauri::command]
pub fn secure_save_secrets(app: AppHandle, secrets: SecureSecrets) -> Result<(), String> {
    #[cfg(windows)]
    {
        let raw = serde_json::to_vec(&secrets).map_err(|e| e.to_string())?;
        let encrypted = protect_secrets(&raw)?;
        std::fs::write(secure_secrets_path(&app)?, encrypted).map_err(|e| e.to_string())
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
        if !path.exists() { return Ok(None); }
        let encrypted = std::fs::read(path).map_err(|e| e.to_string())?;
        let raw = unprotect_secrets(&encrypted)?;
        serde_json::from_slice(&raw).map(Some).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn read_dropped_file(path: String) -> Result<DroppedFile, String> {
    let file_path = PathBuf::from(&path);
    let metadata = std::fs::metadata(&file_path).map_err(|e| format!("无法读取拖入文件：{e}"))?;
    if !metadata.is_file() {
        return Err("拖入的项目不是文件".into());
    }
    if metadata.len() > 14 * 1024 * 1024 {
        return Err("文件请小于 14MB".into());
    }
    let bytes = std::fs::read(&file_path).map_err(|e| format!("无法读取拖入文件：{e}"))?;
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
        .map_err(|e| {
            format!("无法执行 adb：{e}。请安装 Android platform-tools 并加入 PATH。")
        })?;

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
    if !data_url.starts_with("data:") || data_url.len() > 20 * 1024 * 1024 {
        return Err("媒体数据无效或超过 14MB".into());
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
    let envelope = make_envelope(
        "overlay.hide",
        device_id.as_deref(),
        serde_json::json!({}),
    );
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
    tracing::debug!(phone_length = phone.len(), text_length = text.len(), "type_and_send open_and_send");

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
pub fn db_clear_chat_messages(
    state: State<'_, DbState>,
    chat_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_chat_messages(&conn, &chat_id)
}

#[tauri::command(async)]
pub fn db_clear_remote_messages(
    state: State<'_, DbState>,
    remote_jid: String,
    account_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_remote_messages(&conn, &remote_jid, account_id.as_deref())
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

#[tauri::command(async)]
pub fn db_load_full_history(
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::load_full_history(&conn)
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
pub fn db_get_message(
    state: State<'_, DbState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let item = db::get_message_by_id(&conn, &id)?;
    Ok(serde_json::json!({
        "ok": true,
        "item": item,
    }))
}
