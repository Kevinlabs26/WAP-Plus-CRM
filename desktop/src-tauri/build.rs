fn main() {
    println!("cargo:rerun-if-env-changed=WAP_GOOGLE_CLIENT_PATH");
    println!("cargo:rerun-if-env-changed=WAP_REQUIRE_GOOGLE_CLIENT");
    if std::env::var("WAP_REQUIRE_GOOGLE_CLIENT").as_deref() == Ok("1") {
        assert!(std::env::var("WAP_GOOGLE_CLIENT_PATH").is_ok(), "Google desktop client configuration is required for this build");
    }
    let client = match std::env::var("WAP_GOOGLE_CLIENT_PATH") {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");
            std::fs::read(path).expect("Cannot read Google desktop client configuration")
        }
        Err(_) => b"{}".to_vec(),
    };
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("google-client.json"), client).unwrap();
    tauri_build::build()
}
