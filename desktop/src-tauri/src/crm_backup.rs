use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

const FILE_LIMIT: usize = 256 * 1024 * 1024;
const HISTORY_PART_BYTES: usize = 32 * 1024 * 1024;
const MAX_PARTS: usize = 4096;
const BACKUP_TOTAL_LIMIT: u64 = 4 * 1024 * 1024 * 1024;
pub(crate) const BACKUP_ENCRYPTION_MAGIC: &[u8] = b"WAPCRM-DPAPI-1\0";
const BACKUP_ENCRYPTION_CHUNK: usize = 512 * 1024;

pub(crate) fn protect_backup(bytes: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let chunks = bytes.chunks(BACKUP_ENCRYPTION_CHUNK).collect::<Vec<_>>();
        let mut output = BACKUP_ENCRYPTION_MAGIC.to_vec();
        output.extend_from_slice(&(chunks.len() as u32).to_le_bytes());
        for chunk in chunks {
            let encrypted = crate::commands::protect_secrets(chunk)?;
            let length = u32::try_from(encrypted.len()).map_err(|_| "备份加密分段过大")?;
            output.extend_from_slice(&length.to_le_bytes());
            output.extend_from_slice(&encrypted);
        }
        return Ok(output);
    }
    #[cfg(not(windows))]
    Ok(bytes.to_vec())
}

pub(crate) fn unprotect_backup(bytes: &[u8], limit: u64) -> Result<Vec<u8>, String> {
    if !bytes.starts_with(BACKUP_ENCRYPTION_MAGIC) {
        return Ok(bytes.to_vec());
    }
    #[cfg(windows)]
    {
        let mut cursor = BACKUP_ENCRYPTION_MAGIC.len();
        let count_end = cursor.checked_add(4).ok_or("备份加密格式无效")?;
        let count_bytes: [u8; 4] = bytes
            .get(cursor..count_end)
            .ok_or("备份加密格式无效")?
            .try_into()
            .map_err(|_| "备份加密格式无效")?;
        let count = u32::from_le_bytes(count_bytes) as usize;
        if count > (limit as usize / BACKUP_ENCRYPTION_CHUNK).saturating_add(2) {
            return Err("备份加密分段数量无效".into());
        }
        cursor = count_end;
        let mut output = Vec::new();
        for _ in 0..count {
            let length_end = cursor.checked_add(4).ok_or("备份加密格式无效")?;
            let length_bytes: [u8; 4] = bytes
                .get(cursor..length_end)
                .ok_or("备份加密格式无效")?
                .try_into()
                .map_err(|_| "备份加密格式无效")?;
            let length = u32::from_le_bytes(length_bytes) as usize;
            cursor = length_end;
            let chunk_end = cursor.checked_add(length).ok_or("备份加密格式无效")?;
            let encrypted = bytes.get(cursor..chunk_end).ok_or("备份加密格式无效")?;
            let decrypted = crate::commands::unprotect_secrets(encrypted)?;
            if output.len().saturating_add(decrypted.len()) as u64 > limit {
                return Err("备份解密后超过读取上限".into());
            }
            output.extend_from_slice(&decrypted);
            cursor = chunk_end;
        }
        if cursor != bytes.len() {
            return Err("备份加密数据尾部无效".into());
        }
        return Ok(output);
    }
    #[cfg(not(windows))]
    Err("此备份由 Windows 账号加密，需在原 Windows 账号下恢复".into())
}

fn backup_bytes(path: &Path) -> Result<u64, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.is_file() {
        return Ok(meta.len());
    }
    if !meta.is_dir() {
        return Err("备份包含不支持的文件链接".into());
    }
    let mut total = 0u64;
    for item in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        total = total.saturating_add(backup_bytes(&item.map_err(|e| e.to_string())?.path())?);
    }
    Ok(total)
}

fn ensure_backup_space(dir: &Path, expected: u64) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let path: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0u64;
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                path.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(format!(
                "无法检查备份磁盘空间：{}",
                std::io::Error::last_os_error()
            ));
        }
        if available < expected.saturating_add(256 * 1024 * 1024) {
            return Err("备份磁盘可用空间不足，已停止备份；现有数据和旧备份保持不变".into());
        }
    }
    #[cfg(not(windows))]
    let _ = (dir, expected);
    Ok(())
}

#[derive(Deserialize, Serialize)]
struct Part {
    bytes: usize,
    sha256: String,
}

#[derive(Deserialize, Serialize)]
struct Manifest {
    version: u8,
    parts: Vec<Part>,
}

#[derive(Serialize)]
pub struct BackupReadInfo {
    id: String,
    parts: usize,
}

fn backup_day(path: &Path) -> String {
    path.file_name().unwrap().to_string_lossy()[4..14].to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    folder: String,
    latest_day: Option<String>,
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("crm-backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn backups(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let single = kind.is_file() && name.len() == 19 && name.ends_with(".json");
        let segmented = kind.is_dir()
            && name.len() == 51
            && name.is_ascii()
            && name.as_bytes()[14] == b'-'
            && uuid::Uuid::parse_str(&name[15..]).is_ok()
            && entry.path().join("manifest.json").is_file();
        if (single || segmented)
            && name.is_ascii()
            && name.starts_with("crm-")
            && chrono::NaiveDate::parse_from_str(&name[4..14], "%Y-%m-%d").is_ok()
        {
            files.push(entry.path());
        }
    }
    files.sort_by_key(|p| {
        (
            backup_day(p),
            p.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH),
            p.clone(),
        )
    });
    Ok(files)
}

fn status(dir: &Path) -> Result<BackupStatus, String> {
    let latest_day = backups(dir)?.last().map(|p| backup_day(p));
    Ok(BackupStatus {
        folder: dir.to_string_lossy().into_owned(),
        latest_day,
    })
}

fn validate(content: &str) -> Result<serde_json::Value, String> {
    if content.len() > FILE_LIMIT {
        return Err("备份元数据超过 256 MiB".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|_| "备份不是有效 JSON".to_string())?;
    if value["version"] != 2
        || value["app"] != "WAP Plus CRM"
        || ![
            "phones",
            "contacts",
            "chats",
            "messages",
            "followUps",
            "activities",
            "broadcastCampaigns",
        ]
        .iter()
        .all(|key| value[key].is_array())
        || !value["settingsSafe"].is_object()
        || value.get("settings").is_some()
    {
        return Err("备份格式无效".into());
    }
    for key in [
        "openaiKey",
        "groqKey",
        "geminiKey",
        "deepseekKey",
        "qwenKey",
        "zhipuKey",
        "openrouterKey",
        "customAiKey",
        "transcriptionApiKey",
        "bridgeToken",
    ] {
        if value["settingsSafe"].get(key).is_some() {
            return Err("备份不能包含密钥".into());
        }
    }
    Ok(value)
}

fn prune(dir: &Path, max_bytes: u64) -> Result<(), String> {
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    let mut days = std::collections::HashSet::new();
    let mut retained_bytes = 0u64;
    for path in backups(dir)?.iter().rev() {
        let day = backup_day(path);
        let bytes = backup_bytes(path)?;
        // Keep the newest complete backup even when it alone exceeds the target budget.
        if days.contains(&day)
            || days.len() >= 7
            || !days.is_empty() && retained_bytes.saturating_add(bytes) > max_bytes
        {
            if path.canonicalize().map_err(|e| e.to_string())?.parent() != Some(root.as_path()) {
                return Err("备份清理路径无效".into());
            }
            let result = if path.is_dir() {
                std::fs::remove_dir_all(path)
            } else {
                std::fs::remove_file(path)
            };
            result.map_err(|e| format!("备份已保存，但清理旧备份失败：{e}"))?;
        } else {
            days.insert(day);
            retained_bytes = retained_bytes.saturating_add(bytes);
        }
    }
    Ok(())
}

fn save(dir: &Path, content: &str, day: &str) -> Result<BackupStatus, String> {
    validate(content)?;
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "备份日期无效".to_string())?;
    let encrypted = protect_backup(content.as_bytes())?;
    ensure_backup_space(dir, encrypted.len() as u64)?;
    crate::atomic_file::write_atomic(&dir.join(format!("crm-{day}.json")), &encrypted)
        .map_err(|e| e.to_string())?;
    prune(dir, BACKUP_TOTAL_LIMIT)?;
    status(dir)
}

fn write_part(dir: &Path, bytes: &[u8], parts: &mut Vec<Part>) -> Result<(), String> {
    if bytes.len() > FILE_LIMIT || parts.len() >= MAX_PARTS {
        return Err("备份分段超过安全上限".into());
    }
    let encrypted = protect_backup(bytes)?;
    crate::atomic_file::write_atomic(
        &dir.join(format!("part-{:04}.json", parts.len())),
        &encrypted,
    )
    .map_err(|e| e.to_string())?;
    parts.push(Part {
        bytes: bytes.len(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
    });
    Ok(())
}

fn write_history(
    dir: &Path,
    conn: &rusqlite::Connection,
    field: &str,
    sql: &str,
    parts: &mut Vec<Part>,
    limit: usize,
) -> Result<(), String> {
    let prefix = format!("{{\"{field}\":[");
    let mut content = prefix.clone();
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let json = crate::db::read_json_text(row, 0).map_err(|e| e.to_string())?;
        let mut value: serde_json::Value =
            serde_json::from_str(&json).map_err(|e| format!("历史记录 JSON 无效：{e}"))?;
        if !value.is_object() {
            return Err("历史记录不是有效对象".into());
        }
        if field == "messages"
            && value["mediaUrl"]
                .as_str()
                .is_some_and(|url| url.starts_with("data:") && url.len() > 8_000)
        {
            value.as_object_mut().unwrap().remove("mediaUrl");
            if value["mediaType"]
                .as_str()
                .is_some_and(|kind| !kind.is_empty())
            {
                value["mediaPending"] = true.into();
            }
        }
        let json = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        if prefix.len() + json.len() + 2 > limit {
            return Err("单条历史记录超过备份分段上限".into());
        }
        if content.len() + json.len() + 3 > limit && content.len() > prefix.len() {
            content.push_str("]}");
            write_part(dir, content.as_bytes(), parts)?;
            content = prefix.clone();
        }
        if content.len() > prefix.len() {
            content.push(',');
        }
        content.push_str(&json);
    }
    if content.len() > prefix.len() {
        content.push_str("]}");
        write_part(dir, content.as_bytes(), parts)?;
    }
    Ok(())
}

fn read_pragma_integer(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<i64> {
    use rusqlite::types::ValueRef;

    let value = row.get_ref(index)?;
    let parsed = match value {
        ValueRef::Integer(value) => Some(value),
        ValueRef::Text(value) => std::str::from_utf8(value)
            .ok()
            .and_then(|value| value.parse().ok()),
        _ => None,
    };
    parsed.ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(
            index,
            row.as_ref().column_name(index).unwrap_or("value").to_owned(),
            value.data_type(),
        )
    })
}

fn save_segmented(
    dir: &Path,
    conn: &rusqlite::Connection,
    content: &str,
    day: &str,
) -> Result<BackupStatus, String> {
    let header = validate(content)?;
    if [
        "phones",
        "contacts",
        "chats",
        "followUps",
        "messages",
        "activities",
    ]
    .iter()
    .any(|key| !header[key].as_array().unwrap().is_empty())
    {
        return Err("分段备份元数据不能包含历史记录".into());
    }
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "备份日期无效".to_string())?;
    let pages: i64 = conn
        .query_row("PRAGMA page_count", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let page_size: i64 = conn
        .query_row("PRAGMA page_size", [], |row| read_pragma_integer(row, 0))
        .map_err(|e| e.to_string())?;
    if pages < 0 || page_size <= 0 {
        return Err("无法确定数据库备份所需空间".into());
    }
    ensure_backup_space(
        dir,
        (pages as u64)
            .saturating_mul(page_size as u64)
            .saturating_add(content.len() as u64),
    )?;
    let id = uuid::Uuid::new_v4();
    let temporary = dir.join(format!(".crm-pending-{id}"));
    std::fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut manifest = Manifest {
            version: 1,
            parts: Vec::new(),
        };
        write_part(&temporary, content.as_bytes(), &mut manifest.parts)?;
        // 单独的只读事务固定完整历史快照；不占用应用的写连接。
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (field, sql) in [
            ("phones", "SELECT json FROM phones ORDER BY id"),
            ("contacts", "SELECT json FROM contacts ORDER BY id"),
            ("chats", "SELECT json FROM chats ORDER BY id"),
            ("followUps", "SELECT json FROM follow_ups ORDER BY id"),
            ("messages", "SELECT json FROM messages ORDER BY sent_at, id"),
            (
                "activities",
                "SELECT json FROM activities ORDER BY at_ts DESC, id DESC",
            ),
        ] {
            write_history(
                &temporary,
                &tx,
                field,
                sql,
                &mut manifest.parts,
                HISTORY_PART_BYTES,
            )?;
        }
        let bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
        crate::atomic_file::write_atomic(&temporary.join("manifest.json"), &bytes)
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, dir.join(format!("crm-{day}-{id}")))
            .map_err(|e| e.to_string())?;
        prune(dir, BACKUP_TOTAL_LIMIT)?;
        status(dir)
    })();
    if temporary.is_dir() {
        let _ = std::fs::remove_dir_all(&temporary);
    }
    result
}

#[tauri::command]
pub fn crm_backup_status(app: tauri::AppHandle) -> Result<BackupStatus, String> {
    status(&root(&app)?)
}

#[tauri::command]
pub async fn crm_backup_save(
    app: tauri::AppHandle,
    content: String,
    from_database: Option<bool>,
) -> Result<BackupStatus, String> {
    let dir = root(&app)?;
    let app_for_db = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        if from_database.unwrap_or(false) {
            let conn = crate::db::open_db_readonly(&app_for_db)?;
            conn.busy_timeout(std::time::Duration::from_secs(20))
                .map_err(|e| e.to_string())?;
            save_segmented(&dir, &conn, &content, &day)
        } else {
            save(&dir, &content, &day)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn latest(dir: &Path) -> Result<String, String> {
    let paths = backups(dir)?;
    let path = paths.last().ok_or("还没有自动备份")?;
    if path.is_dir() {
        return Err("分段备份请使用新版恢复入口".into());
    }
    read_file(path, FILE_LIMIT as u64)
}

fn read_file(path: &Path, limit: u64) -> Result<String, String> {
    if !std::fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_file()
    {
        return Err("备份文件类型无效".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit.saturating_add(128 * 1024) {
        return Err("备份超过读取上限".into());
    }
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(128 * 1024).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit.saturating_add(128 * 1024) {
        return Err("备份超过读取上限".into());
    }
    let bytes = unprotect_backup(&bytes, limit)?;
    if bytes.len() as u64 > limit {
        return Err("备份超过读取上限".into());
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let content = read_file(&dir.join("manifest.json"), 1024 * 1024)?;
    let manifest: Manifest =
        serde_json::from_str(&content).map_err(|_| "备份清单损坏".to_string())?;
    if manifest.version != 1
        || manifest.parts.is_empty()
        || manifest.parts.len() > MAX_PARTS
        || manifest
            .parts
            .iter()
            .any(|p| p.bytes > FILE_LIMIT || p.sha256.len() != 64)
    {
        return Err("备份清单无效".into());
    }
    Ok(manifest)
}

fn latest_info(dir: &Path) -> Result<BackupReadInfo, String> {
    let paths = backups(dir)?;
    let path = paths.last().ok_or("还没有自动备份")?;
    let parts = if path.is_dir() {
        read_manifest(path)?.parts.len()
    } else {
        1
    };
    Ok(BackupReadInfo {
        id: path.file_name().unwrap().to_string_lossy().into_owned(),
        parts,
    })
}

fn read_part(dir: &Path, id: &str, index: usize) -> Result<String, String> {
    let path = backups(dir)?
        .into_iter()
        .find(|p| p.file_name().unwrap().to_string_lossy() == id)
        .ok_or("找不到指定备份")?;
    if path.is_file() {
        if index != 0 {
            return Err("备份分段序号无效".into());
        }
        return read_file(&path, FILE_LIMIT as u64);
    }
    let manifest = read_manifest(&path)?;
    let part = manifest.parts.get(index).ok_or("备份分段序号无效")?;
    let content = read_file(
        &path.join(format!("part-{index:04}.json")),
        FILE_LIMIT as u64,
    )?;
    if content.len() != part.bytes
        || format!("{:x}", Sha256::digest(content.as_bytes())) != part.sha256
    {
        return Err("备份分段校验失败，请勿恢复损坏的备份".into());
    }
    Ok(content)
}

#[tauri::command]
pub async fn crm_backup_latest_info(app: tauri::AppHandle) -> Result<BackupReadInfo, String> {
    let dir = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || latest_info(&dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_backup_read_part(
    app: tauri::AppHandle,
    id: String,
    index: usize,
) -> Result<String, String> {
    let dir = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_part(&dir, &id, index))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_backup_latest(app: tauri::AppHandle) -> Result<String, String> {
    let dir = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || latest(&dir))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = r#"{"version":2,"app":"WAP Plus CRM","phones":[],"contacts":[],"chats":[],"messages":[],"followUps":[],"activities":[],"broadcastCampaigns":[],"settingsSafe":{}}"#;

    #[test]
    fn retention_budget_preserves_the_newest_complete_backup() {
        let dir = std::env::temp_dir().join(format!("wap-backup-budget-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        for day in ["2026-11-01", "2026-11-02", "2026-11-03"] {
            std::fs::write(dir.join(format!("crm-{day}.json")), HEADER).unwrap();
        }
        prune(&dir, HEADER.len() as u64 + 1).unwrap();
        let kept = backups(&dir).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(backup_day(&kept[0]), "2026-11-03");
        prune(&dir, 1).unwrap();
        assert_eq!(backups(&dir).unwrap().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn history_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE phones(id TEXT, json TEXT); CREATE TABLE contacts(id TEXT, json TEXT); CREATE TABLE chats(id TEXT, json TEXT); CREATE TABLE follow_ups(id TEXT, json TEXT); CREATE TABLE messages(id TEXT, sent_at TEXT, json TEXT); CREATE TABLE activities(id TEXT, at_ts TEXT, json TEXT);").unwrap();
        conn
    }

    #[test]
    fn pragma_integer_accepts_sqlcipher_text_page_size() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let integer = conn
            .query_row("SELECT 4096 AS page_size", [], |row| read_pragma_integer(row, 0))
            .unwrap();
        let text = conn
            .query_row("SELECT '4096' AS cipher_page_size", [], |row| {
                read_pragma_integer(row, 0)
            })
            .unwrap();
        let page_size = conn
            .query_row("PRAGMA page_size", [], |row| read_pragma_integer(row, 0))
            .unwrap();
        assert_eq!(integer, 4096);
        assert_eq!(text, 4096);
        assert!(page_size > 0);
    }

    #[test]
    fn segmented_backup_round_trips_more_than_256_mib_and_detects_corruption() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let conn = history_db();
        let tx = conn.unchecked_transaction().unwrap();
        let body = format!("测试😀{}", "x".repeat(1024 * 1024));
        for index in 0..258 {
            let id = format!("{index:04}");
            let json = serde_json::json!({ "id": id, "body": body, "chatId": "chat", "direction": "in", "sentAt": "2026-11-01T00:00:00Z" }).to_string();
            tx.execute(
                "INSERT INTO messages VALUES (?1, '2026-11-01T00:00:00Z', ?2)",
                rusqlite::params![id, json],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        save_segmented(&dir, &conn, HEADER, "2026-11-01").unwrap();
        let info = latest_info(&dir).unwrap();
        let manifest = read_manifest(&dir.join(&info.id)).unwrap();
        assert!(manifest.parts.iter().map(|p| p.bytes).sum::<usize>() > FILE_LIMIT);
        assert!(manifest.parts.iter().all(|p| p.bytes <= HISTORY_PART_BYTES));
        let mut count = 0;
        for index in 1..info.parts {
            let part: serde_json::Value =
                serde_json::from_str(&read_part(&dir, &info.id, index).unwrap()).unwrap();
            for message in part["messages"].as_array().unwrap() {
                assert_eq!(message["id"], format!("{count:04}"));
                assert_eq!(message["body"].as_str().unwrap(), body);
                count += 1;
            }
        }
        assert_eq!(count, 258);
        assert_eq!(
            conn.query_row("SELECT count(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            258
        );
        assert_eq!(latest(&dir).unwrap_err(), "分段备份请使用新版恢复入口");
        std::fs::write(dir.join(&info.id).join("part-0001.json"), b"{}").unwrap();
        assert!(read_part(&dir, &info.id, 1)
            .unwrap_err()
            .contains("校验失败"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn segmented_backup_keeps_seven_days_and_preserves_valid_backups_on_failure() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let conn = history_db();
        conn.execute(
            "INSERT INTO contacts VALUES ('one', ?1)",
            [r#"{"id":"one","name":"Grace"}"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages VALUES ('legacy', '', CAST(?1 AS TEXT))",
            [b"{\"id\":\"legacy\",\"body\":\"old\xff\"}".as_slice()],
        )
        .unwrap();
        let voice = serde_json::json!({"id":"voice", "mediaType":"audio", "mediaUrl":format!("data:audio/ogg;base64,{}", "a".repeat(8100)), "mediaPending":false}).to_string();
        conn.execute(
            "INSERT INTO messages VALUES ('voice', '2026-11-01', ?1)",
            [&voice],
        )
        .unwrap();
        std::fs::write(dir.join("user-notes.json"), b"keep").unwrap();
        save(&dir, HEADER, "2026-10-01").unwrap();
        assert_eq!(read_part(&dir, "crm-2026-10-01.json", 0).unwrap(), HEADER);
        for day in 1..=9 {
            save_segmented(&dir, &conn, HEADER, &format!("2026-11-{day:02}")).unwrap();
        }
        let previous = latest_info(&dir).unwrap();
        save_segmented(&dir, &conn, HEADER, "2026-11-09").unwrap();
        assert_eq!(backups(&dir).unwrap().len(), 7);
        assert_eq!(
            status(&dir).unwrap().latest_day.as_deref(),
            Some("2026-11-09")
        );
        assert!(dir.join("user-notes.json").exists());
        assert!(!dir.join(previous.id).exists());
        let good = latest_info(&dir).unwrap();
        let contacts: serde_json::Value =
            serde_json::from_str(&read_part(&dir, &good.id, 1).unwrap()).unwrap();
        assert_eq!(contacts["contacts"][0]["name"], "Grace");
        let messages = read_part(&dir, &good.id, 2).unwrap();
        assert!(messages.contains("old�"));
        let chunk: serde_json::Value = serde_json::from_str(&messages).unwrap();
        assert!(chunk["messages"][1].get("mediaUrl").is_none());
        assert_eq!(chunk["messages"][1]["mediaPending"], true);
        assert_eq!(
            conn.query_row("SELECT json FROM messages WHERE id = 'voice'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            voice
        );
        let original: Vec<u8> = conn
            .query_row(
                "SELECT CAST(json AS BLOB) FROM messages WHERE id = 'legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(original.contains(&0xff));
        conn.execute(
            "INSERT INTO messages VALUES ('broken', 'zzz', 'invalid json')",
            [],
        )
        .unwrap();
        assert!(save_segmented(&dir, &conn, HEADER, "2026-11-10").is_err());
        assert_eq!(latest_info(&dir).unwrap().id, good.id);
        assert!(!std::fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".crm-pending-")));
        assert!(save_segmented(
            &dir,
            &conn,
            &HEADER.replace(
                "\"settingsSafe\":{}",
                "\"settingsSafe\":{\"transcriptionApiKey\":\"fixture\"}"
            ),
            "2026-11-10"
        )
        .is_err());
        assert!(read_part(&dir, "../user-notes.json", 0).is_err());
        assert!(read_part(&dir, &good.id, usize::MAX).is_err());
        let mut parts = Vec::new();
        assert!(write_history(
            &dir,
            &conn,
            "contacts",
            "SELECT json FROM contacts",
            &mut parts,
            16
        )
        .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn retains_seven_restorable_json_files_and_preserves_good_backup_on_failure() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let content = r#"{"version":2,"app":"WAP Plus CRM","phones":[],"contacts":[],"chats":[],"messages":[],"followUps":[],"activities":[],"broadcastCampaigns":[],"settingsSafe":{}}"#;
        std::fs::write(dir.join("user-notes.json"), b"keep").unwrap();
        for day in 1..=9 {
            save(&dir, content, &format!("2026-10-{day:02}")).unwrap();
        }
        assert_eq!(backups(&dir).unwrap().len(), 7);
        assert_eq!(
            status(&dir).unwrap().latest_day.as_deref(),
            Some("2026-10-09")
        );
        assert_eq!(latest(&dir).unwrap(), content);
        assert!(save(&dir, "invalid", "2026-10-09").is_err());
        let unsafe_content = content.replace(
            "\"settingsSafe\":{}",
            "\"settingsSafe\":{\"openaiKey\":\"fixture\"}",
        );
        assert!(save(&dir, &unsafe_content, "2026-10-09").is_err());
        assert_eq!(
            read_file(&dir.join("crm-2026-10-09.json"), FILE_LIMIT as u64).unwrap(),
            content
        );
        assert!(dir.join("user-notes.json").exists());
        assert!(save(&dir, content, "../2026-10-09").is_err());
        let oversized = std::fs::File::create(dir.join("crm-2026-10-10.json")).unwrap();
        oversized.set_len(256 * 1024 * 1024 + 1).unwrap();
        drop(oversized);
        assert_eq!(latest(&dir).unwrap_err(), "备份超过读取上限");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
