use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct ImportFile {
    path: String,
    category: Option<String>,
}
#[derive(Default, Serialize)]
pub struct ImportScan {
    files: Vec<ImportFile>,
    skipped: usize,
}
fn image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp"
    )
}
fn walk(
    path: &Path,
    root: &Path,
    prefix: &str,
    depth: usize,
    result: &mut ImportScan,
    visited: &mut HashSet<PathBuf>,
    count: &mut usize,
) -> Result<(), String> {
    *count += 1;
    if *count > 12_000 || depth > 20 {
        return Err("Folder is too large or too deeply nested; select a smaller folder".into());
    }
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "Cannot read an imported folder or file")?;
    if metadata.file_type().is_symlink() {
        result.skipped += 1;
        return Ok(());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Cannot resolve an imported path")?;
    if !canonical.starts_with(root) || !visited.insert(canonical.clone()) {
        result.skipped += 1;
        return Ok(());
    }
    if metadata.is_dir() {
        let mut children = std::fs::read_dir(path)
            .map_err(|_| "Cannot open an imported folder")?
            .take(12_001)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Cannot list an imported folder")?;
        if children.len() > 12_000 {
            return Err("Folder contains too many files".into());
        }
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            walk(
                &child.path(),
                root,
                prefix,
                depth + 1,
                result,
                visited,
                count,
            )?;
        }
    } else if metadata.is_file() && image_path(path) {
        if result.files.len() >= 3000 {
            return Err("Import at most 3000 images at a time".into());
        }
        let relative = canonical
            .parent()
            .unwrap_or(root)
            .strip_prefix(root)
            .map_err(|_| "Invalid folder image path")?;
        let mut parts = vec![prefix.to_string()];
        parts.extend(
            relative
                .iter()
                .map(|part| part.to_string_lossy().into_owned()),
        );
        let category = parts.join("/");
        if category.encode_utf16().count() > 60 || category == "*" {
            return Err("Folder category exceeds 60 characters; use a shorter folder path".into());
        }
        result.files.push(ImportFile {
            path: path.to_string_lossy().into_owned(),
            category: Some(category),
        });
    } else {
        result.skipped += 1;
    }
    Ok(())
}
pub fn scan(paths: Vec<String>) -> Result<ImportScan, String> {
    if paths.len() > 3000 {
        return Err("Import at most 3000 paths at a time".into());
    }
    let mut result = ImportScan::default();
    let mut visited = HashSet::new();
    let mut count = 0;
    for raw in paths {
        if raw.len() > 32_768 {
            return Err("Import path is too long".into());
        }
        let path = PathBuf::from(raw);
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| "Cannot find a dropped file or folder")?;
        if metadata.file_type().is_symlink() {
            result.skipped += 1;
            continue;
        }
        if metadata.is_dir() {
            let root = path
                .canonicalize()
                .map_err(|_| "Cannot resolve an imported folder")?;
            let prefix = path
                .file_name()
                .ok_or("Select a named folder")?
                .to_string_lossy();
            walk(
                &path,
                &root,
                &prefix,
                0,
                &mut result,
                &mut visited,
                &mut count,
            )?;
        } else if metadata.is_file() && image_path(&path) {
            if visited.insert(
                path.canonicalize()
                    .map_err(|_| "Cannot resolve an imported image")?,
            ) {
                if result.files.len() >= 3000 {
                    return Err("Import at most 3000 images at a time".into());
                }
                result.files.push(ImportFile {
                    path: path.to_string_lossy().into_owned(),
                    category: None,
                });
            }
        } else {
            result.skipped += 1;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folders_keep_relative_categories_and_skip_nonimages() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let folder = root.join("Materials");
        std::fs::create_dir_all(folder.join("Opening")).unwrap();
        std::fs::write(folder.join("a.png"), b"fixture").unwrap();
        std::fs::write(folder.join("Opening/b.JPG"), b"fixture").unwrap();
        std::fs::write(folder.join("notes.txt"), b"fixture").unwrap();
        let result = scan(vec![folder.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(result.files.len(), 2);
        assert_eq!(result.skipped, 1);
        assert!(result
            .files
            .iter()
            .any(|file| file.category.as_deref() == Some("Materials/Opening")));
        assert!(result
            .files
            .iter()
            .any(|file| file.category.as_deref() == Some("Materials")));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_paths_and_oversized_categories_fail_before_import() {
        assert!(scan(vec!["missing-folder-should-not-exist".into()]).is_err());
        assert!(scan(vec!["x".repeat(32_769)]).is_err());
    }
}
