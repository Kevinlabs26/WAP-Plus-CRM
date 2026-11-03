use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Default)]
pub struct GoogleState(pub tokio::sync::Mutex<()>);

#[derive(Deserialize)]
struct Client { client_id: String, client_secret: String }
fn client() -> Result<Client, String> {
    let value: serde_json::Value = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/google-client.json"))).map_err(|_| "Invalid Google application configuration")?;
    let client: Client = serde_json::from_value(value["installed"].clone()).map_err(|_| "Google login is not configured in this build")?;
    if !client.client_id.ends_with(".apps.googleusercontent.com") || client.client_secret.is_empty() { return Err("Invalid Google desktop client".into()); }
    Ok(client)
}

const SHEETS_WRITE: &str = "https://www.googleapis.com/auth/spreadsheets";
const DOCS_READ: &str = "https://www.googleapis.com/auth/documents.readonly";
#[derive(Serialize, Deserialize)]
struct Tokens { access: String, refresh: String, expires: u64, email: String, #[serde(default)] scopes: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus { configured: bool, email: Option<String>, needs_access: bool }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| "Cannot locate application data")?;
    std::fs::create_dir_all(&dir).map_err(|_| "Cannot create application data")?;
    Ok(dir.join("google-sheets.dpapi"))
}
#[cfg(windows)]
fn save(app: &AppHandle, tokens: &Tokens) -> Result<(), String> {
    let raw = serde_json::to_vec(tokens).map_err(|_| "Cannot encode Google authorization")?;
    crate::atomic_file::write_atomic(&path(app)?, &crate::commands::protect_secrets(&raw)?).map_err(|_| "Cannot save Google authorization".into())
}
#[cfg(not(windows))]
fn save(_: &AppHandle, _: &Tokens) -> Result<(), String> { Err("Secure Google login requires Windows".into()) }
#[cfg(windows)]
fn load(app: &AppHandle) -> Result<Option<Tokens>, String> {
    let bytes = match std::fs::read(path(app)?) { Ok(bytes) => bytes, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(_) => return Err("Cannot read Google authorization".into()) };
    serde_json::from_slice(&crate::commands::unprotect_secrets(&bytes)?).map(Some).map_err(|_| "Invalid saved Google authorization".into())
}
#[cfg(not(windows))]
fn load(_: &AppHandle) -> Result<Option<Tokens>, String> { Ok(None) }
fn http() -> Result<reqwest::Client, String> { reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Cannot initialize Google connection".into()) }
async fn json(mut response: reqwest::Response) -> Result<serde_json::Value, String> {
    if !response.status().is_success() { return Err(format!("Google request failed ({}). Check authorization and API access.", response.status().as_u16())); }
    const LIMIT: usize = 32 * 1024 * 1024;
    let too_large = || "Google response exceeds 32 MiB; reduce selected data".to_string();
    if response.content_length().is_some_and(|size| size > LIMIT as u64) { return Err(too_large()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Cannot read Google response".to_string())? {
        if chunk.len() > LIMIT - bytes.len() { return Err(too_large()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid Google response".into())
}

fn callback_result(target: &str, nonce: &str) -> Option<Result<String, String>> {
    let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if parsed.path() != "/" { return None; }
    let pairs: Vec<_> = parsed.query_pairs().collect();
    if pairs.iter().filter(|(key, _)| key == "state").count() != 1 || !pairs.iter().any(|(key, value)| key == "state" && value == nonce) { return None; }
    if pairs.iter().filter(|(key, _)| key == "code").count() != 1 || pairs.iter().any(|(key, _)| key == "error") { return Some(Err("Google authorization was declined".into())); }
    Some(pairs.iter().find(|(key, _)| key == "code").map(|(_, value)| value.to_string()).filter(|code| !code.is_empty()).ok_or("Missing Google authorization code".into()))
}

async fn access_token(app: &AppHandle) -> Result<Tokens, String> {
    let mut tokens = load(app)?.ok_or("Connect your Google account first")?;
    if tokens.expires <= now() + 60 {
        let client = client()?;
        let value = json(http()?.post("https://oauth2.googleapis.com/token").form(&[("client_id", client.client_id.as_str()), ("client_secret", client.client_secret.as_str()), ("refresh_token", tokens.refresh.as_str()), ("grant_type", "refresh_token")]).send().await.map_err(|_| "Cannot refresh Google authorization")?).await?;
        tokens.access = value["access_token"].as_str().ok_or("Reconnect your Google account")?.into();
        tokens.expires = now() + value["expires_in"].as_u64().unwrap_or(3600);
        save(app, &tokens)?;
    }
    Ok(tokens)
}

fn needs_access(tokens: &Tokens) -> bool {
    let scopes: Vec<_> = tokens.scopes.split_whitespace().collect();
    !scopes.contains(&SHEETS_WRITE) || !scopes.contains(&DOCS_READ)
}

#[tauri::command]
pub fn google_sheets_status(app: AppHandle) -> Result<GoogleStatus, String> {
    let tokens = load(&app)?;
    Ok(GoogleStatus { configured: client().is_ok(), email: tokens.as_ref().map(|tokens| tokens.email.clone()), needs_access: tokens.as_ref().is_some_and(needs_access) })
}

#[tauri::command]
pub async fn google_sheets_connect(app: AppHandle, state: State<'_, GoogleState>) -> Result<GoogleStatus, String> {
    let _lock = state.0.try_lock().map_err(|_| "Google authorization is already running")?;
    let client = client()?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|_| "Cannot open Google authorization callback")?;
    let redirect = format!("http://127.0.0.1:{}/", listener.local_addr().map_err(|_| "Cannot locate callback")?.port());
    let nonce = uuid::Uuid::new_v4().to_string();
    let verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client.client_id.as_str()), ("redirect_uri", redirect.as_str()),
        ("response_type", "code"), ("scope", "openid email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents.readonly"),
        ("access_type", "offline"), ("prompt", "consent select_account"),
        ("state", nonce.as_str()), ("code_challenge", challenge.as_str()), ("code_challenge_method", "S256"),
    ]);
    #[allow(deprecated)]
    app.shell().open(url.as_str(), None).map_err(|_| "Cannot open Google login in your browser")?;
    let code = tokio::time::timeout(Duration::from_secs(180), async {
        loop {
            let (mut socket, _) = listener.accept().await.map_err(|_| "Google callback failed")?;
            let mut data = Vec::new();
            let read = tokio::time::timeout(Duration::from_secs(3), async {
                while data.len() < 8192 {
                    let mut chunk = [0u8; 1024];
                    let count = socket.read(&mut chunk).await?;
                    if count == 0 { break; }
                    data.extend_from_slice(&chunk[..count]);
                    if data.windows(4).any(|value| value == b"\r\n\r\n") { break; }
                }
                Ok::<(), std::io::Error>(())
            }).await;
            if !matches!(read, Ok(Ok(()))) { continue; }
            let request = String::from_utf8_lossy(&data);
            let target = request.lines().next().and_then(|line| line.strip_prefix("GET ")).and_then(|line| line.split_whitespace().next()).unwrap_or("");
            let result = callback_result(target, &nonce);
            let valid = result.is_some();
            let body = if valid { "Authorization received. You can return to WAP Plus CRM." } else { "Invalid authorization callback." };
            let response = format!("HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}", if valid {"200 OK"} else {"400 Bad Request"}, body.len(), body);
            let _ = tokio::time::timeout(Duration::from_secs(2), socket.write_all(response.as_bytes())).await;
            if !valid { continue; }
            return result.unwrap();
        }
    }).await.map_err(|_| "Google login timed out. Please try again.")??;
    let response = http()?.post("https://oauth2.googleapis.com/token").form(&[
        ("client_id", client.client_id.as_str()), ("client_secret", client.client_secret.as_str()),
        ("code", code.as_str()), ("code_verifier", verifier.as_str()), ("redirect_uri", redirect.as_str()), ("grant_type", "authorization_code"),
    ]).send().await.map_err(|_| "Cannot complete Google authorization")?;
    let value = json(response).await?;
    let scopes = value["scope"].as_str().unwrap_or("https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents.readonly").to_string();
    let mut tokens = Tokens { access: value["access_token"].as_str().ok_or("Missing Google access token")?.into(), refresh: value["refresh_token"].as_str().ok_or("Missing Google refresh token; please authorize again")?.into(), expires: now() + value["expires_in"].as_u64().unwrap_or(3600), email: String::new(), scopes };
    let profile = json(http()?.get("https://openidconnect.googleapis.com/v1/userinfo").bearer_auth(&tokens.access).send().await.map_err(|_| "Cannot read Google account")?).await?;
    tokens.email = profile["email"].as_str().ok_or("Cannot identify Google account")?.into();
    save(&app, &tokens)?;
    let needs_access = needs_access(&tokens);
    Ok(GoogleStatus { configured: true, email: Some(tokens.email), needs_access })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn google_json_bounds_decoded_streams_even_without_content_length() {
        for mode in ["valid", "declared", "chunked"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 2048];
                socket.read(&mut request).await.unwrap();
                match mode {
                    "valid" => socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}").await.unwrap(),
                    "declared" => socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 33554433\r\n\r\n").await.unwrap(),
                    _ => {
                        socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
                        let block = vec![b' '; 1024 * 1024];
                        for _ in 0..33 {
                            if socket.write_all(b"100000\r\n").await.is_err()
                                || socket.write_all(&block).await.is_err()
                                || socket.write_all(b"\r\n").await.is_err() { return; }
                        }
                        let _ = socket.write_all(b"0\r\n\r\n").await;
                    }
                }
            });
            let response = http().unwrap().get(format!("http://{address}/")).send().await.unwrap();
            if mode == "valid" { assert_eq!(json(response).await.unwrap()["ok"], true); }
            else { assert!(json(response).await.unwrap_err().contains("32 MiB")); }
            server.await.unwrap();
        }
    }
    #[test]
    fn callbacks_require_the_random_state_and_unambiguous_code() {
        assert_eq!(callback_result("/?state=nonce&code=abc", "nonce"), Some(Ok("abc".into())));
        assert_eq!(callback_result("/?state=other&code=abc", "nonce"), None);
        assert_eq!(callback_result("/?code=abc", "nonce"), None);
        assert_eq!(callback_result("/?state=nonce&state=nonce&code=abc", "nonce"), None);
        assert!(callback_result("/?state=nonce&error=access_denied", "nonce").unwrap().is_err());
        assert!(callback_result("/?state=nonce&code=a&code=b", "nonce").unwrap().is_err());
    }
    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}

#[tauri::command]
pub async fn google_sheets_disconnect(app: AppHandle, state: State<'_, GoogleState>) -> Result<(), String> {
    let _lock = state.0.try_lock().map_err(|_| "Wait for the current Google operation to finish")?;
    // Local removal also works offline; users can revoke access in their Google account.
    match std::fs::remove_file(path(&app)?) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(_) => Err("Cannot remove Google authorization".into()) }
}

#[tauri::command]
pub async fn google_sheets_read(app: AppHandle, state: State<'_, GoogleState>, spreadsheet_id: String, ranges: Vec<String>) -> Result<serde_json::Value, String> {
    if spreadsheet_id.is_empty() || !spreadsheet_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') || ranges.len() > 100 || ranges.iter().any(|range| range.len() > 512) { return Err("Invalid spreadsheet selection".into()); }
    let _lock = state.0.lock().await;
    let tokens = access_token(&app).await?;
    let mut url = url::Url::parse(&format!("https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}{}", if ranges.is_empty() { "" } else { "/values:batchGet" })).unwrap();
    if ranges.is_empty() { url.query_pairs_mut().append_pair("fields", "sheets.properties(sheetId,title)"); }
    else { for range in ranges { url.query_pairs_mut().append_pair("ranges", &range); } url.query_pairs_mut().append_pair("majorDimension", "COLUMNS"); }
    json(http()?.get(url).bearer_auth(tokens.access).send().await.map_err(|_| "Cannot read Google Sheets; check your connection")?).await
}

#[tauri::command]
pub async fn google_sheets_read_grid(app: AppHandle, state: State<'_, GoogleState>, spreadsheet_id: String, ranges: Vec<String>) -> Result<serde_json::Value, String> {
    if spreadsheet_id.is_empty() || !spreadsheet_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') || ranges.is_empty() || ranges.len() > 100 || ranges.iter().any(|range| range.is_empty() || range.len() > 512) { return Err("Invalid spreadsheet selection".into()); }
    let _lock = state.0.lock().await;
    let tokens = access_token(&app).await?;
    let mut url = url::Url::parse(&format!("https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}")).unwrap();
    {
        let mut query = url.query_pairs_mut();
        for range in ranges { query.append_pair("ranges", &range); }
        query.append_pair("includeGridData", "true");
        query.append_pair("fields", "sheets(data(startRow,rowData(values(formattedValue,hyperlink,userEnteredValue(formulaValue),textFormatRuns(format(link(uri)))))))");
    }
    json(http()?.get(url).bearer_auth(tokens.access).send().await.map_err(|_| "Cannot read Google Sheets; check your connection")?).await
}

#[tauri::command]
pub async fn google_docs_read(app: AppHandle, state: State<'_, GoogleState>, document_id: String) -> Result<serde_json::Value, String> {
    if document_id.is_empty() || document_id.len() > 256 || !document_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') { return Err("Invalid Google document link".into()); }
    let _lock = state.0.lock().await;
    let tokens = access_token(&app).await?;
    let url = format!("https://docs.googleapis.com/v1/documents/{document_id}?includeTabsContent=true");
    json(http()?.get(url).bearer_auth(tokens.access).send().await.map_err(|_| "Cannot read Google document; check access and connection")?).await
}

#[tauri::command]
pub async fn google_sheets_update_cell(app: AppHandle, state: State<'_, GoogleState>, spreadsheet_id: String, tab: String, column: u32, row: u32, value: String) -> Result<(), String> {
    if spreadsheet_id.is_empty() || !spreadsheet_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') || tab.is_empty() || tab.len() > 200 || tab.chars().any(char::is_control) || column > 18_277 || row == 0 || row > 10_000_000 || value.len() > 100_000 { return Err("Invalid spreadsheet cell update".into()); }
    let _lock = state.0.lock().await;
    let tokens = access_token(&app).await?;
    let mut n = column + 1;
    let mut letters = String::new();
    while n > 0 { n -= 1; letters.insert(0, char::from(b'A' + (n % 26) as u8)); n /= 26; }
    let range = format!("'{}'!{letters}{row}", tab.replace('\'', "''"));
    let mut url = url::Url::parse(&format!("https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/")).unwrap();
    url.path_segments_mut().map_err(|_| "Invalid spreadsheet URL")?.pop_if_empty().push(&range);
    url.query_pairs_mut().append_pair("valueInputOption", "RAW");
    let response = http()?.put(url).bearer_auth(tokens.access).json(&serde_json::json!({"values": [[value]]})).send().await.map_err(|_| "Cannot update Google Sheets; check your connection")?;
    if !response.status().is_success() { return Err(format!("Google Sheets update failed ({}). Check edit access.", response.status().as_u16())); }
    Ok(())
}
