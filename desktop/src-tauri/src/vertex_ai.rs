use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ring::{
    rand::SystemRandom,
    signature::{RsaKeyPair, RSA_PKCS1_SHA256},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
#[derive(Default)]
pub struct VertexState {
    token: tokio::sync::Mutex<Option<(String, u64, String)>>,
}
#[derive(Deserialize, Serialize)]
struct ServiceAccount {
    r#type: String,
    project_id: String,
    client_email: String,
    private_key: String,
    token_uri: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VertexStatus {
    configured: bool,
    project_id: Option<String>,
    email: Option<String>,
    credential_id: Option<String>,
}
pub fn valid_project(value: &str) -> bool {
    (6..=63).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && value.as_bytes()[0].is_ascii_lowercase()
        && !value.ends_with('-')
}
fn key(account: &ServiceAccount) -> Result<RsaKeyPair, String> {
    if account.r#type != "service_account"
        || !valid_project(&account.project_id)
        || account.client_email.len() > 254
        || !account.client_email.ends_with(".iam.gserviceaccount.com")
        || !account
            .client_email
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"@.-_".contains(&c))
        || account.token_uri != TOKEN_URL
    {
        return Err("Invalid Google service account JSON".into());
    }
    let pem = account
        .private_key
        .trim()
        .strip_prefix("-----BEGIN PRIVATE KEY-----")
        .and_then(|v| v.strip_suffix("-----END PRIVATE KEY-----"))
        .ok_or("Service account requires a PKCS8 private key")?;
    let der = STANDARD
        .decode(
            pem.chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>(),
        )
        .map_err(|_| "Invalid service account key")?;
    RsaKeyPair::from_pkcs8(&der).map_err(|_| "Invalid service account RSA key".into())
}
fn parse(raw: &str) -> Result<ServiceAccount, String> {
    if raw.len() > 32_768 {
        return Err("Service account JSON exceeds 32 KiB".into());
    }
    let account: ServiceAccount =
        serde_json::from_str(raw).map_err(|_| "Invalid service account JSON")?;
    key(&account)?;
    Ok(account)
}
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate application data")?;
    std::fs::create_dir_all(&dir).map_err(|_| "Cannot create application data")?;
    Ok(dir.join("vertex-ai.dpapi"))
}
#[cfg(windows)]
fn load(app: &AppHandle) -> Result<Option<ServiceAccount>, String> {
    let bytes = match std::fs::read(path(app)?) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read Vertex credentials".into()),
    };
    let bytes = crate::commands::unprotect_secrets(&bytes)?;
    let raw = std::str::from_utf8(&bytes).map_err(|_| "Invalid saved Vertex credentials")?;
    parse(raw).map(Some)
}
#[cfg(not(windows))]
fn load(_: &AppHandle) -> Result<Option<ServiceAccount>, String> {
    Ok(None)
}
fn status(account: Option<&ServiceAccount>) -> VertexStatus {
    VertexStatus {
        configured: account.is_some(),
        project_id: account.map(|a| a.project_id.clone()),
        email: account.map(|a| a.client_email.clone()),
        credential_id: account.map(|a| format!("{:x}", Sha256::digest(a.private_key.as_bytes()))),
    }
}
#[tauri::command]
pub fn vertex_ai_status(app: AppHandle) -> Result<VertexStatus, String> {
    Ok(status(load(&app)?.as_ref()))
}
#[tauri::command]
pub async fn vertex_ai_save(
    app: AppHandle,
    state: State<'_, VertexState>,
    credentials: String,
) -> Result<VertexStatus, String> {
    let account = parse(&credentials)?;
    let mut token = state.token.lock().await;
    #[cfg(windows)]
    {
        let bytes = serde_json::to_vec(&account).map_err(|_| "Cannot encode Vertex credentials")?;
        crate::atomic_file::write_atomic(&path(&app)?, &crate::commands::protect_secrets(&bytes)?)
            .map_err(|_| "Cannot save Vertex credentials")?;
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        return Err("Secure Vertex credentials require Windows desktop".into());
    }
    *token = None;
    Ok(status(Some(&account)))
}
#[tauri::command]
pub async fn vertex_ai_remove(app: AppHandle, state: State<'_, VertexState>) -> Result<(), String> {
    let mut token = state.token.lock().await;
    match std::fs::remove_file(path(&app)?) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("Cannot remove Vertex credentials".into()),
    }
    *token = None;
    Ok(())
}
fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| "Check the computer clock".into())
}
fn assertion(account: &ServiceAccount, at: u64) -> Result<String, String> {
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
    let claims = serde_json::json!({"iss":account.client_email,"scope":"https://www.googleapis.com/auth/cloud-platform","aud":TOKEN_URL,"iat":at,"exp":at+3600});
    let payload = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&claims).map_err(|_| "Cannot encode Google authorization")?);
    let signed = format!("{header}.{payload}");
    let pair = key(account)?;
    let mut signature = vec![0; pair.public().modulus_len()];
    pair.sign(
        &RSA_PKCS1_SHA256,
        &SystemRandom::new(),
        signed.as_bytes(),
        &mut signature,
    )
    .map_err(|_| "Cannot sign Google authorization")?;
    Ok(format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature)))
}
#[tauri::command]
pub async fn vertex_ai_access_token(
    app: AppHandle,
    state: State<'_, VertexState>,
    expected_credential_id: Option<String>,
) -> Result<String, String> {
    let mut cached = state.token.lock().await;
    let at = now()?;
    if let Some((token, expires, id)) = cached.as_ref() {
        if expected_credential_id
            .as_ref()
            .is_some_and(|expected| expected != id)
        {
            return Err("Vertex credentials changed; check settings and retry".into());
        }
        if *expires > at + 120 {
            return Ok(token.clone());
        }
    }
    let account = load(&app)?.ok_or("Import a Vertex service account JSON first")?;
    let id = status(Some(&account)).credential_id.unwrap();
    if expected_credential_id
        .as_ref()
        .is_some_and(|expected| expected != &id)
    {
        return Err("Vertex credentials changed; check settings and retry".into());
    }
    let jwt = assertion(&account, at)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cannot initialize Google authorization")?;
    let mut response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "Google authorization connection failed")?;
    if !response.status().is_success() {
        return Err(format!(
            "Google authorization failed ({}). Check the service account and computer clock.",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Cannot read Google authorization")?
    {
        if bytes.len() + chunk.len() > 16_384 {
            return Err("Google authorization response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let data: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Google authorization response")?;
    let token = data["access_token"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() < 8192 && s.bytes().all(|c| c.is_ascii_graphic()))
        .ok_or("Missing Google access token")?;
    let expires = data["expires_in"]
        .as_u64()
        .filter(|n| *n > 120 && *n <= 3600)
        .ok_or("Invalid Google token expiry")?;
    *cached = Some((token.into(), at + expires, id));
    Ok(token.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_assertion_has_google_claims_and_a_valid_rsa_signature() {
        // Public test fixture only; never used as an application credential.
        let account = ServiceAccount {
            r#type: "service_account".into(),
            project_id: "test-project".into(),
            client_email: "test@test-project.iam.gserviceaccount.com".into(),
            private_key: include_str!("../tests/fixtures/vertex-test-only-key.txt").into(),
            token_uri: TOKEN_URL.into(),
        };
        let value = assertion(&account, 1_800_000_000).unwrap();
        let parts: Vec<_> = value.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], TOKEN_URL);
        assert_eq!(claims["iss"], account.client_email);
        assert_eq!(
            claims["scope"],
            "https://www.googleapis.com/auth/cloud-platform"
        );
        assert_eq!(
            claims["exp"].as_u64().unwrap() - claims["iat"].as_u64().unwrap(),
            3600
        );
        let pair = key(&account).unwrap();
        ring::signature::UnparsedPublicKey::new(
            &ring::signature::RSA_PKCS1_2048_8192_SHA256,
            pair.public().as_ref(),
        )
        .verify(
            format!("{}.{}", parts[0], parts[1]).as_bytes(),
            &URL_SAFE_NO_PAD.decode(parts[2]).unwrap(),
        )
        .unwrap();
        let status = status(Some(&account));
        assert!(status.configured);
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("PRIVATE KEY"));
        assert!(!json.contains("private_key"));
    }
    #[test]
    fn rejects_untrusted_credentials() {
        assert!(parse("{}").is_err());
        assert!(parse(&"x".repeat(32_769)).is_err());
        assert!(parse(r#"{"type":"service_account","project_id":"valid-project","client_email":"a@valid-project.iam.gserviceaccount.com","private_key":"bad","token_uri":"https://attacker.test/token"}"#).is_err());
    }
    #[test]
    fn project_validation_rejects_path_injection() {
        for value in [
            "",
            "../project",
            "project?key=secret",
            "UPPER-project",
            "abcde",
            "project-",
        ] {
            assert!(!valid_project(value));
        }
        assert!(valid_project("valid-project-123"));
    }
}
