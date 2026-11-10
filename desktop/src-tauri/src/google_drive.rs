use crate::google_sheets::{drive_access_token, json, GoogleState};
use futures_util::stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use tauri::{AppHandle, Emitter, State, Manager};

const API: &str = "https://www.googleapis.com/drive/v3";
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DriveRequest {
    Folders {
        email: String,
        parent_id: String,
        page_token: Option<String>,
    },
    Folder {
        email: String,
        folder_id: String,
    },
    Prepare {
        email: String,
    },
    Upload {
        email: String,
        folder_id: String,
        file_id: String,
        data_url: Option<String>,
        name: String,
        mode: String,
        emails: Vec<String>,
    },
}
fn id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("云盘文件夹或文件 ID 无效".into());
    }
    Ok(())
}
fn recipients(mode: &str, emails: &[String]) -> Result<(), String> {
    if mode != "public" && mode != "emails" {
        return Err("请选择分享方式".into());
    }
    if mode == "emails"
        && (emails.is_empty()
            || emails.len() > 20
            || emails.iter().any(|email| {
                email.len() > 254
                    || email.chars().any(char::is_whitespace)
                    || email.matches('@').count() != 1
                    || email.split_once('@').is_none_or(|(name, domain)| {
                        name.is_empty()
                            || !domain.contains('.')
                            || domain.starts_with('.')
                            || domain.ends_with('.')
                    })
            }))
    {
        return Err("请填写有效的分享邮箱（最多 20 个）".into());
    }
    Ok(())
}
fn stage(app: &AppHandle, file_id: &str, stage: &str) {
    let _ = app.emit(
        "google-drive-upload-stage",
        json!({"fileId":file_id,"stage":stage}),
    );
}
async fn folder(client: &reqwest::Client, token: &str, folder_id: &str) -> Result<Value, String> {
    id(folder_id)?;
    let value = json(
        client
            .get(format!("{API}/files/{folder_id}"))
            .bearer_auth(token)
            .query(&[
                (
                    "fields",
                    "id,name,mimeType,trashed,capabilities(canAddChildren)",
                ),
                ("supportsAllDrives", "true"),
            ])
            .send()
            .await
            .map_err(|_| "无法检查目标文件夹")?,
    )
    .await?;
    if value["mimeType"] != "application/vnd.google-apps.folder"
        || value["trashed"] == true
        || value["capabilities"]["canAddChildren"] != true
    {
        return Err("目标不是可写入的云盘文件夹".into());
    }
    Ok(value)
}
async fn permissions(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
) -> Result<Vec<Value>, String> {
    let value = json(
        client
            .get(format!("{API}/files/{file_id}/permissions"))
            .bearer_auth(token)
            .query(&[
                (
                    "fields",
                    "permissions(id,type,role,emailAddress,deleted),nextPageToken",
                ),
                ("pageSize", "100"),
                ("supportsAllDrives", "true"),
            ])
            .send()
            .await
            .map_err(|_| "无法核对共享权限")?,
    )
    .await?;
    if value["nextPageToken"].is_string() {
        return Err("目标共享成员过多，请选择私有文件夹".into());
    }
    value["permissions"]
        .as_array()
        .cloned()
        .ok_or("无法确认云盘共享权限".into())
}
fn check_private_parent(
    permissions: &[Value],
    email: &str,
    emails: &[String],
) -> Result<(), String> {
    for permission in permissions {
        if permission["deleted"] == true {
            continue;
        }
        let address = permission["emailAddress"].as_str().unwrap_or("");
        if permission["type"] != "user"
            || !(address.eq_ignore_ascii_case(email)
                || emails
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(address)))
        {
            return Err("该文件夹已有其他共享权限。指定邮箱分享请选择私有文件夹，避免继承公开或团队访问权限".into());
        }
    }
    Ok(())
}
fn permission_request(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
    target: &Value,
) -> reqwest::RequestBuilder {
    let request = client
        .post(format!("{API}/files/{file_id}/permissions"))
        .bearer_auth(token)
        .query(&[("supportsAllDrives", "true")]);
    let request = if target["type"] == "user" {
        request.query(&[("sendNotificationEmail", "false")])
    } else {
        request
    };
    request.json(target)
}

#[tauri::command]
pub async fn google_drive(
    app: AppHandle,
    state: State<'_, GoogleState>,
    request: DriveRequest,
) -> Result<Value, String> {
    let _lock = state.operation.lock().await;
    let email = match &request {
        DriveRequest::Folders { email, .. }
        | DriveRequest::Folder { email, .. }
        | DriveRequest::Prepare { email }
        | DriveRequest::Upload { email, .. } => email,
    };
    let token = drive_access_token(&app, email).await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法连接 Google 云盘")?;
    match request {
        DriveRequest::Folders {
            parent_id,
            page_token,
            ..
        } => {
            id(&parent_id)?;
            if page_token.as_ref().is_some_and(|value| value.len() > 2048) {
                return Err("分页参数无效".into());
            }
            let mut query = vec![("q",format!("'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")),("pageSize","100".into()),("fields","nextPageToken,files(id,name,capabilities(canAddChildren))".into()),("orderBy","name".into()),("supportsAllDrives","true".into()),("includeItemsFromAllDrives","true".into())];
            if let Some(page) = page_token {
                query.push(("pageToken", page));
            }
            json(
                client
                    .get(format!("{API}/files"))
                    .bearer_auth(&token)
                    .query(&query)
                    .send()
                    .await
                    .map_err(|_| "无法读取云盘文件夹")?,
            )
            .await
        }
        DriveRequest::Folder { folder_id, .. } => folder(&client, &token, &folder_id).await,
        DriveRequest::Prepare { .. } => {
            json(
                client
                    .get(format!("{API}/files/generateIds"))
                    .bearer_auth(&token)
                    .query(&[("count", "1"), ("space", "drive"), ("type", "files")])
                    .send()
                    .await
                    .map_err(|_| "无法准备上传")?,
            )
            .await
        }
        DriveRequest::Upload {
            email,
            folder_id,
            file_id,
            data_url,
            name,
            mode,
            emails,
        } => {
            id(&file_id)?;
            id(&folder_id)?;
            recipients(&mode, &emails)?;
            if name.trim().is_empty() || name.chars().count() > 160 {
                return Err("图片名称无效".into());
            }
            let destination = folder(&client, &token, &folder_id).await?;
            let folder_id = destination["id"]
                .as_str()
                .ok_or("无法确认目标文件夹")?
                .to_string();
            if mode == "emails" {
                check_private_parent(
                    &permissions(&client, &token, &folder_id).await?,
                    &email,
                    &emails,
                )?;
            }
            stage(&app, &file_id, "uploading");
            let response = client
                .get(format!("{API}/files/{file_id}"))
                .bearer_auth(&token)
                .query(&[
                    (
                        "fields",
                        "id,parents,appProperties,mimeType,trashed,webViewLink",
                    ),
                    ("supportsAllDrives", "true"),
                ])
                .send()
                .await
                .map_err(|_| "无法检查上次上传结果，请稍后重试")?;
            let value = if response.status() == reqwest::StatusCode::NOT_FOUND {
                let (bytes,mime)=crate::image_library::decode(data_url.as_deref().ok_or("原图不可用，云端也没有原文件；请重新选择图片")?,8*1024*1024)?;
                let boundary = format!("wap{}", uuid::Uuid::new_v4().simple());
                let extension = match mime {
                    "image/png" => "png",
                    "image/jpeg" => "jpg",
                    "image/webp" => "webp",
                    _ => "gif",
                };
                let title = name.trim();
                let title = title
                    .rsplit_once('.')
                    .filter(|(_, ext)| {
                        ["png", "jpeg", "jpg", "webp", "gif"]
                            .contains(&ext.to_ascii_lowercase().as_str())
                    })
                    .map_or(title, |(stem, _)| stem);
                let metadata = json!({"id":file_id,"name":format!("{title}.{extension}"),"parents":[folder_id],"mimeType":mime,"appProperties":{"wapPlusUploadId":file_id}});
                let mut body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n").into_bytes();
                body.extend_from_slice(&bytes);
                body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                let total = body.len() as u64;
                let stream_app = app.clone();
                let stream_file_id = file_id.clone();
                let body = std::sync::Arc::new(body);
                let upload_stream = stream::unfold((body, 0usize, 0u8), move |(body, offset, last_percent)| {
                    let app = stream_app.clone();
                    let file_id = stream_file_id.clone();
                    async move {
                        if offset >= body.len() { return None; }
                        let end = (offset + 64 * 1024).min(body.len());
                        let chunk = body[offset..end].to_vec();
                        let percent = ((end as u64 * 100) / total).min(100) as u8;
                        if percent != last_percent {
                            let _ = app.emit("google-drive-upload-progress", json!({"fileId":file_id,"loaded":end,"total":total}));
                        }
                        Some((Ok::<_, std::io::Error>(chunk), (body, end, percent)))
                    }
                });
                json(
                    client
                        .post("https://www.googleapis.com/upload/drive/v3/files")
                        .header(reqwest::header::CONTENT_LENGTH, total)
                        .bearer_auth(&token)
                        .query(&[
                            ("uploadType", "multipart"),
                            ("fields", "id,webViewLink"),
                            ("supportsAllDrives", "true"),
                        ])
                        .header(
                            "Content-Type",
                            format!("multipart/related; boundary={boundary}"),
                        )
                        .body(reqwest::Body::wrap_stream(upload_stream))
                        .send()
                        .await
                        .map_err(|_| "未确认上传结果；请重试以核对原文件，不会重复上传")?,
                )
                .await?
            } else {
                let existing = json(response).await?;
                if existing["appProperties"]["wapPlusUploadId"] != file_id
                    || !existing["parents"]
                        .as_array()
                        .is_some_and(|parents| parents.iter().any(|parent| parent == &folder_id))
                    || existing["trashed"] == true
                    || !existing["mimeType"]
                        .as_str()
                        .unwrap_or("")
                        .starts_with("image/")
                {
                    return Err("已上传文件与本次任务不匹配，已停止共享".into());
                }
                existing
            };
            if value["id"] != file_id {
                return Err("Google 未确认图片上传，请重试核对".into());
            }
            stage(&app, &file_id, "sharing");
            let shared: Result<(), String> = async {
                if mode == "emails" {
                    check_private_parent(
                        &permissions(&client, &token, &folder_id).await?,
                        &email,
                        &emails,
                    )?;
                }
                let existing = permissions(&client, &token, &file_id).await?;
                if mode == "emails" {
                    check_private_parent(&existing, &email, &emails)?;
                }
                let targets: Vec<Value> = if mode == "public" {
                    vec![json!({"type":"anyone","role":"reader","allowFileDiscovery":false})]
                } else {
                    emails
                        .iter()
                        .map(|email| json!({"type":"user","role":"reader","emailAddress":email}))
                        .collect()
                };
                for target in targets {
                    if existing.iter().any(|permission| {
                        permission["deleted"] != true
                            && permission["type"] == target["type"]
                            && (mode == "public"
                                || permission["emailAddress"]
                                    .as_str()
                                    .unwrap_or("")
                                    .eq_ignore_ascii_case(
                                        target["emailAddress"].as_str().unwrap_or(""),
                                    ))
                    }) {
                        continue;
                    }
                    json(
                        permission_request(&client, &token, &file_id, &target)
                            .send()
                            .await
                            .map_err(|_| "图片已上传，但分享设置未确认，请重试")?,
                    )
                    .await?;
                }
                Ok(())
            }
            .await;
            Ok(
                json!({"fileId":file_id,"url":format!("https://drive.google.com/file/d/{file_id}/view"),"shared":shared.is_ok(),"sharingError":shared.err()}),
            )
        }
    }
}

fn validate_jobs(jobs:&[Value])->Result<(),String>{
    if jobs.len()>30{return Err("上传记录超过上限".into());}
    let mut ids=std::collections::HashSet::new();let mut images=0;
    for job in jobs {
        let job_id=job["id"].as_str().ok_or("上传任务编号无效")?;
        uuid::Uuid::parse_str(job_id).map_err(|_|"上传任务编号无效")?;
        if !ids.insert(job_id)||job["title"].as_str().is_none_or(|text|text.trim().is_empty()||text.chars().count()>160)||job["createdAt"].as_str().is_none_or(|date|chrono::DateTime::parse_from_rfc3339(date).is_err())||!matches!(job["stage"].as_str(),Some("reading"|"uploading"|"sharing"|"copying"|"done"|"error"|"copyError")){return Err("上传任务记录无效".into());}
        let config=&job["config"];id(config["folderId"].as_str().ok_or("上传文件夹无效")?)?;
        if config["email"].as_str().is_none_or(|email|email.len()>254||!email.contains('@'))||config["folderName"].as_str().is_none_or(|name|name.len()>1024){return Err("上传账号记录无效".into());}
        let emails:Vec<String>=serde_json::from_value(config["emails"].clone()).map_err(|_|"分享邮箱记录无效")?;
        recipients(config["mode"].as_str().unwrap_or(""),&emails)?;
        if let Some(file)=job["fileId"].as_str(){id(file)?;}
        if let Some(data)=job["data"].as_str(){images+=1;crate::image_library::decode(data,8*1024*1024)?;}
    }
    if images>3{return Err("最多保留三份待恢复原图".into());}Ok(())
}

#[tauri::command(async)]
pub fn google_drive_jobs(app:AppHandle,jobs:Option<Vec<Value>>)->Result<Vec<Value>,String>{
    static LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
    let _guard=LOCK.lock().map_err(|_|"上传记录正在恢复")?;
    let path=app.path().app_data_dir().map_err(|e|e.to_string())?.join("google-drive-jobs.dpapi");
    if let Some(jobs)=jobs {
        validate_jobs(&jobs)?;
        let bytes=serde_json::to_vec(&jobs).map_err(|_|"无法保存上传记录")?;
        if bytes.len()>48*1024*1024{return Err("上传恢复记录超过容量限制".into());}
        let protected=crate::crm_backup::protect_backup(&bytes)?;
        crate::atomic_file::write_atomic(&path,&protected).map_err(|e|format!("上传记录保存失败：{e}"))?;
        return Ok(jobs);
    }
    let file=match std::fs::File::open(path){Ok(file)=>file,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(vec![]),Err(error)=>return Err(format!("无法读取上传记录：{error}"))};
    let mut bytes=Vec::new();file.take(64*1024*1024+1).read_to_end(&mut bytes).map_err(|e|format!("无法读取上传记录：{e}"))?;
    if bytes.len()>64*1024*1024{return Err("上传记录文件超过安全限制".into());}
    #[cfg(windows)]
    if !bytes.starts_with(crate::crm_backup::BACKUP_ENCRYPTION_MAGIC){return Err("上传记录不是有效的加密文件，已保留原文件".into());}
    let bytes=crate::crm_backup::unprotect_backup(&bytes,48*1024*1024)?;
    let jobs:Vec<Value>=serde_json::from_slice(&bytes).map_err(|_|"上传恢复记录无效")?;
    validate_jobs(&jobs)?;Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_records_validate_identity_and_bound_image_retention(){
        let job=json!({"id":uuid::Uuid::new_v4().to_string(),"createdAt":"2026-11-09T12:00:00Z","title":"Portrait","stage":"error","config":{"email":"me@example.com","folderId":"folder_1","folderName":"Images","mode":"emails","emails":["friend@example.com"]},"fileId":"remote_file_1"});
        assert!(validate_jobs(&[job.clone()]).is_ok());assert!(validate_jobs(&[job.clone(),job.clone()]).is_err());
        let mut bad=job.clone();bad["fileId"]="../escape".into();assert!(validate_jobs(&[bad]).is_err());
        let mut bad=job;bad["config"]["emails"]=json!([]);assert!(validate_jobs(&[bad]).is_err());
    }
    #[test]
    fn validates_ids_recipients_and_inherited_sharing_before_upload() {
        assert!(id("root").is_ok());
        assert!(id("x' or true").is_err());
        assert!(id("../file").is_err());
        assert!(recipients("emails", &[]).is_err());
        assert!(recipients("emails", &["bad".into()]).is_err());
        assert!(recipients("emails", &["friend@example.com".into()]).is_ok());
        assert!(check_private_parent(
            &[json!({"type":"anyone","role":"reader"})],
            "me@example.com",
            &["friend@example.com".into()]
        )
        .is_err());
        assert!(check_private_parent(
            &[json!({"type":"user","emailAddress":"someone@example.com","role":"reader"})],
            "me@example.com",
            &["friend@example.com".into()]
        )
        .is_err());
        assert!(check_private_parent(
            &[json!({"type":"user","emailAddress":"friend@example.com","role":"reader"})],
            "me@example.com",
            &["friend@example.com".into()]
        )
        .is_ok());
    }
    #[test]
    fn public_sharing_omits_the_email_parameter_while_recipient_sharing_suppresses_notifications() {
        let client = reqwest::Client::new();
        for kind in ["anyone", "user"] {
            let request = permission_request(
                &client,
                "test-only",
                "file_1",
                &json!({"type":kind,"role":"reader"}),
            )
            .build()
            .unwrap();
            let notification = request
                .url()
                .query_pairs()
                .find(|(key, _)| key == "sendNotificationEmail")
                .map(|(_, value)| value.into_owned());
            assert_eq!(
                notification,
                if kind == "user" {
                    Some("false".into())
                } else {
                    None
                }
            );
            assert_eq!(request.method(), reqwest::Method::POST);
        }
    }
}
