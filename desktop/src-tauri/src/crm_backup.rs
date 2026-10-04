use std::path::{Path, PathBuf};
use std::io::Read;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus { folder: String, latest_day: Option<String> }

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("crm-backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn backups(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map_err(|e| e.to_string())?.is_file() && name.len() == 19
            && name.is_ascii() && name.starts_with("crm-") && name.ends_with(".json")
            && chrono::NaiveDate::parse_from_str(&name[4..14], "%Y-%m-%d").is_ok() {
            files.push(entry.path());
        }
    }
    files.sort();
    Ok(files)
}

fn status(dir: &Path) -> Result<BackupStatus, String> {
    let latest_day = backups(dir)?.last().map(|p| p.file_name().unwrap().to_string_lossy()[4..14].to_string());
    Ok(BackupStatus { folder: dir.to_string_lossy().into_owned(), latest_day })
}

fn save(dir: &Path, content: &str, day: &str) -> Result<BackupStatus, String> {
    if content.len() > 256 * 1024 * 1024 { return Err("备份超过 256 MiB，请使用手动导出".into()); }
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "备份日期无效".to_string())?;
    let value: serde_json::Value = serde_json::from_str(content).map_err(|_| "备份不是有效 JSON".to_string())?;
    if value["version"] != 2 || value["app"] != "WAP Plus CRM"
        || !["phones", "contacts", "chats", "messages", "followUps", "activities", "broadcastCampaigns"].iter().all(|key| value[key].is_array())
        || !value["settingsSafe"].is_object() || value.get("settings").is_some() {
        return Err("备份格式无效".into());
    }
    for key in ["openaiKey", "groqKey", "geminiKey", "deepseekKey", "qwenKey", "zhipuKey", "openrouterKey", "customAiKey", "bridgeToken"] {
        if value["settingsSafe"].get(key).is_some() { return Err("备份不能包含密钥".into()); }
    }
    crate::atomic_file::write_atomic(&dir.join(format!("crm-{day}.json")), content.as_bytes()).map_err(|e| e.to_string())?;
    let files = backups(dir)?;
    for path in files.iter().take(files.len().saturating_sub(7)) {
        std::fs::remove_file(path).map_err(|e| format!("备份已保存，但清理旧备份失败：{e}"))?;
    }
    status(dir)
}

#[tauri::command]
pub fn crm_backup_status(app: tauri::AppHandle) -> Result<BackupStatus, String> { status(&root(&app)?) }

#[tauri::command]
pub async fn crm_backup_save(app: tauri::AppHandle, content: String) -> Result<BackupStatus, String> {
    let dir = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || save(&dir, &content, &chrono::Local::now().format("%Y-%m-%d").to_string()))
        .await.map_err(|e| e.to_string())?
}

fn latest(dir: &Path) -> Result<String, String> {
    let paths = backups(dir)?;
    let path = paths.last().ok_or("还没有自动备份")?;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    const LIMIT: u64 = 256 * 1024 * 1024;
    if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT { return Err("备份超过读取上限".into()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT { return Err("备份超过读取上限".into()); }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_backup_latest(app: tauri::AppHandle) -> Result<String, String> {
    let dir = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || latest(&dir)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_seven_restorable_json_files_and_preserves_good_backup_on_failure() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let content = r#"{"version":2,"app":"WAP Plus CRM","phones":[],"contacts":[],"chats":[],"messages":[],"followUps":[],"activities":[],"broadcastCampaigns":[],"settingsSafe":{}}"#;
        std::fs::write(dir.join("user-notes.json"), b"keep").unwrap();
        for day in 1..=9 { save(&dir, content, &format!("2026-10-{day:02}")).unwrap(); }
        assert_eq!(backups(&dir).unwrap().len(), 7);
        assert_eq!(status(&dir).unwrap().latest_day.as_deref(), Some("2026-10-09"));
        assert_eq!(latest(&dir).unwrap(), content);
        assert!(save(&dir, "invalid", "2026-10-09").is_err());
        let unsafe_content = content.replace("\"settingsSafe\":{}", "\"settingsSafe\":{\"openaiKey\":\"fixture\"}");
        assert!(save(&dir, &unsafe_content, "2026-10-09").is_err());
        assert_eq!(std::fs::read_to_string(dir.join("crm-2026-10-09.json")).unwrap(), content);
        assert!(dir.join("user-notes.json").exists());
        assert!(save(&dir, content, "../2026-10-09").is_err());
        let oversized = std::fs::File::create(dir.join("crm-2026-10-10.json")).unwrap();
        oversized.set_len(256 * 1024 * 1024 + 1).unwrap();
        drop(oversized);
        assert_eq!(latest(&dir).unwrap_err(), "备份超过读取上限");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
