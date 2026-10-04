use std::io::Read;
use std::path::{Component, Path};

pub fn validate_model_name(raw: &str) -> Result<String, String> {
    let stem = raw.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if raw.is_empty() || raw.len() > 128 || raw.trim() != raw || raw.starts_with('.')
        || raw.ends_with('.') || reserved
        || !raw.chars().all(|c| c.is_ascii_alphanumeric() || "-_. ".contains(c)) {
        return Err("非法的模型名".into());
    }
    Ok(raw.to_string())
}

// Extract only into a newly created staging directory, never an installed model.
pub fn unpack_model<R: Read>(reader: R, dest: &Path) -> Result<(), String> {
    const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
    // Bound headers/padding too; entry sizes alone do not bound decompression.
    let mut archive = tar::Archive::new(reader.take(MAX_BYTES + 16 * 1024 * 1024));
    let mut total = 0u64;
    for (index, entry) in archive.entries().map_err(|e| e.to_string())?.enumerate() {
        if index >= 10_000 { return Err("模型压缩包文件数过多".into()); }
        let mut entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() { return Err("模型压缩包包含链接或特殊文件".into()); }
        let path = entry.path().map_err(|e| e.to_string())?;
        if path.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
            return Err("模型压缩包路径越界".into());
        }
        for component in path.components() {
            if let Component::Normal(value) = component {
                validate_model_name(value.to_str().ok_or("非法的压缩包路径")?)?;
            }
        }
        total = total.checked_add(entry.size()).ok_or("模型压缩包过大")?;
        if total > MAX_BYTES { return Err("模型解包总量超过 4 GB".into()); }
        if !entry.unpack_in(dest).map_err(|e| e.to_string())? {
            return Err("模型压缩包路径越界".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_links_and_oversized_archives() {
        for name in ["../escape", "a/b", "a\\b", "con.txt", "NUL", "model.", " model", "a:b"] {
            assert!(validate_model_name(name).is_err(), "accepted {name}");
        }
        assert_eq!(validate_model_name("sherpa-onnx-whisper-tiny").unwrap(), "sherpa-onnx-whisper-tiny");
        let dest = std::env::temp_dir().join(format!("wap-archive-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dest).unwrap();
        for (name, kind, size) in [("weights.onnx", tar::EntryType::Regular, 3),
            ("link", tar::EntryType::Symlink, 0), ("weights.onnx", tar::EntryType::Regular, 5 * 1024 * 1024 * 1024)] {
            let mut header = tar::Header::new_gnu();
            header.set_path(name).unwrap();
            header.set_entry_type(kind);
            header.set_size(size);
            header.set_mode(0o600);
            if kind.is_symlink() { header.set_link_name("../outside").unwrap(); }
            header.set_cksum();
            let mut bytes = header.as_bytes().to_vec();
            bytes.extend_from_slice(&[0; 1536]);
            assert_eq!(unpack_model(bytes.as_slice(), &dest).is_ok(), kind.is_file() && size == 3);
        }
        assert_eq!(std::fs::read(dest.join("weights.onnx")).unwrap(), [0, 0, 0]);
        std::fs::remove_dir_all(&dest).unwrap();
    }
}
