#![allow(dead_code)]

#[path = "../src/atomic_file.rs"]
mod atomic_file;
#[path = "../src/dpapi.rs"]
mod commands;
#[path = "../src/db_encryption.rs"]
mod db_encryption;

#[path = "../src/db.rs"]
mod db;

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn encrypted_search_snapshot_allows_another_thread_to_save() {
    use db::{migrate, save_snapshot, search_messages, AppSnapshot, PersistDirtyFlags};
    use serde_json::json;

    let root = std::env::temp_dir().join(format!("wap-search-wal-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("wap-plus.db");
    let writer = crate::db_encryption::open(&path).unwrap();
    writer.pragma_update(None, "journal_mode", "WAL").unwrap();
    writer.busy_timeout(std::time::Duration::ZERO).unwrap();
    migrate(&writer).unwrap();
    let save = |id: &str| save_snapshot(&writer, &AppSnapshot {
        messages: vec![json!({"id": id, "body": "合同 bonjour"})],
        dirty: Some(PersistDirtyFlags { messages: true, ..Default::default() }),
        ..Default::default()
    }).unwrap();
    save("first");

    let timeout = std::time::Duration::from_secs(10);
    let (started, wait_for_snapshot) = std::sync::mpsc::channel();
    let (committed, wait_for_commit) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let conn = crate::db_encryption::open_readonly(&path).unwrap();
        let snapshot = conn.unchecked_transaction().unwrap();
        assert_eq!(search_messages(&snapshot, "合同", 40).unwrap().len(), 1);
        started.send(()).unwrap();
        wait_for_commit.recv_timeout(timeout).unwrap();
        assert_eq!(search_messages(&snapshot, "合同", 40).unwrap().len(), 1);
        assert_eq!(search_messages(&snapshot, "bonjour", 40).unwrap().len(), 1);
        drop(snapshot);
        assert_eq!(search_messages(&conn, "合同", 40).unwrap().len(), 2);
        assert_eq!(search_messages(&conn, "bonjour", 40).unwrap().len(), 2);
    });
    wait_for_snapshot.recv_timeout(timeout).unwrap();
    save("second");
    committed.send(()).unwrap();
    reader.join().unwrap();
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn sqlcipher_419_database_and_uncheckpointed_wal_survive_upgrade_and_restore() {
    let root = std::env::temp_dir().join(format!("wap-sqlcipher-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("wap-plus.db");
    std::fs::write(&path, include_bytes!("fixtures/sqlcipher-4.19.db.bin")).unwrap();
    std::fs::write(root.join("wap-plus.db-wal"), include_bytes!("fixtures/sqlcipher-4.19.wal.bin")).unwrap();
    let protected_key = commands::protect_secrets(&[7; 32]).unwrap();
    std::fs::write(root.join("db-key.dpapi"), &protected_key).unwrap();
    {
        let conn = db_encryption::open(&path).unwrap();
        assert!(rusqlite::version_number() >= 3_054_001);
        let cipher: String = conn.query_row("PRAGMA cipher_version", [], |r| r.get(0)).unwrap();
        assert!(cipher.starts_with("4.20."), "unexpected cipher: {cipher}");
        let rows: Vec<String> = conn.prepare("SELECT body FROM private_data ORDER BY rowid").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows, ["LEGACY_SQLCIPHER_ROW", "LEGACY_SQLCIPHER_WAL_ROW"]);
        conn.execute("INSERT INTO private_data VALUES (?1)", ["UPGRADED_ROW"]).unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    let backup = root.join("restored");
    std::fs::create_dir(&backup).unwrap();
    std::fs::copy(&path, backup.join("wap-plus.db")).unwrap();
    std::fs::write(backup.join("db-key.dpapi"), protected_key).unwrap();
    for candidate in [&path, &backup.join("wap-plus.db")] {
        let conn = db_encryption::open_readonly(candidate).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM private_data", [], |r| r.get::<_, i64>(0)).unwrap(), 3);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn encrypted_migration_survives_restart_and_missing_or_wrong_keys_preserve_the_database() {
    let root=std::env::temp_dir().join(format!("wap-db-encryption-{}",uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path=root.join("wap-plus.db");let key_path=root.join("db-key.dpapi");
    {
        let plain=rusqlite::Connection::open(&path).unwrap();
        plain.execute_batch("CREATE TABLE private_data(body TEXT);INSERT INTO private_data VALUES('PRIVATE_MIGRATION_FIXTURE_你好');").unwrap();
    }
    for _ in 0..2 {
        let conn=db_encryption::open(&path).unwrap();
        assert_eq!(conn.query_row("SELECT body FROM private_data",[],|row|row.get::<_,String>(0)).unwrap(),"PRIVATE_MIGRATION_FIXTURE_你好");
    }
    let bytes=std::fs::read(&path).unwrap();
    assert_ne!(&bytes[..16],b"SQLite format 3\0");
    let secret=b"PRIVATE_MIGRATION_FIXTURE_";
    assert!(!bytes.windows(secret.len()).any(|part|part==secret));
    let protected=std::fs::read(&key_path).unwrap();
    std::fs::remove_file(&key_path).unwrap();
    assert!(db_encryption::open(&path).is_err());assert!(!key_path.exists());assert_eq!(std::fs::read(&path).unwrap(),bytes);
    std::fs::write(&key_path,commands::protect_secrets(&[9;32]).unwrap()).unwrap();
    assert!(db_encryption::open(&path).is_err());assert_eq!(std::fs::read(&path).unwrap(),bytes);
    std::fs::write(&key_path,protected).unwrap();
    let readonly=db_encryption::open_readonly(&path).unwrap();
    assert_eq!(readonly.query_row("SELECT count(*) FROM private_data",[],|row|row.get::<_,i64>(0)).unwrap(),1);
    drop(readonly);std::fs::remove_dir_all(root).unwrap();
}
