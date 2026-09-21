//! SQLite 持久化 — 专业桌面 CRM 数据层
//! 表：phones / contacts / chats / messages / follow_ups / activities / settings

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub phones: Vec<Value>,
    pub contacts: Vec<Value>,
    pub chats: Vec<Value>,
    pub messages: Vec<Value>,
    #[serde(default, alias = "follow_ups")]
    pub follow_ups: Vec<Value>,
    #[serde(default)]
    pub activities: Vec<Value>,
    #[serde(default)]
    pub settings: Value,
    /// 克制群发战役（前端 PersistSlice.broadcastCampaigns）
    #[serde(default, alias = "broadcast_campaigns")]
    pub broadcast_campaigns: Vec<Value>,
    /// 前端 persistDirty：未列出的表跳过 upsert（省大库保存）
    #[serde(default)]
    pub dirty: Option<PersistDirtyFlags>,
    /** 增量保存时明确删除的消息 id。 */
    #[serde(default)]
    pub deleted_message_ids: Vec<String>,
    /** 完整备份恢复：消息表以本快照为准。 */
    #[serde(default)]
    pub replace_messages: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistDirtyFlags {
    #[serde(default)]
    pub phones: bool,
    #[serde(default)]
    pub contacts: bool,
    #[serde(default)]
    pub chats: bool,
    #[serde(default)]
    pub messages: bool,
    #[serde(default)]
    pub follow_ups: bool,
    #[serde(default)]
    pub activities: bool,
    #[serde(default)]
    pub settings: bool,
    #[serde(default)]
    pub broadcast_campaigns: bool,
}

impl PersistDirtyFlags {
    fn all_true() -> Self {
        Self {
            phones: true,
            contacts: true,
            chats: true,
            messages: true,
            follow_ups: true,
            activities: true,
            settings: true,
            broadcast_campaigns: true,
        }
    }
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir.join("wap-plus.db"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("open db {}: {e}", path.display()))?;
    // WAL + 合理缓存，降低 bridge/UI 并发写时的卡顿与 SQLITE_BUSY
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 20000;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -64000;
        "#,
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    tracing::info!(path = %path.display(), "sqlite ready");
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS phones (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            chat_id TEXT,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS follow_ups (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY NOT NULL,
            contact_id TEXT,
            at_ts TEXT,
            json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
        CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
        "#,
    )
    .map_err(|e| e.to_string())?;

    // —— schema 演进（用 meta.schema_version 门闩，避免每次启动全表 UPDATE）——
    let schema_version: i64 = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |r| {
                let s: String = r.get(0)?;
                Ok(s.parse::<i64>().unwrap_or(0))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    // v2: messages.sent_at
    let has_sent_at = table_has_column(conn, "messages", "sent_at")?;
    if !has_sent_at {
        conn.execute("ALTER TABLE messages ADD COLUMN sent_at TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_messages_chat_sent ON messages(chat_id, sent_at);",
    )
    .map_err(|e| e.to_string())?;

    // v3: content_hash（保存时只比 hash，不加载全表 json）+ 全局 sent_at 索引
    let has_hash = table_has_column(conn, "messages", "content_hash")?;
    if !has_hash {
        conn.execute("ALTER TABLE messages ADD COLUMN content_hash TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_messages_sent_global ON messages(sent_at DESC, id DESC);",
    )
    .map_err(|e| e.to_string())?;

    // 仅在版本升级时做一次 sent_at / hash 回填（禁止每次 open 全表 json_extract）
    if schema_version < 3 {
        conn.execute_batch(
            r#"
            UPDATE messages
              SET sent_at = COALESCE(json_extract(json, '$.sentAt'), '')
              WHERE sent_at IS NULL OR sent_at = '';
            "#,
        )
        .map_err(|e| e.to_string())?;
        tracing::info!(from = schema_version, "sqlite migrate → v3 (sent_at backfill once)");
    }

    // v4: FTS5 全文检索（若编译的 SQLite 无 FTS5 则跳过，搜索走旧 LIKE）
    if schema_version < 4 {
        let fts_ok = conn
            .execute_batch(
                r#"
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                  id UNINDEXED,
                  body,
                  caption,
                  filename,
                  tokenize = 'unicode61'
                );
                "#,
            )
            .is_ok();
        if fts_ok {
            // 一次性从现有 messages 重建（可能较慢，但只升级时跑一次）
            let _ = conn.execute_batch(
                r#"
                DELETE FROM messages_fts;
                INSERT INTO messages_fts(id, body, caption, filename)
                SELECT
                  id,
                  coalesce(json_extract(json, '$.body'), ''),
                  coalesce(json_extract(json, '$.mediaCaption'), ''),
                  coalesce(json_extract(json, '$.mediaFileName'), '')
                FROM messages;
                "#,
            );
            tracing::info!("sqlite migrate → v4 (messages_fts built)");
        } else {
            tracing::warn!("sqlite FTS5 unavailable; search keeps LIKE fallback");
        }
    }

    // v5: inline Base64 只是一层可重建缓存，不应跟随 CRM 主快照跨 IPC / 全表加载。
    if schema_version < 5 {
        let contacts_cleaned = conn
            .execute(
                r#"
                UPDATE contacts
                SET json = json_remove(json, '$.avatarFullUrl')
                WHERE json_type(json, '$.avatarFullUrl') = 'text'
                  AND json_extract(json, '$.avatarFullUrl') LIKE 'data:%'
                "#,
                [],
            )
            .map_err(|e| e.to_string())?;
        let mut messages_cleaned = 0usize;
        for (field, require_large) in [
            ("mediaUrl", true),
            ("mediaThumbUrl", true),
            ("senderAvatarUrl", false),
        ] {
            let large = if require_large {
                format!(" AND length(json_extract(json, '$.{field}')) > 8000")
            } else {
                String::new()
            };
            messages_cleaned += conn
                .execute(
                    &format!(
                        "UPDATE messages
                         SET json = json_remove(json, '$.{field}'), content_hash = NULL
                         WHERE json_type(json, '$.{field}') = 'text'
                           AND json_extract(json, '$.{field}') LIKE 'data:%'{large}"
                    ),
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        tracing::info!(
            contacts_cleaned,
            messages_cleaned,
            "sqlite migrate -> v5 (inline media stripped)"
        );
    }

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '5')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, col: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        if name == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn content_hash(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// 同步某表：SQLite 侧 WHERE json IS NOT excluded.json 跳过未变行，
/// **不再**把全表 json 读进 Rust HashMap（大库保存主路径优化）。
fn upsert_json_table(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    rows: &[(String, String)],
) -> Result<(usize, usize, usize), String> {
    let keep = format!("_keep_{table}");
    tx.execute_batch(&format!(
        "CREATE TEMP TABLE IF NOT EXISTS {keep}(id TEXT PRIMARY KEY NOT NULL); DELETE FROM {keep};"
    ))
    .map_err(|e| e.to_string())?;

    let insert_keep = format!("INSERT OR IGNORE INTO {keep}(id) VALUES (?1)");
    // ON CONFLICT DO UPDATE … WHERE 不同才写，避免无意义刷盘
    let upsert = format!(
        "INSERT INTO {table}(id, json) VALUES (?1, ?2)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json
         WHERE {table}.json IS NOT excluded.json"
    );
    let mut written = 0usize;
    let mut skipped = 0usize;
    for (id, json) in rows {
        tx.execute(&insert_keep, params![id])
            .map_err(|e| e.to_string())?;
        let n = tx
            .execute(&upsert, params![id, json])
            .map_err(|e| e.to_string())?;
        if n > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    let deleted = tx
        .execute(
            &format!("DELETE FROM {table} WHERE id NOT IN (SELECT id FROM {keep})"),
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok((written, skipped, deleted))
}

fn fts_available(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts' LIMIT 1",
        [],
        |_| Ok(1i32),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

/// 查询串是否包含 CJK 字符（中日韩）。FTS5 默认分词对 CJK 子串搜索无效，
/// 这类查询需要保留 LIKE 回退路径。
fn query_has_cjk(s: &str) -> bool {
    s.chars().any(|c| {
        matches!(c as u32,
            0x3400..=0x4DBF   // CJK 扩展 A
            | 0x4E00..=0x9FFF // CJK 基本区
            | 0x3040..=0x30FF // 平假名/片假名
            | 0xAC00..=0xD7AF // 谚文
            | 0xF900..=0xFAFF // CJK 兼容表意
        )
    })
}

fn upsert_message_fts(
    tx: &rusqlite::Transaction<'_>,
    id: &str,
    body: &str,
    caption: &str,
    filename: &str,
) {
    if !fts_available(tx) {
        return;
    }
    let _ = tx.execute("DELETE FROM messages_fts WHERE id = ?1", params![id]);
    let _ = tx.execute(
        "INSERT INTO messages_fts(id, body, caption, filename) VALUES (?1, ?2, ?3, ?4)",
        params![id, body, caption, filename],
    );
}

fn id_of(v: &Value) -> Option<String> {
    v.get("id")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

pub fn save_snapshot(conn: &Connection, snap: &AppSnapshot) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut total_written = 0usize;
    let mut total_skipped = 0usize;
    let mut total_deleted = 0usize;
    // dirty=None → 全量（兼容旧前端 / force 保存）
    let dirty = snap.dirty.clone().unwrap_or_else(PersistDirtyFlags::all_true);

    // phones / contacts / chats / follow_ups：仅写变更 + 删缺失
    if dirty.phones {
    let mut phone_rows = Vec::with_capacity(snap.phones.len());
    for p in &snap.phones {
        let id = id_of(p).ok_or("phone missing id")?;
        let j = serde_json::to_string(p).map_err(|e| e.to_string())?;
        phone_rows.push((id, j));
    }
    let (w, s, d) = upsert_json_table(&tx, "phones", &phone_rows)?;
    total_written += w;
    total_skipped += s;
    total_deleted += d;
    }

    if dirty.contacts {
    let mut contact_rows = Vec::with_capacity(snap.contacts.len());
    for c in &snap.contacts {
        let id = id_of(c).ok_or("contact missing id")?;
        let j = serde_json::to_string(c).map_err(|e| e.to_string())?;
        contact_rows.push((id, j));
    }
    let (w, s, d) = upsert_json_table(&tx, "contacts", &contact_rows)?;
    total_written += w;
    total_skipped += s;
    total_deleted += d;
    }

    if dirty.chats {
    let mut chat_rows = Vec::with_capacity(snap.chats.len());
    for c in &snap.chats {
        let id = id_of(c).ok_or("chat missing id")?;
        let j = serde_json::to_string(c).map_err(|e| e.to_string())?;
        chat_rows.push((id, j));
    }
    let (w, s, d) = upsert_json_table(&tx, "chats", &chat_rows)?;
    total_written += w;
    total_skipped += s;
    total_deleted += d;
    }

    // messages：内存可能只有「最近 N 条」，绝不能 DELETE 快照外 id。
    // 用 content_hash 在 SQL 侧判断未变，禁止全表 SELECT json。
    if dirty.messages {
    for m in &snap.messages {
        let id = id_of(m).ok_or("message missing id")?;
        let chat_id = m
            .get("chatId")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let sent_at = m.get("sentAt").and_then(|x| x.as_str()).unwrap_or("");
        let j = serde_json::to_string(m).map_err(|e| e.to_string())?;
        let hash = content_hash(&j);
        let n = tx
            .execute(
                r#"
                INSERT INTO messages(id, chat_id, sent_at, json, content_hash)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(id) DO UPDATE SET
                  chat_id = excluded.chat_id,
                  sent_at = excluded.sent_at,
                  json = excluded.json,
                  content_hash = excluded.content_hash
                WHERE messages.content_hash IS NOT excluded.content_hash
                   OR messages.content_hash IS NULL
                   OR messages.chat_id IS NOT excluded.chat_id
                   OR messages.sent_at IS NOT excluded.sent_at
                "#,
                params![id, chat_id, sent_at, j, hash],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            total_written += 1;
            let body = m.get("body").and_then(|x| x.as_str()).unwrap_or("");
            let caption = m
                .get("mediaCaption")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let filename = m
                .get("mediaFileName")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            upsert_message_fts(&tx, &id, body, caption, filename);
        } else {
            total_skipped += 1;
        }
    }
    for id in &snap.deleted_message_ids {
        total_deleted += tx
            .execute("DELETE FROM messages WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if fts_available(&tx) {
            let _ = tx.execute("DELETE FROM messages_fts WHERE id = ?1", params![id]);
        }
    }
    if snap.replace_messages {
        tx.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS _keep_messages(id TEXT PRIMARY KEY NOT NULL); DELETE FROM _keep_messages;",
        )
        .map_err(|e| e.to_string())?;
        for message in &snap.messages {
            if let Some(id) = id_of(message) {
                tx.execute(
                    "INSERT OR IGNORE INTO _keep_messages(id) VALUES (?1)",
                    params![id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        total_deleted += tx
            .execute(
                "DELETE FROM messages WHERE id NOT IN (SELECT id FROM _keep_messages)",
                [],
            )
            .map_err(|e| e.to_string())?;
        if fts_available(&tx) {
            let _ = tx.execute(
                "DELETE FROM messages_fts WHERE id NOT IN (SELECT id FROM messages)",
                [],
            );
        }
    }
    // 已删除的会话：清掉其磁盘消息（chats 表已按快照同步）
    // 仅当 chats 也在本轮写入时做，避免 dirty.messages-only 误删
    if dirty.chats {
        total_deleted += tx
            .execute(
                "DELETE FROM messages WHERE chat_id IS NOT NULL AND chat_id != '' AND chat_id NOT IN (SELECT id FROM chats)",
                [],
            )
            .map_err(|e| e.to_string())?;
        if fts_available(&tx) {
            let _ = tx.execute(
                "DELETE FROM messages_fts WHERE id NOT IN (SELECT id FROM messages)",
                [],
            );
        }
    }
    } // end dirty.messages

    if dirty.follow_ups {
    let mut fu_rows = Vec::with_capacity(snap.follow_ups.len());
    for f in &snap.follow_ups {
        let id = id_of(f).ok_or("follow_up missing id")?;
        let j = serde_json::to_string(f).map_err(|e| e.to_string())?;
        fu_rows.push((id, j));
    }
    let (w, s, d) = upsert_json_table(&tx, "follow_ups", &fu_rows)?;
    total_written += w;
    total_skipped += s;
    total_deleted += d;
    }

    // activities：与 contacts 相同，SQL 侧跳过未变 json
    if dirty.activities {
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS _keep_activities(id TEXT PRIMARY KEY NOT NULL); DELETE FROM _keep_activities;",
    )
    .map_err(|e| e.to_string())?;
    for a in &snap.activities {
        let id = id_of(a).ok_or("activity missing id")?;
        let contact_id = a
            .get("contactId")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let at_ts = a.get("at").and_then(|x| x.as_str()).unwrap_or("");
        let j = serde_json::to_string(a).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO _keep_activities(id) VALUES (?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        let n = tx
            .execute(
                r#"
                INSERT INTO activities(id, contact_id, at_ts, json)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(id) DO UPDATE SET
                  contact_id = excluded.contact_id,
                  at_ts = excluded.at_ts,
                  json = excluded.json
                WHERE activities.json IS NOT excluded.json
                "#,
                params![id, contact_id, at_ts, j],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            total_written += 1;
        } else {
            total_skipped += 1;
        }
    }
    total_deleted += tx
        .execute(
            "DELETE FROM activities WHERE id NOT IN (SELECT id FROM _keep_activities)",
            [],
        )
        .map_err(|e| e.to_string())?;
    } // end dirty.activities

    // settings / broadcastCampaigns
    if dirty.settings || dirty.broadcast_campaigns {
    // settings：仅当战役自身标记为脏时才用顶层 broadcast_campaigns 覆盖
    // __broadcastCampaigns。否则（如只改一个设置项的防抖保存）保留前端
    // 嵌入在 settings 里的现有战役——delta 保存的顶层空数组不得清库。
    let mut settings_value = snap.settings.clone();
    if let Some(obj) = settings_value.as_object_mut() {
        if dirty.broadcast_campaigns {
            obj.insert(
                "__broadcastCampaigns".into(),
                Value::Array(snap.broadcast_campaigns.clone()),
            );
        }
    }
    let settings_json = serde_json::to_string(&settings_value).map_err(|e| e.to_string())?;
    let prev_settings: Option<String> = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'app'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if prev_settings.as_deref() != Some(settings_json.as_str()) {
        tx.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('app', ?1)",
            params![settings_json],
        )
        .map_err(|e| e.to_string())?;
        total_written += 1;
    } else {
        total_skipped += 1;
    }
    } // end dirty.settings

    // 仅有真实写入时才戳 last_saved_at，便于观察「空转保存」
    if total_written > 0 || total_deleted > 0 {
        tx.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES ('last_saved_at', ?1)",
            params![chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    tracing::debug!(
        written = total_written,
        skipped = total_skipped,
        deleted = total_deleted,
        "db save_snapshot delta"
    );
    Ok(())
}

/// 冷历史：按会话倒序分页（sent_at DESC, id DESC）。before_sent_at 为空 = 取最新一页。
pub fn load_messages_page(
    conn: &Connection,
    chat_id: &str,
    before_sent_at: Option<&str>,
    before_id: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, String> {
    let lim = limit.clamp(1, 500);
    let mut out = Vec::new();
    if let (Some(bs), Some(bid)) = (before_sent_at, before_id) {
        if !bs.is_empty() && !bid.is_empty() {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT json FROM messages
                    WHERE chat_id = ?1
                      AND (
                        sent_at < ?2
                        OR (sent_at = ?2 AND id < ?3)
                      )
                    ORDER BY sent_at DESC, id DESC
                    LIMIT ?4
                    "#,
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![chat_id, bs, bid, lim], |row| {
                    let j: String = row.get(0)?;
                    Ok(j)
                })
                .map_err(|e| e.to_string())?;
            for r in rows {
                let j = r.map_err(|e| e.to_string())?;
                out.push(serde_json::from_str(&j).map_err(|e| e.to_string())?);
            }
            out.reverse();
            return Ok(out);
        }
    }
    let mut stmt = conn
        .prepare(
            r#"
            SELECT json FROM messages
            WHERE chat_id = ?1
            ORDER BY sent_at DESC, id DESC
            LIMIT ?2
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chat_id, lim], |row| {
            let j: String = row.get(0)?;
            Ok(j)
        })
        .map_err(|e| e.to_string())?;
    for r in rows {
        let j = r.map_err(|e| e.to_string())?;
        out.push(serde_json::from_str(&j).map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

pub fn count_messages_for_chat(conn: &Connection, chat_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE chat_id = ?1",
        params![chat_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 全局消息搜索（磁盘冷历史 + 已落盘近期）。pattern 为小写子串。
pub fn search_messages(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<Value>, String> {
    let q_raw = query.trim();
    if q_raw.is_empty() || q_raw.chars().count() < 2 {
        return Ok(vec![]);
    }
    let lim = limit.clamp(1, 80);

    // 优先 FTS5（大库）；不可用则 LIKE 回退
    if fts_available(conn) {
        // FTS5 查询：转义 " 并包一层短语/前缀宽松匹配
        let safe = q_raw.replace('"', "\"\"");
        let match_q = format!("\"{}\"", safe);
        if let Ok(mut stmt) = conn.prepare(
            r#"
            SELECT m.json FROM messages_fts f
            JOIN messages m ON m.id = f.id
            WHERE messages_fts MATCH ?1
            ORDER BY COALESCE(m.sent_at, '') DESC, m.id DESC
            LIMIT ?2
            "#,
        ) {
            if let Ok(rows) = stmt.query_map(params![match_q, lim], |row| {
                let j: String = row.get(0)?;
                Ok(j)
            }) {
                let mut out = Vec::new();
                let mut ok = true;
                for r in rows {
                    match r {
                        Ok(j) => match serde_json::from_str(&j) {
                            Ok(v) => out.push(v),
                            Err(_) => {
                                ok = false;
                                break;
                            }
                        },
                        Err(_) => {
                            ok = false;
                            break;
                        }
                    }
                }
                if ok && (!out.is_empty() || !query_has_cjk(q_raw)) {
                    // 命中即返回；但 CJK 查询零命中时不能把「空」当答案——
                    // FTS5 默认 unicode61 分词会把整段中文并成一个 token，
                    // 短语查询基本必落空。此时必须回退 LIKE 子串匹配。
                    // 非 CJK 查询保持原快速路径。
                    return Ok(out);
                }
            }
        }
        // FTS 失败则落回 LIKE
    }

    let q = q_raw.to_lowercase();
    let like = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut stmt = conn
        .prepare(
            r#"
            SELECT json FROM messages
            WHERE
              lower(coalesce(json_extract(json, '$.body'), '')) LIKE ?1 ESCAPE '\'
              OR lower(coalesce(json_extract(json, '$.mediaCaption'), '')) LIKE ?1 ESCAPE '\'
              OR lower(coalesce(json_extract(json, '$.mediaFileName'), '')) LIKE ?1 ESCAPE '\'
            ORDER BY coalesce(sent_at, '') DESC, id DESC
            LIMIT ?2
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![like, lim], |row| {
            let j: String = row.get(0)?;
            Ok(j)
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let j = r.map_err(|e| e.to_string())?;
        out.push(serde_json::from_str(&j).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_message_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    if id.trim().is_empty() {
        return Ok(None);
    }
    let row: Option<String> = conn
        .query_row(
            "SELECT json FROM messages WHERE id = ?1 LIMIT 1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match row {
        Some(j) => Ok(Some(
            serde_json::from_str(&j).map_err(|e| e.to_string())?,
        )),
        None => Ok(None),
    }
}

fn load_table(conn: &Connection, table: &str) -> Result<Vec<Value>, String> {
    let sql = format!("SELECT json FROM {table}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let j: String = row.get(0)?;
            Ok(j)
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let j = r.map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_str(&j).map_err(|e| e.to_string())?;
        out.push(v);
    }
    Ok(out)
}

fn load_chats_with_history(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut chats = load_table(conn, "chats")?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT chat_id FROM messages
            WHERE COALESCE(chat_id, '') != ''
              AND json_extract(json, '$.direction') = 'out'
              AND COALESCE(json_extract(json, '$.mediaType'), '') != 'system'
              AND COALESCE(json_extract(json, '$.deliveryStatus'), 'sent')
                  NOT IN ('pending', 'queued', 'failed')
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut outgoing_chat_ids = HashSet::new();
    for row in rows {
        outgoing_chat_ids.insert(row.map_err(|e| e.to_string())?);
    }
    for chat in &mut chats {
        let Some(object) = chat.as_object_mut() else {
            continue;
        };
        let has_outgoing = object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| outgoing_chat_ids.contains(id));
        if has_outgoing {
            object.insert("hasOutgoingHistory".into(), Value::Bool(true));
        }
    }
    Ok(chats)
}

/// 最近历史 + 未完成出站/定时任务引用的消息；普通冷历史仍按需分页。
const BOOT_MESSAGES_CAP: i64 = 2_000;
const BOOT_ACTIVITIES_CAP: i64 = 2_000;

fn load_messages_boot(conn: &Connection) -> Result<Vec<Value>, String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
        .unwrap_or(0);
    if total <= BOOT_MESSAGES_CAP {
        return load_table(conn, "messages");
    }
    let mut stmt = conn
        .prepare(
            r#"
            SELECT json FROM messages
            WHERE id IN (
                SELECT id FROM messages
                ORDER BY COALESCE(sent_at, '') DESC, id DESC LIMIT ?1
            ) OR (
                json_extract(json, '$.direction') = 'out'
                AND (
                    json_extract(json, '$.deliveryStatus') IN ('queued', 'pending')
                    OR (json_extract(json, '$.deliveryStatus') = 'failed'
                        AND COALESCE(json_extract(json, '$.nextAttemptAt'), '') != '')
                )
            ) OR id IN (
                SELECT json_extract(task.value, '$.messageId')
                FROM settings, json_each(settings.value, '$.scheduledMessages') AS task
                WHERE settings.key = 'app' AND json_extract(task.value, '$.status') = 'queued'
            )
            ORDER BY COALESCE(sent_at, '') DESC, id DESC
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![BOOT_MESSAGES_CAP], |row| {
            let j: String = row.get(0)?;
            Ok(j)
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let j = r.map_err(|e| e.to_string())?;
        out.push(serde_json::from_str(&j).map_err(|e| e.to_string())?);
    }
    // 时间正序，方便前端 hydrate
    out.reverse();
    tracing::info!(total, loaded = out.len(), "boot messages capped");
    Ok(out)
}

fn load_activities_boot(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT json FROM activities ORDER BY COALESCE(at_ts, '') DESC, id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![BOOT_ACTIVITIES_CAP], |row| {
            let j: String = row.get(0)?;
            Ok(j)
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let json = row.map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    })
    .collect()
}

pub fn load_snapshot(conn: &Connection) -> Result<Option<AppSnapshot>, String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM contacts", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count == 0 {
        // empty db
        let settings_row: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if settings_row.is_none() {
            return Ok(None);
        }
    }

    let settings_str: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "{}".into());

    let mut settings: Value =
        serde_json::from_str(&settings_str).unwrap_or(Value::Object(Default::default()));

    // 群发战役：存于 settings.__broadcastCampaigns（前端 toRust 双写），读出到顶层字段
    let broadcast_campaigns = settings
        .as_object_mut()
        .and_then(|m| m.remove("__broadcastCampaigns"))
        .and_then(|v| match v {
            Value::Array(a) => Some(a),
            _ => None,
        })
        .unwrap_or_default();

    Ok(Some(AppSnapshot {
        phones: load_table(conn, "phones")?,
        contacts: load_table(conn, "contacts")?,
        chats: load_chats_with_history(conn)?,
        messages: load_messages_boot(conn)?,
        follow_ups: load_table(conn, "follow_ups")?,
        activities: load_activities_boot(conn)?,
        settings,
        broadcast_campaigns,
        dirty: None,
        deleted_message_ids: Vec::new(),
        replace_messages: false,
    }))
}

pub fn load_full_history(conn: &Connection) -> Result<Value, String> {
    Ok(serde_json::json!({
        "messages": load_table(conn, "messages")?,
        "activities": load_table(conn, "activities")?,
    }))
}

pub fn db_info(conn: &Connection) -> Result<Value, String> {
    let contacts: i64 = conn
        .query_row("SELECT COUNT(*) FROM contacts", [], |r| r.get(0))
        .unwrap_or(0);
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
        .unwrap_or(0);
    let activities: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
        .unwrap_or(0);
    let last: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'last_saved_at'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "engine": "sqlite",
        "contacts": contacts,
        "messages": messages,
        "activities": activities,
        "lastSavedAt": last,
    }))
}

pub fn clear_chat_messages(conn: &Connection, chat_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if fts_available(&tx) {
        tx.execute(
            "DELETE FROM messages_fts WHERE id IN (SELECT id FROM messages WHERE chat_id = ?1)",
            params![chat_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn clear_remote_messages(
    conn: &Connection,
    remote_jid: &str,
    account_id: Option<&str>,
) -> Result<(), String> {
    let account_id = account_id.unwrap_or("");
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if fts_available(&tx) {
        tx.execute(
            "DELETE FROM messages_fts WHERE id IN (
                SELECT id FROM messages
                WHERE (
                    json_extract(json, '$.waKey.remoteJid') = ?1
                    OR json_extract(json, '$.groupJid') = ?1
                ) AND (
                    ?2 = '' OR
                    COALESCE(
                        json_extract(json, '$.accountId'),
                        json_extract(json, '$.deviceId'),
                        ''
                    ) IN ('', ?2)
                )
            )",
            params![remote_jid, account_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "DELETE FROM messages
         WHERE (
             json_extract(json, '$.waKey.remoteJid') = ?1
             OR json_extract(json, '$.groupJid') = ?1
         ) AND (
             ?2 = '' OR
             COALESCE(
                 json_extract(json, '$.accountId'),
                 json_extract(json, '$.deviceId'),
                 ''
             ) IN ('', ?2)
         )",
        params![remote_jid, account_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn delete_messages_by_keys(
    conn: &Connection,
    keys: &[String],
    account_id: Option<&str>,
) -> Result<(), String> {
    let account_id = account_id.unwrap_or("");
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for key in keys.iter().filter(|key| !key.is_empty()) {
        if fts_available(&tx) {
            tx.execute(
                "DELETE FROM messages_fts WHERE id IN (
                    SELECT id FROM messages
                    WHERE (
                        id = ?1
                        OR json_extract(json, '$.waMessageId') = ?1
                        OR json_extract(json, '$.waKey.id') = ?1
                    ) AND (
                        ?2 = '' OR
                        COALESCE(
                            json_extract(json, '$.accountId'),
                            json_extract(json, '$.deviceId'),
                            ''
                        ) IN ('', ?2)
                    )
                )",
                params![key, account_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "DELETE FROM messages
             WHERE (
                 id = ?1
                 OR json_extract(json, '$.waMessageId') = ?1
                 OR json_extract(json, '$.waKey.id') = ?1
             ) AND (
                 ?2 = '' OR
                 COALESCE(
                     json_extract(json, '$.accountId'),
                     json_extract(json, '$.deviceId'),
                     ''
                 ) IN ('', ?2)
             )",
            params![key, account_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn clear_all(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM phones; DELETE FROM contacts; DELETE FROM chats; DELETE FROM messages; DELETE FROM follow_ups; DELETE FROM activities; DELETE FROM settings;",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message_dirty() -> PersistDirtyFlags {
        PersistDirtyFlags {
            messages: true,
            ..Default::default()
        }
    }

    fn message(id: &str, chat_id: &str, remote_jid: &str) -> Value {
        json!({
            "id": id,
            "chatId": chat_id,
            "sentAt": "2026-08-12T10:00:00.000Z",
            "body": id,
            "waKey": { "id": id, "remoteJid": remote_jid, "fromMe": false }
        })
    }

    fn account_message(
        id: &str,
        protocol_id: &str,
        account_id: &str,
        remote_jid: &str,
    ) -> Value {
        json!({
            "id": id,
            "chatId": format!("chat-{account_id}"),
            "accountId": account_id,
            "sentAt": "2026-08-12T10:00:00.000Z",
            "body": id,
            "waKey": {
                "id": protocol_id,
                "remoteJid": remote_jid,
                "fromMe": false
            }
        })
    }

    #[test]
    fn boot_keeps_old_outbox_and_scheduled_references_beyond_history_cap() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let mut messages: Vec<Value> = (0..2005)
            .map(|i| message(&format!("recent-{i:04}"), "chat", "peer"))
            .collect();
        for (id, status, retry) in [
            ("old-queued", "queued", ""),
            ("old-pending", "pending", ""),
            ("old-retry", "failed", "2020-01-01"),
            ("old-hard-failure", "failed", ""),
            ("old-task-result", "sent", ""),
            ("old-history", "sent", ""),
        ] {
            messages.push(json!({"id":id, "chatId":"chat", "body":"hello",
                "direction":"out", "sentAt":"2020-01-01", "deliveryStatus":status,
                "nextAttemptAt":retry}));
        }
        save_snapshot(&conn, &AppSnapshot {
            messages,
            dirty: Some(message_dirty()),
            ..Default::default()
        }).unwrap();
        conn.execute("INSERT INTO settings(key, value) VALUES ('app', ?1)", params![
            json!({"scheduledMessages":[{"status":"queued", "messageId":"old-task-result"}]}).to_string()
        ]).unwrap();
        let loaded = load_messages_boot(&conn).unwrap();
        assert_eq!(loaded.len(), 2004);
        for id in ["old-queued", "old-pending", "old-retry", "old-task-result"] {
            assert!(loaded.iter().any(|message| message["id"] == id), "missing {id}");
        }
        for id in ["old-hard-failure", "old-history", "recent-0000"] {
            assert!(!loaded.iter().any(|message| message["id"] == id), "unexpected {id}");
        }
    }

    #[test]
    fn message_delta_deletes_rows_and_replace_removes_old_history() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let first = AppSnapshot {
            messages: vec![
                message("m1", "chat-1", "111@s.whatsapp.net"),
                message("m2", "chat-2", "222@s.whatsapp.net"),
            ],
            dirty: Some(message_dirty()),
            ..Default::default()
        };
        save_snapshot(&conn, &first).unwrap();

        let delta = AppSnapshot {
            deleted_message_ids: vec!["m1".into()],
            dirty: Some(message_dirty()),
            ..Default::default()
        };
        save_snapshot(&conn, &delta).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );

        let replacement = AppSnapshot {
            messages: vec![message("m3", "chat-3", "333@s.whatsapp.net")],
            replace_messages: true,
            dirty: Some(message_dirty()),
            ..Default::default()
        };
        save_snapshot(&conn, &replacement).unwrap();
        let ids: Vec<String> = conn
            .prepare("SELECT id FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec!["m3"]);
    }

    #[test]
    fn remote_clear_removes_cold_history_by_jid() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        save_snapshot(
            &conn,
            &AppSnapshot {
                messages: vec![
                    message("m1", "chat-1", "111@s.whatsapp.net"),
                    message("m2", "chat-1", "111@s.whatsapp.net"),
                    message("m3", "chat-2", "222@s.whatsapp.net"),
                ],
                dirty: Some(message_dirty()),
                ..Default::default()
            },
        )
        .unwrap();

        clear_remote_messages(&conn, "111@s.whatsapp.net", None).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn protocol_message_key_deletes_cold_history() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        save_snapshot(
            &conn,
            &AppSnapshot {
                messages: vec![message("local-id", "chat-1", "111@s.whatsapp.net")],
                dirty: Some(message_dirty()),
                ..Default::default()
            },
        )
        .unwrap();

        delete_messages_by_keys(&conn, &["local-id".into()], None).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn remote_deletes_are_isolated_by_account() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        save_snapshot(
            &conn,
            &AppSnapshot {
                messages: vec![
                    account_message("a-1", "shared-key", "account-a", "111@s.whatsapp.net"),
                    account_message("b-1", "shared-key", "account-b", "111@s.whatsapp.net"),
                ],
                dirty: Some(message_dirty()),
                ..Default::default()
            },
        )
        .unwrap();

        delete_messages_by_keys(
            &conn,
            &["shared-key".into()],
            Some("account-a"),
        )
        .unwrap();
        let remaining: String = conn
            .query_row("SELECT id FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, "b-1");

        clear_remote_messages(
            &conn,
            "111@s.whatsapp.net",
            Some("account-b"),
        )
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn settings_contacts_and_chats_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let snapshot = AppSnapshot {
            contacts: vec![json!({
                "id": "contact-1",
                "name": "Alice",
                "phone": "+33123456789"
            })],
            chats: vec![json!({
                "id": "chat-contact-1",
                "contactId": "contact-1",
                "contactName": "Alice",
                "lastMessage": "Bonjour"
            })],
            messages: vec![json!({
                "id": "message-1",
                "chatId": "chat-contact-1",
                "direction": "out",
                "body": "Bonjour",
                "sentAt": "2026-09-21T10:00:00.000Z",
                "deliveryStatus": "sent"
            })],
            settings: json!({
                "chatFolders": [{
                    "id": "folder-1",
                    "name": "客户",
                    "chatIds": ["chat-contact-1"],
                    "scope": { "type": "all" }
                }]
            }),
            dirty: Some(PersistDirtyFlags {
                contacts: true,
                chats: true,
                messages: true,
                settings: true,
                ..Default::default()
            }),
            ..Default::default()
        };

        save_snapshot(&conn, &snapshot).unwrap();
        let loaded = load_snapshot(&conn).unwrap().unwrap();

        assert_eq!(loaded.contacts[0]["name"], "Alice");
        assert_eq!(loaded.chats[0]["contactId"], "contact-1");
        assert_eq!(loaded.chats[0]["hasOutgoingHistory"], true);
        assert_eq!(loaded.settings["chatFolders"][0]["id"], "folder-1");
        assert_eq!(loaded.settings["chatFolders"][0]["chatIds"][0], "chat-contact-1");
    }
}
