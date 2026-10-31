use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Manager;

const MAX_IMAGE: usize = 8 * 1024 * 1024;
const MAX_TOTAL: i64 = 1024 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Request {
    List,
    Read { id: String },
    Import { title: String, category: String, data: String, thumbnail: String },
    Edit { id: String, title: String, category: String, pinned: bool, used_at: i64 },
    Delete { ids: Vec<String> },
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("Invalid image ID".into());
    }
    Ok(())
}

fn mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Ok("image/png") }
    else if bytes.starts_with(b"\xff\xd8\xff") { Ok("image/jpeg") }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { Ok("image/gif") }
    else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { Ok("image/webp") }
    else { Err("Only PNG, JPEG, GIF and WebP images are supported".into()) }
}

fn decode(data: &str, limit: usize) -> Result<(Vec<u8>, &'static str), String> {
    if data.len() > limit * 4 / 3 + 128 { return Err("Image exceeds size limit".into()); }
    let (prefix, payload) = data.split_once(',').ok_or("Invalid image data")?;
    let bytes = STANDARD.decode(payload).map_err(|_| "Invalid image encoding")?;
    if bytes.is_empty() || bytes.len() > limit { return Err("Image exceeds size limit".into()); }
    let kind = mime(&bytes)?;
    if prefix != format!("data:{kind};base64") { return Err("Image type does not match content".into()); }
    Ok((bytes, kind))
}

fn labels(title: &str, category: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 160 || category.chars().count() > 60 {
        return Err("Invalid image name or category".into());
    }
    Ok(())
}

fn execute(conn: &Connection, dir: &Path, request: Request) -> Result<Value, String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS image_library (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, thumbnail TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, used_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)").map_err(|e| e.to_string())?;
    match request {
        Request::List => {
            let mut stmt = conn.prepare("SELECT id,title,category,mime,size,thumbnail,pinned,used_at,created_at FROM image_library ORDER BY created_at DESC,id").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"category":r.get::<_,String>(2)?,"mime":r.get::<_,String>(3)?,"size":r.get::<_,i64>(4)?,"thumbnail":r.get::<_,String>(5)?,"pinned":r.get::<_,bool>(6)?,"usedAt":r.get::<_,i64>(7)?,"createdAt":r.get::<_,i64>(8)?}))).map_err(|e| e.to_string())?;
            Ok(Value::Array(rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?))
        }
        Request::Read { id } => {
            valid_id(&id)?;
            let kind: String = conn.query_row("SELECT mime FROM image_library WHERE id=?1", [&id], |r| r.get(0)).map_err(|e| e.to_string())?;
            let path = dir.join(&id);
            let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(MAX_IMAGE as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_IMAGE || format!("{:x}", Sha256::digest(&bytes)) != id || mime(&bytes)? != kind { return Err("Image file is damaged".into()); }
            Ok(json!(format!("data:{kind};base64,{}", STANDARD.encode(bytes))))
        }
        Request::Import { title, category, data, thumbnail } => {
            labels(&title, &category)?;
            let (bytes, kind) = decode(&data, MAX_IMAGE)?;
            let (_, thumb_kind) = decode(&thumbnail, 48 * 1024)?;
            if thumb_kind != "image/jpeg" { return Err("Thumbnail must be JPEG".into()); }
            let id = format!("{:x}", Sha256::digest(&bytes));
            let exists = conn.query_row("SELECT 1 FROM image_library WHERE id=?1", [&id], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some();
            if exists {
                // Reimporting a backup also repairs a missing or damaged original.
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                crate::atomic_file::write_atomic(&dir.join(&id), &bytes).map_err(|e| e.to_string())?;
                return Ok(json!({"id":id,"added":false}));
            }
            let (total, count): (i64, i64) = conn.query_row("SELECT coalesce(sum(size),0),count(*) FROM image_library", [], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|e| e.to_string())?;
            if total + bytes.len() as i64 > MAX_TOTAL || count >= 3000 { return Err("Image library limit reached (1 GB / 3000 images)".into()); }
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let path = dir.join(&id);
            crate::atomic_file::write_atomic(&path, &bytes).map_err(|e| e.to_string())?;
            if let Err(error) = conn.execute("INSERT INTO image_library(id,title,category,mime,size,thumbnail,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![id,title.trim(),category.trim(),kind,bytes.len() as i64,thumbnail,chrono::Utc::now().timestamp_millis()]) {
                let _ = std::fs::remove_file(path);
                return Err(error.to_string());
            }
            Ok(json!({"id":id,"added":true}))
        }
        Request::Edit { id, title, category, pinned, used_at } => {
            valid_id(&id)?; labels(&title, &category)?;
            let changed = conn.execute("UPDATE image_library SET title=?2,category=?3,pinned=?4,used_at=?5 WHERE id=?1", params![id,title.trim(),category.trim(),pinned,used_at.max(0)]).map_err(|e| e.to_string())?;
            if changed == 0 { return Err("Image no longer exists".into()); }
            Ok(Value::Null)
        }
        Request::Delete { ids } => {
            if ids.len() > 3000 { return Err("Too many images".into()); }
            for id in &ids { valid_id(id)?; }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for id in &ids { tx.execute("DELETE FROM image_library WHERE id=?1", [id]).map_err(|e| e.to_string())?; }
            tx.commit().map_err(|e| e.to_string())?;
            for id in ids {
                if let Err(error) = std::fs::remove_file(dir.join(id)) {
                    if error.kind() != std::io::ErrorKind::NotFound { tracing::warn!(%error, "could not remove unused library image"); }
                }
            }
            Ok(Value::Null)
        }
    }
}

#[tauri::command]
pub async fn image_library(app: tauri::AppHandle, request: Request) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("image-library");
        let db = app.state::<crate::db::DbState>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        execute(&conn, &dir, request)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stores_deduplicated_files_without_inline_originals_and_validates_reads() {
        let conn = Connection::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let data = format!("data:image/png;base64,{}", STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture"));
        let thumb = format!("data:image/jpeg;base64,{}", STANDARD.encode(b"\xff\xd8\xfffixture"));
        let import = || Request::Import { title:"Photo".into(),category:"Test".into(),data:data.clone(),thumbnail:thumb.clone() };
        let added = execute(&conn,&dir,import()).unwrap(); let id = added["id"].as_str().unwrap();
        assert_eq!(execute(&conn,&dir,import()).unwrap()["added"],false);
        assert_eq!(execute(&conn,&dir,Request::Read{id:id.into()}).unwrap(),data);
        assert_eq!(execute(&conn,&dir,Request::List).unwrap().as_array().unwrap().len(),1);
        assert!(execute(&conn,&dir,Request::Read{id:"../outside".into()}).is_err());
        assert!(decode("data:image/svg+xml;base64,PHN2Zz4=",MAX_IMAGE).is_err());
        std::fs::write(dir.join(id),b"broken").unwrap();
        assert!(execute(&conn,&dir,Request::Read{id:id.into()}).is_err());
        assert_eq!(execute(&conn,&dir,import()).unwrap()["added"],false);
        assert_eq!(execute(&conn,&dir,Request::Read{id:id.into()}).unwrap(),data);
        execute(&conn,&dir,Request::Delete{ids:vec![id.into()]}).unwrap();
        assert!(execute(&conn,&dir,Request::List).unwrap().as_array().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
