use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

pub struct AppInstanceGuard {
    _file: File,
}

impl AppInstanceGuard {
    pub fn acquire(data_dir: &Path) -> io::Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let file = OpenOptions::new().read(true).write(true).create(true)
            .truncate(false).open(data_dir.join("app-instance.lock"))?;
        // The window-based single-instance plugin can miss an existing hidden window.
        file.try_lock().map_err(|error| io::Error::other(format!(
            "无法独占应用数据目录，可能已有 CRM 在运行。请从托盘打开已有窗口，勿重复启动：{error}"
        )))?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_another_instance_and_releases_on_drop() {
        let directory = std::env::temp_dir().join(format!("wap-instance-test-{}", std::process::id()));
        let first = AppInstanceGuard::acquire(&directory).unwrap();
        assert!(AppInstanceGuard::acquire(&directory).is_err());
        drop(first);
        let next = AppInstanceGuard::acquire(&directory).unwrap();
        drop(next);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
