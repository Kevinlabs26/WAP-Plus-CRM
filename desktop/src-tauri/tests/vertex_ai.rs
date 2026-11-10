#[path = "../src/atomic_file.rs"]
mod atomic_file;
mod commands {
    pub(crate) fn protect_secrets(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("Native storage is not exercised in this test".into())
    }
    pub(crate) fn unprotect_secrets(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("Native storage is not exercised in this test".into())
    }
}
#[path = "../src/vertex_ai.rs"]
mod vertex_ai;
