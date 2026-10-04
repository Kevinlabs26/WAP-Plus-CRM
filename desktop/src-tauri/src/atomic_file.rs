use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // std::fs::rename 在 Windows 使用替换现有目标的原生操作。
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_complete_files_and_keeps_target_on_failure() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("secrets.dat");
        write_atomic(&path, b"old encrypted bytes").unwrap();
        write_atomic(&path, b"new encrypted bytes").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new encrypted bytes");
        assert!(write_atomic(&dir, b"cannot replace a directory").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new encrypted bytes");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
