#![allow(dead_code)]
#[path = "../src/protocol.rs"] mod protocol;
#[path = "../src/bridge.rs"] mod bridge;
#[path = "../src/atomic_file.rs"] mod atomic_file;
#[path = "../src/dpapi.rs"] mod dpapi;
#[path = "../src/db_encryption.rs"] mod db_encryption;
#[path = "../src/db.rs"] mod db;
#[cfg(windows)]
#[path = "../src/clipboard.rs"] mod clipboard;
#[path = "../src/commands.rs"] mod commands;
fn show_main_window(_: &tauri::AppHandle) {}

#[test]
fn dropped_files_preserve_content_and_reject_oversized_inputs() {
    let dir = std::env::temp_dir().join(format!("wap-dropped-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    for (extension, mib) in [("pdf", 14), ("mp3", 16), ("mp4", 24)] {
        let path = dir.join(format!("fixture.{extension}"));
        std::fs::write(&path, b"original attachment").unwrap();
        let result = commands::read_dropped_file(path.to_string_lossy().into()).unwrap();
        assert_eq!(result.bytes, b"original attachment");
        std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(mib * 1024 * 1024 + 1).unwrap();
        assert!(commands::read_dropped_file(path.to_string_lossy().into()).is_err());
    }
    std::fs::remove_dir_all(dir).unwrap();
}
