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
    ListCategories,
    CreateCategory {
        name: String,
    },
    DeleteCategory {
        name: String,
    },
    RenameCategory {
        name: String,
        new_name: String,
    },
    OrderCategories {
        names: Vec<String>,
    },
    Move {
        ids: Vec<String>,
        category: String,
        before_id: Option<String>,
        #[serde(default)]
        after: bool,
    },
    Replace {
        id: String,
        data: String,
        thumbnail: String,
    },
    Scan {
        paths: Vec<String>,
    },
    Read {
        id: String,
    },
    Import {
        title: String,
        category: String,
        data: String,
        thumbnail: String,
    },
    Edit {
        id: String,
        title: String,
        category: String,
        pinned: bool,
        used_at: i64,
        caption: Option<String>,
    },
    Delete {
        ids: Vec<String>,
    },
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid image ID".into());
    }
    Ok(())
}

fn mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("image/webp")
    } else {
        Err("Only PNG, JPEG, GIF and WebP images are supported".into())
    }
}

pub(crate) fn decode(data: &str, limit: usize) -> Result<(Vec<u8>, &'static str), String> {
    if data.len() > limit * 4 / 3 + 128 {
        return Err("Image exceeds size limit".into());
    }
    let (prefix, payload) = data.split_once(',').ok_or("Invalid image data")?;
    let bytes = STANDARD
        .decode(payload)
        .map_err(|_| "Invalid image encoding")?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err("Image exceeds size limit".into());
    }
    let kind = mime(&bytes)?;
    if prefix != format!("data:{kind};base64") {
        return Err("Image type does not match content".into());
    }
    Ok((bytes, kind))
}

fn labels(title: &str, category: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 160 || category.chars().count() > 60 {
        return Err("Invalid image name or category".into());
    }
    Ok(())
}

fn register_category(conn: &Connection, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    if name == "*" || name.chars().count() > 60 {
        return Err("Invalid category name".into());
    }
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM image_library_categories WHERE name=?1",
            [name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        let total: i64 = conn
            .query_row("SELECT count(*) FROM image_library_categories", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        if total >= 3000 {
            return Err("Category limit reached (3000)".into());
        }
        conn.execute("INSERT INTO image_library_categories(name,sort_order) VALUES (?1,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM image_library_categories))", [name]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn execute(conn: &Connection, dir: &Path, request: Request) -> Result<Value, String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS image_library (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, thumbnail TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, used_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)").map_err(|e| e.to_string())?;
    let has_caption: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('image_library') WHERE name='caption')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_caption {
        conn.execute_batch("ALTER TABLE image_library ADD COLUMN caption TEXT NOT NULL DEFAULT ''")
            .map_err(|e| e.to_string())?;
    }
    let has_categories: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='image_library_categories')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if !has_categories {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch("CREATE TABLE image_library_categories (name TEXT PRIMARY KEY NOT NULL); INSERT INTO image_library_categories(name) SELECT DISTINCT category FROM image_library WHERE category <> '';").map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    for table in ["image_library", "image_library_categories"] {
        let has_order:bool=conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM pragma_table_info('{table}') WHERE name='sort_order')"),[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !has_order {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
            ))
            .map_err(|e| e.to_string())?;
        }
    }
    match request {
        Request::Scan { .. } => Err("Folder scanning must run outside the database lock".into()),
        Request::ListCategories => {
            let mut stmt = conn
                .prepare("SELECT name FROM image_library_categories ORDER BY sort_order,name")
                .map_err(|e| e.to_string())?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(json!(names))
        }
        Request::CreateCategory { name } => {
            if name.trim().is_empty() {
                return Err("Category name is required".into());
            }
            register_category(conn, &name)?;
            Ok(Value::Null)
        }
        Request::DeleteCategory { name } => {
            let name = name.trim();
            if name.is_empty() || name == "*" || name.chars().count() > 60 {
                return Err("Invalid category name".into());
            }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE image_library SET category='' WHERE category=?1",
                [name],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM image_library_categories WHERE name=?1", [name])
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        Request::RenameCategory { name, new_name } => {
            let (name, new_name) = (name.trim(), new_name.trim());
            labels("category", new_name)?;
            if name.is_empty() || new_name.is_empty() || new_name == "*" {
                return Err("Invalid category name".into());
            }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            if tx
                .execute(
                    "UPDATE image_library_categories SET name=?2 WHERE name=?1",
                    params![name, new_name],
                )
                .map_err(|_| "Category already exists".to_string())?
                == 0
            {
                return Err("Category no longer exists".into());
            }
            tx.execute(
                "UPDATE image_library SET category=?2 WHERE category=?1",
                params![name, new_name],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        Request::OrderCategories { names } => {
            if names.len() > 3000 {
                return Err("Too many categories".into());
            }
            let mut seen = std::collections::HashSet::new();
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let existing = {
                let mut stmt = tx
                    .prepare("SELECT name FROM image_library_categories ORDER BY sort_order,name")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            for name in &names {
                if !seen.insert(name)
                    || name.trim().is_empty()
                    || name.chars().count() > 60
                    || !existing.contains(name)
                {
                    return Err("Invalid category order".into());
                }
            }
            let mut ordered = names.clone();
            ordered.extend(existing.into_iter().filter(|name| !seen.contains(name)));
            for (index, name) in ordered.iter().enumerate() {
                tx.execute(
                    "UPDATE image_library_categories SET sort_order=?2 WHERE name=?1",
                    params![name, index as i64],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        Request::Move {
            ids,
            category,
            before_id,
            after,
        } => {
            if ids.is_empty() || ids.len() > 3000 {
                return Err("Invalid image selection".into());
            }
            labels("image", &category)?;
            let mut seen = std::collections::HashSet::new();
            for id in &ids {
                valid_id(id)?;
                if !seen.insert(id) {
                    return Err("Duplicate image selection".into());
                }
            }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            register_category(&tx, &category)?;
            for id in &ids {
                if tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM image_library WHERE id=?1)",
                        [id],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(|e| e.to_string())?
                    == false
                {
                    return Err("Image no longer exists".into());
                }
            }
            let mut order = {
                let mut stmt=tx.prepare("SELECT id FROM image_library WHERE category=?1 ORDER BY sort_order,pinned DESC,created_at DESC,id").map_err(|e|e.to_string())?;
                let rows = stmt
                    .query_map([category.trim()], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            order.retain(|id| !seen.contains(id));
            let at = if let Some(before) = before_id {
                valid_id(&before)?;
                order
                    .iter()
                    .position(|id| id == &before)
                    .ok_or("Drop target no longer exists")?
                    + usize::from(after)
            } else {
                order.len()
            };
            order.splice(at..at, ids.clone());
            for id in &ids {
                tx.execute(
                    "UPDATE image_library SET category=?2 WHERE id=?1",
                    params![id, category.trim()],
                )
                .map_err(|e| e.to_string())?;
            }
            for (index, id) in order.iter().enumerate() {
                tx.execute(
                    "UPDATE image_library SET sort_order=?2 WHERE id=?1",
                    params![id, index as i64],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        Request::Replace {
            id,
            data,
            thumbnail,
        } => {
            valid_id(&id)?;
            let (bytes, kind) = decode(&data, MAX_IMAGE)?;
            let (_, thumb_kind) = decode(&thumbnail, 48 * 1024)?;
            if thumb_kind != "image/jpeg" {
                return Err("Thumbnail must be JPEG".into());
            }
            let next = format!("{:x}", Sha256::digest(&bytes));
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let old_size: i64 = tx
                .query_row("SELECT size FROM image_library WHERE id=?1", [&id], |r| {
                    r.get(0)
                })
                .map_err(|_| "Image no longer exists".to_string())?;
            if next != id
                && tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM image_library WHERE id=?1)",
                        [&next],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(|e| e.to_string())?
            {
                return Err("Replacement image is already in the library".into());
            }
            let total: i64 = tx
                .query_row("SELECT COALESCE(SUM(size),0) FROM image_library", [], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            if total - old_size + bytes.len() as i64 > MAX_TOTAL {
                return Err("Image library limit reached (1 GB)".into());
            }
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            crate::atomic_file::write_atomic(&dir.join(&next), &bytes)
                .map_err(|e| e.to_string())?;
            let change = (|| {
                tx.execute(
                    "UPDATE image_library SET id=?2,mime=?3,size=?4,thumbnail=?5 WHERE id=?1",
                    params![id, next, kind, bytes.len() as i64, thumbnail],
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())
            })();
            if let Err(error) = change {
                if next != id {
                    let _ = std::fs::remove_file(dir.join(&next));
                }
                return Err(error);
            }
            if next != id {
                if let Err(error) = std::fs::remove_file(dir.join(&id)) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(%error,"could not remove replaced library image");
                    }
                }
            }
            Ok(json!({"id":next}))
        }
        Request::List => {
            let mut stmt = conn.prepare("SELECT id,title,category,mime,size,thumbnail,pinned,used_at,created_at,caption,sort_order FROM image_library ORDER BY sort_order,pinned DESC,created_at DESC,id").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"category":r.get::<_,String>(2)?,"mime":r.get::<_,String>(3)?,"size":r.get::<_,i64>(4)?,"thumbnail":r.get::<_,String>(5)?,"pinned":r.get::<_,bool>(6)?,"usedAt":r.get::<_,i64>(7)?,"createdAt":r.get::<_,i64>(8)?,"caption":r.get::<_,String>(9)?,"sortOrder":r.get::<_,i64>(10)?}))).map_err(|e| e.to_string())?;
            Ok(Value::Array(
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?,
            ))
        }
        Request::Read { id } => {
            valid_id(&id)?;
            let kind: String = conn
                .query_row("SELECT mime FROM image_library WHERE id=?1", [&id], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            let path = dir.join(&id);
            let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(MAX_IMAGE as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > MAX_IMAGE
                || format!("{:x}", Sha256::digest(&bytes)) != id
                || mime(&bytes)? != kind
            {
                return Err("Image file is damaged".into());
            }
            Ok(json!(format!(
                "data:{kind};base64,{}",
                STANDARD.encode(bytes)
            )))
        }
        Request::Import {
            title,
            category,
            data,
            thumbnail,
        } => {
            labels(&title, &category)?;
            let (bytes, kind) = decode(&data, MAX_IMAGE)?;
            let (_, thumb_kind) = decode(&thumbnail, 48 * 1024)?;
            if thumb_kind != "image/jpeg" {
                return Err("Thumbnail must be JPEG".into());
            }
            register_category(conn, &category)?;
            let id = format!("{:x}", Sha256::digest(&bytes));
            let exists = conn
                .query_row("SELECT 1 FROM image_library WHERE id=?1", [&id], |_| Ok(()))
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if exists {
                // Reimporting a backup also repairs a missing or damaged original.
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                crate::atomic_file::write_atomic(&dir.join(&id), &bytes)
                    .map_err(|e| e.to_string())?;
                return Ok(json!({"id":id,"added":false}));
            }
            let (total, count): (i64, i64) = conn
                .query_row(
                    "SELECT coalesce(sum(size),0),count(*) FROM image_library",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            if total + bytes.len() as i64 > MAX_TOTAL || count >= 3000 {
                return Err("Image library limit reached (1 GB / 3000 images)".into());
            }
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let path = dir.join(&id);
            crate::atomic_file::write_atomic(&path, &bytes).map_err(|e| e.to_string())?;
            if let Err(error) = conn.execute("INSERT INTO image_library(id,title,category,mime,size,thumbnail,created_at,sort_order) VALUES (?1,?2,?3,?4,?5,?6,?7,(SELECT COALESCE(MIN(sort_order),0)-1 FROM image_library))", params![id,title.trim(),category.trim(),kind,bytes.len() as i64,thumbnail,chrono::Utc::now().timestamp_millis()]) {
                let _ = std::fs::remove_file(path);
                return Err(error.to_string());
            }
            Ok(json!({"id":id,"added":true}))
        }
        Request::Edit {
            id,
            title,
            category,
            pinned,
            used_at,
            caption,
        } => {
            valid_id(&id)?;
            labels(&title, &category)?;
            if caption
                .as_ref()
                .is_some_and(|text| text.encode_utf16().count() > 2000)
            {
                return Err("Image caption exceeds 2000 characters".into());
            }
            register_category(conn, &category)?;
            let changed = conn.execute("UPDATE image_library SET title=?2,category=?3,pinned=?4,used_at=?5,caption=COALESCE(?6,caption) WHERE id=?1", params![id,title.trim(),category.trim(),pinned,used_at.max(0),caption]).map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Image no longer exists".into());
            }
            Ok(Value::Null)
        }
        Request::Delete { ids } => {
            if ids.len() > 3000 {
                return Err("Too many images".into());
            }
            for id in &ids {
                valid_id(id)?;
            }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for id in &ids {
                tx.execute("DELETE FROM image_library WHERE id=?1", [id])
                    .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            for id in ids {
                if let Err(error) = std::fs::remove_file(dir.join(id)) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(%error, "could not remove unused library image");
                    }
                }
            }
            Ok(Value::Null)
        }
    }
}

#[tauri::command]
pub async fn image_library(app: tauri::AppHandle, request: Request) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let request = match request {
            Request::Scan { paths } => {
                return serde_json::to_value(crate::image_library_import::scan(paths)?)
                    .map_err(|e| e.to_string())
            }
            request => request,
        };
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("image-library");
        let db = app.state::<crate::db::DbState>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        execute(&conn, &dir, request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn add_photo(conn: &Connection, dir: &Path, title: &str, category: &str) -> String {
        let bytes = [b"\x89PNG\r\n\x1a\n".as_slice(), title.as_bytes()].concat();
        execute(
            conn,
            dir,
            Request::Import {
                title: title.into(),
                category: category.into(),
                data: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
                thumbnail: format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode(b"\xff\xd8\xfffixture")
                ),
            },
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .into()
    }
    #[test]
    fn drag_order_and_category_renames_survive_reopening_without_changing_captions() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("test.db");
        let conn = Connection::open(&db).unwrap();
        let (a, b, c) = (
            add_photo(&conn, &dir, "A", "One"),
            add_photo(&conn, &dir, "B", "One"),
            add_photo(&conn, &dir, "C", "Two"),
        );
        execute(
            &conn,
            &dir,
            Request::Edit {
                id: a.clone(),
                title: "A".into(),
                category: "One".into(),
                pinned: true,
                used_at: 123,
                caption: Some("Keep this caption".into()),
            },
        )
        .unwrap();
        execute(
            &conn,
            &dir,
            Request::Move {
                ids: vec![a.clone(), b.clone()],
                category: "Two".into(),
                before_id: Some(c.clone()),
                after: false,
            },
        )
        .unwrap();
        let list = execute(&conn, &dir, Request::List).unwrap();
        assert_eq!(
            list.as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![a.as_str(), b.as_str(), c.as_str()]
        );
        assert_eq!(list[0]["caption"], "Keep this caption");
        assert_eq!(list[0]["usedAt"], 123);
        assert_eq!(list[0]["pinned"], true);
        execute(
            &conn,
            &dir,
            Request::RenameCategory {
                name: "Two".into(),
                new_name: "Renamed".into(),
            },
        )
        .unwrap();
        assert!(execute(
            &conn,
            &dir,
            Request::RenameCategory {
                name: "Renamed".into(),
                new_name: "One".into()
            }
        )
        .is_err());
        execute(
            &conn,
            &dir,
            Request::OrderCategories {
                names: vec!["Renamed".into(), "One".into()],
            },
        )
        .unwrap();
        drop(conn);
        let conn = Connection::open(&db).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["Renamed", "One"])
        );
        assert!(execute(&conn, &dir, Request::List)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["category"] == "Renamed"));
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_or_failed_multi_image_moves_roll_back_the_entire_operation() {
        let conn = Connection::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let (a, b) = (
            add_photo(&conn, &dir, "A", "One"),
            add_photo(&conn, &dir, "B", "One"),
        );
        let before = execute(&conn, &dir, Request::List).unwrap();
        for ids in [vec![a.clone(), "0".repeat(64)], vec![a.clone(), a.clone()]] {
            assert!(execute(
                &conn,
                &dir,
                Request::Move {
                    ids,
                    category: "New".into(),
                    before_id: None,
                    after: false
                }
            )
            .is_err());
            assert_eq!(execute(&conn, &dir, Request::List).unwrap(), before);
        }
        conn.execute_batch("CREATE TRIGGER block_move BEFORE UPDATE OF category ON image_library WHEN OLD.title='A' BEGIN SELECT RAISE(ABORT,'busy'); END;").unwrap();
        assert!(execute(
            &conn,
            &dir,
            Request::Move {
                ids: vec![b, a],
                category: "New".into(),
                before_id: None,
                after: false
            }
        )
        .is_err());
        assert_eq!(execute(&conn, &dir, Request::List).unwrap(), before);
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["One"])
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn replacing_an_image_preserves_its_metadata_and_keeps_the_original_on_failure() {
        let conn = Connection::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let a = add_photo(&conn, &dir, "A", "One");
        execute(
            &conn,
            &dir,
            Request::Edit {
                id: a.clone(),
                title: "A".into(),
                category: "One".into(),
                pinned: true,
                used_at: 123,
                caption: Some("Keep me".into()),
            },
        )
        .unwrap();
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(b"\x89PNG\r\n\x1a\nnew")
        );
        let thumb = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(b"\xff\xd8\xfffixture")
        );
        conn.execute_batch("CREATE TRIGGER block_replace BEFORE UPDATE OF id ON image_library BEGIN SELECT RAISE(ABORT,'busy'); END;").unwrap();
        assert!(execute(
            &conn,
            &dir,
            Request::Replace {
                id: a.clone(),
                data: data.clone(),
                thumbnail: thumb.clone()
            }
        )
        .is_err());
        assert!(dir.join(&a).is_file());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        conn.execute_batch("DROP TRIGGER block_replace").unwrap();
        let result = execute(
            &conn,
            &dir,
            Request::Replace {
                id: a.clone(),
                data: data.clone(),
                thumbnail: thumb,
            },
        )
        .unwrap();
        let next = result["id"].as_str().unwrap();
        assert_ne!(next, a);
        assert!(!dir.join(a).exists());
        assert_eq!(
            execute(&conn, &dir, Request::Read { id: next.into() }).unwrap(),
            data
        );
        let row = execute(&conn, &dir, Request::List).unwrap();
        assert_eq!(row[0]["caption"], "Keep me");
        assert_eq!(row[0]["pinned"], true);
        assert_eq!(row[0]["usedAt"], 123);
        assert_eq!(row[0]["category"], "One");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn deleting_categories_preserves_images_captions_and_rolls_back_on_failure() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.db");
        let conn = Connection::open(&db).unwrap();
        let name = "ce a' 🎉";
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")
        );
        let thumb = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(b"\xff\xd8\xfffixture")
        );
        let imported = execute(
            &conn,
            &dir,
            Request::Import {
                title: "Photo".into(),
                category: name.into(),
                data: data.clone(),
                thumbnail: thumb,
            },
        )
        .unwrap();
        let id = imported["id"].as_str().unwrap();
        execute(
            &conn,
            &dir,
            Request::Edit {
                id: id.into(),
                title: "Photo".into(),
                category: name.into(),
                pinned: true,
                used_at: 10,
                caption: Some("Réunion ce soir !".into()),
            },
        )
        .unwrap();
        execute(
            &conn,
            &dir,
            Request::CreateCategory {
                name: "Empty".into(),
            },
        )
        .unwrap();
        execute(
            &conn,
            &dir,
            Request::CreateCategory {
                name: "Other".into(),
            },
        )
        .unwrap();
        let before = execute(&conn, &dir, Request::List).unwrap();
        for invalid in ["", " ", "*", &"x".repeat(61)] {
            assert!(execute(
                &conn,
                &dir,
                Request::DeleteCategory {
                    name: invalid.into()
                }
            )
            .is_err());
        }
        conn.execute_batch("CREATE TRIGGER block_category_delete BEFORE DELETE ON image_library_categories BEGIN SELECT RAISE(ABORT,'busy'); END;").unwrap();
        assert!(execute(&conn, &dir, Request::DeleteCategory { name: name.into() }).is_err());
        assert_eq!(execute(&conn, &dir, Request::List).unwrap(), before);
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            3
        );
        conn.execute_batch("DROP TRIGGER block_category_delete")
            .unwrap();
        for category in [name, "Empty"] {
            execute(
                &conn,
                &dir,
                Request::DeleteCategory {
                    name: format!(" {category} "),
                },
            )
            .unwrap();
        }
        let mut expected = before;
        expected[0]["category"] = json!("");
        assert_eq!(execute(&conn, &dir, Request::List).unwrap(), expected);
        assert_eq!(
            execute(&conn, &dir, Request::Read { id: id.into() }).unwrap(),
            data
        );
        drop(conn);
        let conn = Connection::open(&db).unwrap();
        assert_eq!(execute(&conn, &dir, Request::List).unwrap(), expected);
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["Other"])
        );
        assert_eq!(
            execute(&conn, &dir, Request::Read { id: id.into() }).unwrap(),
            data
        );
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn captions_migrate_persist_clear_and_survive_legacy_metadata_edits() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE image_library(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,thumbnail TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,used_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)").unwrap();
        let id = "a".repeat(64);
        conn.execute(
            "INSERT INTO image_library VALUES (?1,'Photo','Test','image/png',20,'thumbnail',0,0,1)",
            [&id],
        )
        .unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::List).unwrap()[0]["caption"],
            ""
        );
        let edit = |caption: Option<String>| Request::Edit {
            id: id.clone(),
            title: "Photo".into(),
            category: "Test".into(),
            pinned: true,
            used_at: 10,
            caption,
        };
        let caption = "On commence déjà la réunion ? 🎉\nRejoins-nous !";
        execute(&conn, &dir, edit(Some(caption.into()))).unwrap();
        drop(conn);
        let conn = Connection::open(&db).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::List).unwrap()[0]["caption"],
            caption
        );
        // Old clients omit caption when updating pins or last-used time.
        let legacy = serde_json::from_value(json!({"action":"edit","id":id,"title":"Photo","category":"Test","pinned":false,"used_at":20})).unwrap();
        execute(&conn, &dir, legacy).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::List).unwrap()[0]["caption"],
            caption
        );
        assert!(execute(&conn, &dir, edit(Some("🎉".repeat(1001)))).is_err());
        assert_eq!(
            execute(&conn, &dir, Request::List).unwrap()[0]["caption"],
            caption
        );
        execute(&conn, &dir, edit(Some("🎉".repeat(1000)))).unwrap();
        execute(&conn, &dir, edit(Some(String::new()))).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::List).unwrap()[0]["caption"],
            ""
        );
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn custom_categories_exist_without_images_and_survive_reopening() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.db");
        let conn = Connection::open(&db).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!([])
        );
        for _ in 0..2 {
            execute(
                &conn,
                &dir,
                Request::CreateCategory {
                    name: "  我的活动  ".into(),
                },
            )
            .unwrap();
        }
        assert!(execute(&conn, &dir, Request::CreateCategory { name: " ".into() }).is_err());
        assert!(execute(&conn, &dir, Request::CreateCategory { name: "*".into() }).is_err());
        assert!(execute(
            &conn,
            &dir,
            Request::CreateCategory {
                name: "x".repeat(61)
            }
        )
        .is_err());
        assert_eq!(execute(&conn, &dir, Request::List).unwrap(), json!([]));
        drop(conn);
        let conn = Connection::open(&db).unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["我的活动"])
        );
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stores_deduplicated_files_without_inline_originals_and_validates_reads() {
        let conn = Connection::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")
        );
        let thumb = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(b"\xff\xd8\xfffixture")
        );
        let import = || Request::Import {
            title: "Photo".into(),
            category: "Test".into(),
            data: data.clone(),
            thumbnail: thumb.clone(),
        };
        let added = execute(&conn, &dir, import()).unwrap();
        let id = added["id"].as_str().unwrap();
        assert_eq!(execute(&conn, &dir, import()).unwrap()["added"], false);
        assert_eq!(
            execute(&conn, &dir, Request::Read { id: id.into() }).unwrap(),
            data
        );
        assert_eq!(
            execute(&conn, &dir, Request::List)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        conn.execute("DROP TABLE image_library_categories", [])
            .unwrap();
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["Test"])
        );
        assert!(execute(
            &conn,
            &dir,
            Request::Read {
                id: "../outside".into()
            }
        )
        .is_err());
        assert!(decode("data:image/svg+xml;base64,PHN2Zz4=", MAX_IMAGE).is_err());
        std::fs::write(dir.join(id), b"broken").unwrap();
        assert!(execute(&conn, &dir, Request::Read { id: id.into() }).is_err());
        assert_eq!(execute(&conn, &dir, import()).unwrap()["added"], false);
        assert_eq!(
            execute(&conn, &dir, Request::Read { id: id.into() }).unwrap(),
            data
        );
        execute(
            &conn,
            &dir,
            Request::Delete {
                ids: vec![id.into()],
            },
        )
        .unwrap();
        assert!(execute(&conn, &dir, Request::List)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            execute(&conn, &dir, Request::ListCategories).unwrap(),
            json!(["Test"])
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
