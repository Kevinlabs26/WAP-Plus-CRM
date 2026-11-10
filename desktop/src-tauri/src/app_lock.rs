#[cfg(windows)]
use ring::{
    pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
#[cfg(windows)]
use serde::Deserialize;
use serde::Serialize;
#[cfg(windows)]
use std::{num::NonZeroU32, path::PathBuf};
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

#[cfg(windows)]
const FILE_NAME: &str = "app-lock.dpapi";
#[cfg(windows)]
const ITERATIONS: u32 = 310_000;
#[cfg(windows)]
const SALT_LEN: usize = 16;
#[cfg(windows)]
const HASH_LEN: usize = 32;
#[cfg(windows)]
static ALGORITHM: pbkdf2::Algorithm = pbkdf2::PBKDF2_HMAC_SHA256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockStatus {
    supported: bool,
    configured: bool,
}

#[cfg(windows)]
#[derive(Serialize, Deserialize)]
struct LockRecord {
    salt: Vec<u8>,
    hash: Vec<u8>,
}

#[cfg(windows)]
fn lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn read_record(app: &AppHandle) -> Result<Option<LockRecord>, String> {
    let path = lock_path(app)?;
    let encrypted = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let raw = crate::commands::unprotect_secrets(&encrypted)?;
    let record: LockRecord = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    if record.salt.len() != SALT_LEN || record.hash.len() != HASH_LEN {
        return Err("锁屏密码数据无效".into());
    }
    Ok(Some(record))
}

#[cfg(windows)]
fn write_record(app: &AppHandle, record: &LockRecord) -> Result<(), String> {
    let path = lock_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "无法确定应用数据目录".to_owned())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec(record).map_err(|e| e.to_string())?;
    let encrypted = crate::commands::protect_secrets(&raw)?;
    crate::atomic_file::write_atomic(&path, &encrypted).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn validate_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(6..=128).contains(&length) || password.len() > 512 {
        return Err("密码长度须为 6–128 个字符".into());
    }
    Ok(())
}

#[cfg(windows)]
fn new_record(password: &str) -> Result<LockRecord, String> {
    validate_password(password)?;
    let mut salt = vec![0; SALT_LEN];
    SystemRandom::new()
        .fill(&mut salt)
        .map_err(|_| "无法生成锁屏密码盐值".to_owned())?;
    let mut hash = vec![0; HASH_LEN];
    pbkdf2::derive(
        ALGORITHM,
        NonZeroU32::new(ITERATIONS).expect("nonzero iterations"),
        &salt,
        password.as_bytes(),
        &mut hash,
    );
    Ok(LockRecord { salt, hash })
}

#[cfg(windows)]
fn matches(record: &LockRecord, password: &str) -> bool {
    pbkdf2::verify(
        ALGORITHM,
        NonZeroU32::new(ITERATIONS).expect("nonzero iterations"),
        &record.salt,
        password.as_bytes(),
        &record.hash,
    )
    .is_ok()
}

#[cfg(windows)]
#[tauri::command]
pub fn app_lock_status(app: AppHandle) -> Result<AppLockStatus, String> {
    Ok(AppLockStatus {
        supported: true,
        configured: read_record(&app)?.is_some(),
    })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn app_lock_status(_app: AppHandle) -> Result<AppLockStatus, String> {
    Ok(AppLockStatus {
        supported: false,
        configured: false,
    })
}

#[cfg(windows)]
#[tauri::command]
pub fn app_lock_create(app: AppHandle, password: String) -> Result<(), String> {
    if read_record(&app)?.is_some() {
        return Err("锁屏密码已设置".into());
    }
    write_record(&app, &new_record(&password)?)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn app_lock_create(_app: AppHandle, _password: String) -> Result<(), String> {
    Err("锁屏仅支持 Windows 桌面版".into())
}

#[cfg(windows)]
#[tauri::command]
pub fn app_lock_verify(app: AppHandle, password: String) -> Result<bool, String> {
    let Some(record) = read_record(&app)? else {
        return Ok(false);
    };
    Ok(matches(&record, &password))
}

#[cfg(not(windows))]
#[tauri::command]
pub fn app_lock_verify(_app: AppHandle, _password: String) -> Result<bool, String> {
    Err("锁屏仅支持 Windows 桌面版".into())
}

#[cfg(windows)]
#[tauri::command]
pub fn app_lock_change(
    app: AppHandle,
    current_password: String,
    new_password: String,
) -> Result<bool, String> {
    let Some(record) = read_record(&app)? else {
        return Err("尚未设置锁屏密码".into());
    };
    if !matches(&record, &current_password) {
        return Ok(false);
    }
    write_record(&app, &new_record(&new_password)?)?;
    Ok(true)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn app_lock_change(
    _app: AppHandle,
    _current_password: String,
    _new_password: String,
) -> Result<bool, String> {
    Err("锁屏仅支持 Windows 桌面版".into())
}
