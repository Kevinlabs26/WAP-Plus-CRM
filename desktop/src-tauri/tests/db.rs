#![allow(dead_code)]

#[path = "../src/atomic_file.rs"]
mod atomic_file;
#[path = "../src/dpapi.rs"]
mod commands;
#[path = "../src/db_encryption.rs"]
mod db_encryption;

#[path = "../src/db.rs"]
mod db;

#[cfg(windows)]
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
