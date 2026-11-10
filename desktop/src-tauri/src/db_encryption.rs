#[cfg(windows)]
use ring::rand::SecureRandom;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};

const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
const KEY_FILE: &str = "db-key.dpapi";
const TEMP_FILE: &str = "wap-plus.db.encrypted.tmp";
const BACKUP_PREFIX: &str = "wap-plus.db.plaintext-";

#[cfg(windows)]
pub fn open(path: &Path) -> Result<Connection, String> {
    let key_path = path.with_file_name(KEY_FILE);
    let backups = migration_backups(path)?;
    if !path.exists() {
        if let Some(backup) = newest(backups) {
            std::fs::rename(backup, path).map_err(|e| format!("恢复数据库迁移文件失败: {e}"))?;
        }
    }

    let key = match std::fs::read(&key_path) {
        Ok(bytes) => crate::commands::unprotect_secrets(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if path.exists() && !is_plaintext_database(path)? {
                return Err(
                    "数据库已加密，但找不到 DPAPI 密钥；为保护数据不会创建新数据库。".into(),
                );
            }
            let mut key = [0u8; 32];
            ring::rand::SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "无法生成数据库加密密钥".to_owned())?;
            let protected = crate::commands::protect_secrets(&key)?;
            crate::atomic_file::write_atomic(&key_path, &protected)
                .map_err(|e| format!("保存数据库加密密钥失败: {e}"))?;
            key.to_vec()
        }
        Err(error) => return Err(format!("读取数据库加密密钥失败: {error}")),
    };
    if key.len() != 32 {
        return Err("数据库加密密钥格式无效；数据库保持原样。".into());
    }

    let key = hex_key(&key);
    if path.exists() {
        if is_plaintext_database(path)? {
            migrate_plaintext(path, &key)?;
        } else {
            let conn = connect(path, &key, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
            verify_key(&conn)?;
            remove_plaintext_backups(path)?;
            return Ok(conn);
        }
    } else {
        if has_sidecars(path)? {
            return Err(
                "数据库主文件缺失但 SQLite 日志文件仍在；为避免数据丢失，已停止启动。".into(),
            );
        }
        let conn = connect(
            path,
            &key,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        verify_key(&conn)?;
        return Ok(conn);
    }

    let conn = connect(path, &key, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    verify_key(&conn)?;
    Ok(conn)
}

#[cfg(windows)]
pub fn open_readonly(path: &Path) -> Result<Connection, String> {
    let key_path = path.with_file_name(KEY_FILE);
    let protected = std::fs::read(&key_path).map_err(|e| format!("读取数据库加密密钥失败: {e}"))?;
    let key = crate::commands::unprotect_secrets(&protected)?;
    if key.len() != 32 {
        return Err("数据库加密密钥格式无效。".into());
    }
    let conn = connect(path, &hex_key(&key), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    verify_key(&conn)?;
    Ok(conn)
}

#[cfg(not(windows))]
pub fn open(_path: &Path) -> Result<Connection, String> {
    Err("数据库加密目前需要 Windows DPAPI。".into())
}

#[cfg(not(windows))]
pub fn open_readonly(_path: &Path) -> Result<Connection, String> {
    Err("数据库加密目前需要 Windows DPAPI。".into())
}

#[cfg(windows)]
fn connect(path: &Path, key: &str, flags: OpenFlags) -> Result<Connection, String> {
    let conn =
        Connection::open_with_flags(path, flags).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.pragma_update(None, "key", key)
        .map_err(|e| format!("设置数据库密钥失败: {e}"))?;
    let cipher: Option<String> = conn
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .optional()
        .map_err(|e| format!("检查数据库加密模块失败: {e}"))?;
    if cipher.is_none() {
        return Err("当前 SQLite 未启用 SQLCipher，拒绝以明文方式打开数据库。".into());
    }
    Ok(conn)
}

#[cfg(windows)]
fn verify_key(conn: &Connection) -> Result<(), String> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|_| ())
    .map_err(|e| format!("数据库密钥不匹配或数据库已损坏: {e}"))
}

#[cfg(windows)]
fn verify_integrity(conn: &Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("数据库密钥不匹配或数据库已损坏: {e}"))?;
    if result != "ok" {
        return Err(format!("数据库完整性检查失败: {result}"));
    }
    Ok(())
}

#[cfg(windows)]
fn hex_key(key: &[u8]) -> String {
    key.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(windows)]
fn is_plaintext_database(path: &Path) -> Result<bool, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() == 0 {
        return Ok(true);
    }
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 16];
    use std::io::Read;
    file.read_exact(&mut header)
        .map_err(|e| format!("读取数据库文件头失败: {e}"))?;
    Ok(&header == SQLITE_HEADER)
}

#[cfg(windows)]
fn migrate_plaintext(path: &Path, key: &str) -> Result<(), String> {
    let temp = path.with_file_name(TEMP_FILE);
    let conn = Connection::open(path).map_err(|e| format!("打开旧数据库失败: {e}"))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|e| format!("读取旧数据库失败，原库未改动: {e}"))?;

    let (busy, _, _) = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("检查旧数据库 WAL 失败: {e}"))?;
    if busy != 0 {
        return Err("旧数据库仍被其他进程占用，未执行加密迁移。".into());
    }
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))
        .map_err(|e| format!("关闭旧数据库 WAL 失败: {e}"))?;
    if !journal_mode.eq_ignore_ascii_case("delete") {
        return Err("旧数据库 WAL 未能安全关闭，未执行加密迁移。".into());
    }

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let application_id: i64 = conn
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if temp.exists() {
        std::fs::remove_file(&temp).map_err(|e| format!("清理上次迁移临时库失败: {e}"))?;
    }

    let export_result = (|| {
        conn.execute(
            "ATTACH DATABASE ?1 AS encrypted KEY ?2",
            params![temp.to_string_lossy(), key],
        )
        .map_err(|e| format!("创建加密数据库失败: {e}"))?;
        conn.execute_batch("SELECT sqlcipher_export('encrypted', 'main');")
            .map_err(|e| format!("复制旧数据库数据失败: {e}"))?;
        conn.execute_batch(&format!(
            "PRAGMA encrypted.user_version = {user_version}; PRAGMA encrypted.application_id = {application_id}; DETACH DATABASE encrypted;"
        ))
        .map_err(|e| format!("完成加密数据库迁移失败: {e}"))?;
        Ok::<(), String>(())
    })();
    drop(conn);
    if let Err(error) = export_result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    if has_sidecars(path)? {
        let _ = std::fs::remove_file(&temp);
        return Err("旧数据库仍有 SQLite 日志文件，未执行加密迁移。".into());
    }

    let encrypted = connect(&temp, key, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("验证迁移后的数据库失败，原库未改动: {e}"))?;
    verify_integrity(&encrypted)?;
    drop(encrypted);

    let backup = path.with_file_name(format!("{BACKUP_PREFIX}{}.bak", uuid::Uuid::new_v4()));
    std::fs::rename(path, &backup).map_err(|e| format!("暂存旧数据库失败: {e}"))?;
    if let Err(error) = std::fs::rename(&temp, path) {
        let rollback = std::fs::rename(&backup, path);
        return match rollback {
            Ok(()) => Err(format!("安装加密数据库失败，已恢复旧数据库: {error}")),
            Err(rollback_error) => Err(format!(
                "安装加密数据库失败: {error}; 恢复旧库也失败: {rollback_error}; 旧库保留在 {}",
                backup.display()
            )),
        };
    }
    remove_plaintext_backups(path)?;
    Ok(())
}

#[cfg(windows)]
fn has_sidecars(path: &Path) -> Result<bool, String> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        if PathBuf::from(name).exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
fn migration_backups(path: &Path) -> Result<Vec<PathBuf>, String> {
    let dir = path.parent().ok_or("数据库路径无父目录")?;
    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(BACKUP_PREFIX) && name.ends_with(".bak") {
            result.push(entry.path());
        }
    }
    Ok(result)
}

#[cfg(windows)]
fn newest(mut paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    });
    paths.pop()
}

#[cfg(windows)]
fn remove_plaintext_backups(path: &Path) -> Result<(), String> {
    for backup in migration_backups(path)? {
        std::fs::remove_file(&backup)
            .map_err(|e| format!("无法删除旧的明文数据库备份 {}: {e}", backup.display()))?;
    }
    Ok(())
}
