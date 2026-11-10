fn main() {
    println!("cargo:rerun-if-env-changed=WAP_GOOGLE_CLIENT_PATH");
    println!("cargo:rerun-if-env-changed=WAP_REQUIRE_GOOGLE_CLIENT");
    let client_path = std::env::var("WAP_GOOGLE_CLIENT_PATH").ok().or_else(|| {
        let manifest_dir =
            std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
        let mut cur = manifest_dir.as_path();
        // Only discover development credentials inside this repository.
        for _ in 0..3 {
            if let Ok(entries) = std::fs::read_dir(cur) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("client_secret") && name.ends_with(".json") {
                        return Some(entry.path().to_string_lossy().to_string());
                    }
                }
            }
            match cur.parent() {
                Some(p) => cur = p,
                None => break,
            }
        }
        None
    });
    if (std::env::var("WAP_REQUIRE_GOOGLE_CLIENT").as_deref() == Ok("1")
        || std::env::var("PROFILE").as_deref() == Ok("release"))
        && client_path.is_none()
    {
        panic!("Google desktop client configuration is required; provide WAP_GOOGLE_CLIENT_PATH or client_secret*.json");
    }
    let client = match client_path {
        Some(path) => {
            println!("cargo:rerun-if-changed={path}");
            std::fs::read(path).expect("Cannot read Google desktop client configuration")
        }
        None => b"{}".to_vec(),
    };
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("google-client.json"),
        client,
    )
    .unwrap();
    // Keep the pre-upgrade CRT linkage; Tauri's static CRT setting hangs this application's test startup.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new().static_vc_runtime(false)),
    )
    .expect("Tauri build failed")
}
