//! Native call handoff. Bindings belong to this Windows installation, not CRM backups.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

#[cfg(windows)]
#[path = "clone_calls_windows.rs"]
mod platform;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneApp {
    pub app_id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSetup {
    apps: Vec<CloneApp>,
    bindings: BTreeMap<String, String>,
    verified: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct CloneCallsState {
    // One foreground automation at a time, including across CRM windows.
    operation: Mutex<()>,
    pending: Mutex<CallRequests>,
}

#[derive(Default)]
struct CallRequests {
    active: Option<(String, Arc<AtomicBool>)>,
    cancelled: BTreeMap<String, Instant>,
}
impl CallRequests {
    fn start(&mut self, id: String) -> Result<Arc<AtomicBool>, String> {
        self.cancelled
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if self.cancelled.remove(&id).is_some() {
            return Err("已取消呼叫准备".into());
        }
        if self.active.is_some() {
            return Err("已有呼叫正在准备，请勿重复点击".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active = Some((id, cancelled.clone()));
        Ok(cancelled)
    }
    fn cancel(&mut self, id: String) {
        if let Some((active, cancelled)) = &self.active {
            if active == &id {
                cancelled.store(true, Ordering::SeqCst);
                return;
            }
        }
        // Cancellation can arrive before the async start command is scheduled.
        self.cancelled.insert(id, Instant::now());
        if self.cancelled.len() > 64 {
            if let Some(oldest) = self
                .cancelled
                .iter()
                .min_by_key(|(_, at)| **at)
                .map(|(id, _)| id.clone())
            {
                self.cancelled.remove(&oldest);
            }
        }
    }
    fn finish(&mut self, id: &str) {
        if self.active.as_ref().is_some_and(|(active, _)| active == id) {
            self.active = None;
        }
    }
}

pub fn valid_phone(phone: &str) -> bool {
    phone.starts_with('+')
        && (8..=16).contains(&phone.len())
        && phone.as_bytes()[1] != b'0'
        && phone[1..].bytes().all(|c| c.is_ascii_digit())
}

pub fn valid_clone_name(name: &str) -> bool {
    ["KevinLabs.WhatsAppClone", "KevinLabs.WhatsAppBeta.Clone"]
        .iter()
        .any(|prefix| {
            name.strip_prefix(prefix).is_some_and(|suffix| {
                !suffix.is_empty()
                    && suffix.len() <= 8
                    && suffix.bytes().all(|c| c.is_ascii_digit())
            })
        })
}

pub fn valid_client_name(name: &str) -> bool {
    matches!(name, "5319275A.WhatsAppDesktop" | "5319275A.51895FA4EA97F") || valid_clone_name(name)
}

pub fn valid_app_id(id: &str) -> bool {
    let Some((family, entry)) = id.split_once('!') else {
        return false;
    };
    let Some((name, publisher)) = family.rsplit_once('_') else {
        return false;
    };
    valid_client_name(name)
        && (if valid_clone_name(name) {
            publisher.len() == 13
                && publisher
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        } else {
            publisher == "cv1g1gvanyjgm"
        })
        && !entry.is_empty()
        && entry.len() <= 64
        && entry
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

fn binding_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("clone-call-bindings.json"))
}

fn read_bindings(path: &std::path::Path) -> Result<BTreeMap<String, String>, String> {
    match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(_) => Err("无法读取客户端绑定，请检查本机文件权限".into()),
        Ok(bytes) => {
            if bytes.len() > 32_768 {
                return Err("客户端绑定文件异常，未覆盖原文件".into());
            }
            let bindings: BTreeMap<String, String> =
                serde_json::from_slice(&bytes).map_err(|_| "客户端绑定文件损坏，未覆盖原文件")?;
            if bindings.len() > 100
                || bindings
                    .iter()
                    .any(|(phone, id)| !valid_phone(phone) || !valid_app_id(id))
            {
                return Err("客户端绑定文件格式无效，未覆盖原文件".into());
            }
            Ok(bindings)
        }
    }
}

fn verification_path(bindings: &std::path::Path) -> PathBuf {
    bindings.with_file_name("clone-call-verified.json")
}

fn save_verification(path: &std::path::Path, owner: &str, id: Option<&str>) -> Result<(), String> {
    let mut verified = read_bindings(path)?;
    if let Some(id) = id {
        verified.insert(owner.to_string(), id.to_string());
    } else {
        verified.remove(owner);
    }
    crate::atomic_file::write_atomic(
        path,
        &serde_json::to_vec(&verified).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn require_verified(
    verified: &BTreeMap<String, String>,
    owner: &str,
    id: &str,
) -> Result<(), String> {
    if verified.get(owner).map(String::as_str) == Some(id) {
        Ok(())
    } else {
        Err("请先在设备页核对该账号的通话客户端".into())
    }
}

fn valid_call_link_url(raw: &str) -> bool {
    call_link_token(raw).is_some()
}

fn call_link_token(raw: &str) -> Option<String> {
    let Ok(url) = url::Url::parse(raw) else {
        return None;
    };
    let token = url.path().strip_prefix("/voice/")?;
    (url.scheme() == "https"
        && url.host_str() == Some("call.whatsapp.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && !token.is_empty() && token.len() <= 128
        && token.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)))
        .then(|| token.to_string())
}

fn call_link_activation_args(raw: &str) -> Result<String, String> {
    let token = call_link_token(raw).ok_or("无效的 WhatsApp 通话链接")?;
    Ok(format!("action=LaunchVoip&link={token}&video=0&isFirst=0"))
}

fn list_apps() -> Result<Vec<CloneApp>, String> {
    #[cfg(windows)]
    {
        platform::apps()
    }
    #[cfg(not(windows))]
    {
        Err("通话客户端仅支持 Windows 桌面版".into())
    }
}

fn installed_app(id: &str) -> Result<CloneApp, String> {
    if !valid_app_id(id) {
        return Err("无效的 WhatsApp 客户端".into());
    }
    #[cfg(windows)]
    {
        platform::installed_app(id)
    }
    #[cfg(not(windows))]
    {
        Err("通话客户端仅支持 Windows 桌面版".into())
    }
}

#[tauri::command]
pub async fn clone_call_setup(app: tauri::AppHandle) -> Result<CallSetup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = binding_path(&app)?;
        let bindings = read_bindings(&path)?;
        let mut verified = read_bindings(&verification_path(&path))?;
        verified.retain(|owner, id| bindings.get(owner) == Some(id));
        Ok(CallSetup {
            apps: list_apps()?,
            bindings,
            verified,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clone_call_bind(
    app: tauri::AppHandle,
    owner_phone: String,
    app_id: Option<String>,
) -> Result<(), String> {
    if !valid_phone(&owner_phone) {
        return Err("无效的账号手机号".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CloneCallsState>();
        let _lock = state
            .operation
            .try_lock()
            .map_err(|_| "正在操作客户端，请稍候")?;
        let path = binding_path(&app)?;
        let mut bindings = read_bindings(&path)?;
        if let Some(id) = app_id {
            installed_app(&id)?;
            if bindings
                .iter()
                .any(|(phone, other)| phone != &owner_phone && other == &id)
            {
                return Err("该客户端已绑定其他账号，请先解除原绑定".into());
            }
            if !bindings.contains_key(&owner_phone) && bindings.len() >= 100 {
                return Err("绑定数量已达上限".into());
            }
            bindings.insert(owner_phone.clone(), id);
        } else {
            bindings.remove(&owner_phone);
        }
        save_verification(&verification_path(&path), &owner_phone, None)?;
        crate::atomic_file::write_atomic(
            &path,
            &serde_json::to_vec(&bindings).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clone_call_verify(app: tauri::AppHandle, owner_phone: String) -> Result<(), String> {
    if !valid_phone(&owner_phone) {
        return Err("无效的账号手机号".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CloneCallsState>();
        let _lock = state
            .operation
            .try_lock()
            .map_err(|_| "正在操作客户端，请稍候")?;
        let path = binding_path(&app)?;
        let bindings = read_bindings(&path)?;
        let id = bindings.get(&owner_phone).ok_or("请先绑定通话客户端")?;
        save_verification(&verification_path(&path), &owner_phone, None)?;
        installed_app(id)?;
        #[cfg(windows)]
        {
            platform::verify_owner(id, &owner_phone)?;
        }
        #[cfg(not(windows))]
        {
            return Err("仅支持 Windows 桌面版".into());
        }
        save_verification(&verification_path(&path), &owner_phone, Some(id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clone_call_open(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CloneCallsState>();
        let _lock = state
            .operation
            .try_lock()
            .map_err(|_| "正在操作客户端，请稍候")?;
        let selected = installed_app(&app_id)?;
        #[cfg(windows)]
        {
            platform::open(&selected.app_id)
        }
        #[cfg(not(windows))]
        {
            let _ = selected;
            Err("仅支持 Windows 桌面版".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clone_call_open_link(
    app: tauri::AppHandle,
    owner_phone: String,
    app_id: String,
    url: String,
) -> Result<(), String> {
    if !valid_phone(&owner_phone) || !valid_app_id(&app_id) || !valid_call_link_url(&url) {
        return Err("无效的 WhatsApp 通话链接或客户端".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CloneCallsState>();
        let _lock = state
            .operation
            .try_lock()
            .map_err(|_| "正在操作客户端，请稍候")?;
        let path = binding_path(&app)?;
        let bindings = read_bindings(&path)?;
        if bindings.get(&owner_phone).map(String::as_str) != Some(&app_id) {
            return Err("通话客户端与此账号未绑定".into());
        }
        require_verified(&read_bindings(&verification_path(&path))?, &owner_phone, &app_id)?;
        installed_app(&app_id)?;
        #[cfg(windows)]
        {
            platform::open_call_link(&app_id, &url)
        }
        #[cfg(not(windows))]
        {
            Err("仅支持 Windows 桌面版".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clone_call_start(
    app: tauri::AppHandle,
    owner_phone: String,
    recipient_phone: String,
    request_id: String,
) -> Result<(), String> {
    if !valid_phone(&owner_phone)
        || !valid_phone(&recipient_phone)
        || owner_phone == recipient_phone
    {
        return Err("请使用有效的账号及联系人手机号，不能呼叫自己".into());
    }
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("无效呼叫请求".into());
    }
    let cancelled = {
        let state = app.state::<CloneCallsState>();
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        pending.start(request_id.clone())?
    };
    let cleanup_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CloneCallsState>();
        let _lock = state
            .operation
            .try_lock()
            .map_err(|_| "已有客户端操作正在进行，请勿重复呼叫")?;
        let path = binding_path(&app)?;
        let bindings = read_bindings(&path)?;
        let id = bindings
            .get(&owner_phone)
            .ok_or("请先为该账号绑定 WhatsApp 客户端")?;
        require_verified(&read_bindings(&verification_path(&path))?, &owner_phone, id)?;
        installed_app(id)?;
        #[cfg(windows)]
        {
            platform::call(id, &recipient_phone, &cancelled)
        }
        #[cfg(not(windows))]
        {
            Err("仅支持 Windows 桌面版".into())
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|value| value);
    if let Ok(mut pending) = cleanup_app.state::<CloneCallsState>().pending.lock() {
        pending.finish(&request_id);
    }
    result
}

#[tauri::command]
pub fn clone_call_cancel(
    state: tauri::State<'_, CloneCallsState>,
    request_id: String,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("无效呼叫请求".into());
    }
    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .cancel(request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verified_bindings_gate_calls_and_can_be_revoked_without_changing_bindings() {
        let owner = "+12025550101";
        let id = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App";
        let dir = std::env::temp_dir().join(format!("call-verification-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("clone-call-bindings.json");
        let bindings = BTreeMap::from([(owner.to_string(), id.to_string())]);
        std::fs::write(&path, serde_json::to_vec(&bindings).unwrap()).unwrap();
        let verified = verification_path(&path);
        assert!(require_verified(&read_bindings(&verified).unwrap(), owner, id).is_err());
        save_verification(&verified, owner, Some(id)).unwrap();
        let data = read_bindings(&verified).unwrap();
        assert!(require_verified(&data, owner, id).is_ok());
        assert!(require_verified(&data, "+12025550102", id).is_err());
        assert!(
            require_verified(&data, owner, "5319275A.51895FA4EA97F_cv1g1gvanyjgm!App").is_err()
        );
        save_verification(&verified, owner, None).unwrap();
        assert!(require_verified(&read_bindings(&verified).unwrap(), owner, id).is_err());
        assert_eq!(read_bindings(&path).unwrap(), bindings);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(verified).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn cancellation_before_start_and_other_requests_cannot_dial_or_interrupt() {
        let mut requests = CallRequests::default();
        requests.cancel("early".into());
        assert!(requests.start("early".into()).is_err());
        let active = requests.start("one".into()).unwrap();
        assert!(requests.start("two".into()).is_err());
        requests.cancel("other".into());
        requests.finish("other");
        assert!(!active.load(Ordering::SeqCst));
        assert!(requests.active.is_some());
        requests.cancel("one".into());
        assert!(active.load(Ordering::SeqCst));
        requests.finish("one");
        assert!(requests.active.is_none());
        for i in 0..100 {
            requests.cancel(i.to_string());
        }
        assert_eq!(requests.cancelled.len(), 64);
    }
    #[test]
    fn restrict_targets() {
        assert!(valid_app_id("KevinLabs.WhatsAppClone3_20wb6qy974p7e!App"));
        assert!(valid_app_id(
            "KevinLabs.WhatsAppBeta.Clone2_20wb6qy974p7e!App"
        ));
        for id in [
            "KevinLabs.MicrosoftTeams.Clone2_20wb6qy974p7e!App",
            "KevinLabs.WhatsAppClone_20wb6qy974p7e!App",
            "KevinLabs.WhatsAppClone3_20wb6qy974p7e!App;calc",
            "KevinLabs.WhatsAppClone3_20wb6qy974p7e!App!Other",
        ] {
            assert!(!valid_app_id(id));
        }
        for phone in [
            "",
            "123456789",
            "+0123456789",
            "+1234567@lid",
            "+123456;calc",
            "+1234567890123456",
            "+１２３４５６７",
        ] {
            assert!(!valid_phone(phone));
        }
        assert!(valid_phone("+12025550101"));
    }
    #[test]
    fn call_link_url_accepts_only_whatsapp_voice_links() {
        assert_eq!(call_link_activation_args("https://call.whatsapp.com/voice/Abc_123?tracking=ignored").unwrap(), "action=LaunchVoip&link=Abc_123&video=0&isFirst=0");
        for url in [
            "https://call.whatsapp.com/voice/Abc_123?x=1",
            "https://CALL.WHATSAPP.COM/voice/token",
        ] {
            assert!(valid_call_link_url(url), "{url}");
        }
        for url in [
            "http://call.whatsapp.com/voice/token",
            "https://call.whatsapp.com/voice/",
            "https://call.whatsapp.com/voice/token/other",
            "https://call.whatsapp.com.evil.example/voice/token",
            "https://evil.example/voice/token",
            "https://user@call.whatsapp.com/voice/token",
            "https://call.whatsapp.com:444/voice/token",
            "https://call.whatsapp.com/voice/a&action=AnswerVoip",
            "https://call.whatsapp.com/voice/a%26link=other",
        ] {
            assert!(!valid_call_link_url(url), "{url}");
        }
    }
    #[test]
    fn official_clients_share_the_binding_and_launch_allowlist() {
        for name in ["5319275A.WhatsAppDesktop", "5319275A.51895FA4EA97F"] {
            assert!(valid_client_name(name));
            assert!(valid_app_id(&format!("{name}_cv1g1gvanyjgm!App")));
            for suffix in [
                "_20wb6qy974p7e!App",
                "_cv1g1gvanyjgm!App;calc",
                "_cv1g1gvanyjgm!App!Other",
                "_cv1g1gvanyjgm!",
            ] {
                assert!(!valid_app_id(&format!("{name}{suffix}")));
            }
        }
        assert!(!valid_client_name("5319275A.WhatsAppDesktopFake"));
        assert!(!valid_app_id("5319275A.OtherApp_cv1g1gvanyjgm!App"));
        let bindings = BTreeMap::from([(
            "+12025550101".into(),
            "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App".into(),
        )]);
        let path = std::env::temp_dir().join(format!(
            "official-client-bindings-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, serde_json::to_vec(&bindings).unwrap()).unwrap();
        assert_eq!(read_bindings(&path).unwrap(), bindings);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn corrupted_bindings_are_not_silently_replaced() {
        let path =
            std::env::temp_dir().join(format!("clone-bindings-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"{broken").unwrap();
        assert!(read_bindings(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{broken");
        std::fs::remove_file(path).unwrap();
    }
}
