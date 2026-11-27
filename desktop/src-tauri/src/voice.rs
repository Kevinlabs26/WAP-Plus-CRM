//! 本地语音识别（sherpa-onnx，经 sherpa-rs 绑定）。
//!
//! 设计要点：
//! - 音频解码放在前端（WebView2 能解 ogg/opus/mp4 等所有 WhatsApp 语音格式），
//!   Rust 只接收 16k 单声道 PCM i16，转成 f32 喂给识别器，零重解码栈。
//! - 模型通过 Rust 下载并解包到 `app_data_dir/speech-models/<name>/`，
//!   避开 WebView 对 GitHub Release 跨域跳转的限制。
//! - 所有路径操作都校验必须落在 speech-models 根内，防目录穿越。

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Serialize)]
pub struct SpeechModelInfo {
    pub name: String,
    /// 含模型权重的实际目录（解包后可能带一层同名子目录）
    pub dir: String,
    pub ready: bool,
}

#[derive(Serialize)]
pub struct SpeechTranscript {
    pub text: String,
}

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("speech-models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_name(raw: &str) -> Result<String, String> {
    crate::speech_archive::validate_model_name(raw)
}

/// 查找目录内（最多两层深）的 onnx 权重，用于定位模型文件。
fn has_onnx_weight(dir: &Path, depth: u8) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("onnx"))
            {
                return true;
            }
        } else if depth < 2 && has_onnx_weight(&path, depth + 1) {
            return true;
        }
    }
    false
}

/// 两层深度内按文件名谓词找文件
fn find_file<F: Fn(&str) -> bool>(dir: &Path, depth: u8, pred: &F) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if pred(&name) {
                return Some(path);
            }
        } else if depth < 2 {
            if let Some(found) = find_file(&path, depth + 1, pred) {
                return Some(found);
            }
        }
    }
    None
}

/// 定位 whisper 三件套：encoder.onnx / decoder.onnx / tokens.txt
fn resolve_whisper_files(model_root: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    // 解包后常带一层同名子目录，先下钻
    let dir = if has_onnx_weight(model_root, 0) {
        model_root.to_path_buf()
    } else {
        std::fs::read_dir(model_root)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.is_dir() && has_onnx_weight(p, 0))
            .ok_or_else(|| "该目录不是有效的语音模型（未找到 onnx 权重）")?
    };

    let pick = |tag: &str| -> Result<PathBuf, String> {
        find_file(&dir, 0, &|name: &str| {
            name.to_ascii_lowercase().contains(tag) && name.to_ascii_lowercase().ends_with(".onnx")
        })
        .ok_or_else(|| format!("模型缺少 {tag} 文件"))
    };
    let encoder = pick("encoder")?;
    let decoder = pick("decoder")?;
    let tokens = find_file(&dir, 0, &|name: &str| {
        name.eq_ignore_ascii_case("tokens.txt")
            || name.to_ascii_lowercase().ends_with("-tokens.txt")
    })
    .ok_or_else(|| "模型缺少 tokens.txt".to_string())?;
    Ok((encoder, decoder, tokens))
}

#[tauri::command]
pub fn list_speech_models(app: AppHandle) -> Result<Vec<SpeechModelInfo>, String> {
    let root = models_root(&app)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Staging/backup directories are internal and cannot be selected as model names.
        if name.starts_with('.') {
            continue;
        }
        out.push(SpeechModelInfo {
            ready: resolve_whisper_files(&path).is_ok(),
            name,
            dir: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn install_speech_model<R: Read>(root: &Path, safe: &str, archive: R) -> Result<PathBuf, String> {
    let dest = root.join(safe);
    let staging = root.join(format!(".install-{}", uuid::Uuid::new_v4()));
    let backup = root.join(format!(".backup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let decoder = bzip2::read::BzDecoder::new(archive);
        crate::speech_archive::unpack_model(decoder, &staging)?;
        // Validate all required files before replacing a previously working model.
        resolve_whisper_files(&staging)?;
        let exists = dest.try_exists().map_err(|e| e.to_string())?;
        if exists {
            if std::fs::symlink_metadata(&dest)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("模型目录不能是链接".into());
            }
            std::fs::rename(&dest, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(error) = std::fs::rename(&staging, &dest) {
            if exists {
                std::fs::rename(&backup, &dest).map_err(|restore| {
                    format!("{error}；旧模型保留在 {}：{restore}", backup.display())
                })?;
            }
            return Err(error.to_string());
        }
        if exists {
            let _ = std::fs::remove_dir_all(&backup);
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result.map_err(|e| format!("解包失败：{e}"))?;
    Ok(dest)
}

#[derive(Clone, Serialize)]
struct SpeechModelDownloadProgress {
    model: String,
    received: u64,
    total: u64,
}

static SPEECH_MODEL_CHANGES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
const MAX_SPEECH_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;

/// 下载固定来源的模型并流式写入磁盘，WebView 不再直接请求 GitHub。
#[tauri::command]
pub async fn download_speech_model(app: AppHandle, name: String) -> Result<String, String> {
    let safe = sanitize_name(&name)?;
    let url = match safe.as_str() {
        "sherpa-onnx-whisper-tiny" => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2"
        }
        "sherpa-onnx-whisper-base" => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2"
        }
        _ => return Err("不支持的语音模型".into()),
    };
    let permit = SPEECH_MODEL_CHANGES.try_acquire()
        .map_err(|_| "正在安装或删除语音模型，请稍候".to_string())?;
    let root = models_root(&app)?;
    tauri::async_runtime::spawn(async move {
        // Keep the install and its cleanup running if the settings window closes.
        let _permit = permit;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15 * 60))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|e| format!("无法启动模型下载：{e}"))?;
        let response = client.get(url).send().await
            .map_err(|e| format!("模型下载连接失败：{}", e.without_url()))?;
        let path = install_model_response(&root, &safe, response, MAX_SPEECH_ARCHIVE_BYTES, |received, total| {
            let _ = app.emit("speech-model-download-progress", SpeechModelDownloadProgress {
                model: safe.clone(), received, total,
            });
        }).await?;
        Ok(path.to_string_lossy().to_string())
    }).await.map_err(|e| format!("模型下载任务失败：{e}"))?
}

async fn install_model_response(
    root: &Path, safe: &str, mut response: reqwest::Response, max_bytes: u64,
    report: impl Fn(u64, u64),
) -> Result<PathBuf, String> {
    const PROGRESS_INTERVAL: u64 = 512 * 1024;
    if !response.status().is_success() {
        return Err(format!("模型下载失败：HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > max_bytes {
        return Err("模型压缩包超过 512 MiB 上限".into());
    }
    let archive_path = root.join(format!(".download-{}.tar.bz2", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::File::create_new(&archive_path).await
        .map_err(|e| format!("无法保存模型压缩包：{e}"))?;
    let result = async move {
        let mut received = 0_u64;
        let mut last_reported = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("模型下载中断：{}", e.without_url()))?
        {
            received = received
                .checked_add(chunk.len() as u64)
                .ok_or("模型压缩包过大")?;
            if received > max_bytes {
                return Err("模型压缩包超过 512 MiB 上限".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入模型压缩包失败：{e}"))?;
            if received - last_reported >= PROGRESS_INTERVAL {
                report(received, total);
                last_reported = received;
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("写入模型压缩包失败：{e}"))?;
        drop(file);

        if received < 1024 {
            return Err("模型压缩包内容过小，疑似下载失败".into());
        }
        report(received, total);
        Ok::<_, String>(())
    }.await;

    let result = if let Err(error) = result {
        Err(error)
    } else {
        let root = root.to_path_buf();
        let safe = safe.to_string();
        let path = archive_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let archive = std::fs::File::open(path)
                .map_err(|e| format!("无法读取模型压缩包：{e}"))?;
            install_speech_model(&root, &safe, archive)
        }).await.map_err(|e| format!("模型解包任务失败：{e}")).and_then(|result| result)
    };

    let _ = tokio::fs::remove_file(&archive_path).await;
    result
}

#[tauri::command]
pub fn remove_speech_model(app: AppHandle, name: String) -> Result<(), String> {
    let _permit = SPEECH_MODEL_CHANGES.try_acquire()
        .map_err(|_| "正在安装或删除语音模型，请稍候".to_string())?;
    let root = models_root(&app)?;
    let safe = sanitize_name(&name)?;
    let dir = root.join(safe);
    if !dir.starts_with(&root) || !dir.is_dir() {
        return Err("模型目录不存在".into());
    }
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

/// 转写一段 16k 单声道 PCM。
/// language 传 BCP47 短码（如 "fr-FR"，取主子码），空/None 时用 "en"。
#[tauri::command]
pub async fn speech_transcribe(
    app: AppHandle,
    model: String,
    samples: Vec<i16>,
    sample_rate: i32,
    language: Option<String>,
) -> Result<SpeechTranscript, String> {
    use sherpa_rs::whisper::{WhisperConfig, WhisperRecognizer};

    if samples.is_empty() {
        return Err("没有收到音频数据".into());
    }
    if sample_rate != 16000 {
        return Err("仅支持 16kHz 采样率（前端已统一重采样）".into());
    }

    let permit = SPEECH_WORKERS
        .try_acquire()
        .map_err(|_| "正在转写另一条语音，请完成后重试".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the permit until native inference actually finishes, even if IPC is cancelled.
        let _permit = permit;

        let root = models_root(&app)?;
        let safe = sanitize_name(&model)?;
        let model_root = root.join(&safe);
        if !model_root.starts_with(&root) || !model_root.is_dir() {
            return Err(format!("模型目录不存在：{safe}"));
        }
        let (encoder, decoder, tokens) = resolve_whisper_files(&model_root)?;

        let language_main = language
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| s.split('-').next())
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| "en".to_string());

        let config = WhisperConfig {
            encoder: encoder.to_string_lossy().to_string(),
            decoder: decoder.to_string_lossy().to_string(),
            tokens: tokens.to_string_lossy().to_string(),
            language: language_main,
            bpe_vocab: None,
            provider: None,
            num_threads: Some(2),
            debug: false,
        };

        let mut recognizer =
            WhisperRecognizer::new(config).map_err(|e| format!("加载本地模型失败：{e}"))?;

        // i16 PCM → f32 归一化（识别器固定吃 16k 单声道 f32）
        let pcm: Vec<f32> = samples.iter().map(|&s| s as f32 / 32768.0).collect();
        let result = recognizer.transcribe(sample_rate as u32, pcm);
        Ok(SpeechTranscript { text: result.text })
    })
    .await
    .map_err(|e| format!("本地转写任务失败：{e}"))?
}

static SPEECH_WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn model_download_bounds_streams_and_preserves_existing_models_on_failure() {
        use tokio::io::AsyncReadExt;

        let root = std::env::temp_dir().join(format!("wap-speech-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let name = "sherpa-onnx-whisper-tiny";
        let installed = root.join(name);
        std::fs::create_dir(&installed).unwrap();
        std::fs::write(installed.join("tokens.txt"), "existing").unwrap();

        for (headers, body, max_bytes, expected) in [
            ("Content-Length: 1025", vec![], 1024, "512 MiB"),
            ("Transfer-Encoding: chunked", b"401\r\n".iter().copied()
                .chain(std::iter::repeat_n(b'x', 1025)).chain(b"\r\n0\r\n\r\n".iter().copied()).collect(), 1024, "512 MiB"),
            ("Content-Length: 2048", vec![b'x'; 1024], 2048, "下载中断"),
            ("Content-Length: 1024", vec![b'x'; 1024], 2048, "解包失败"),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                socket.write_all(format!("HTTP/1.1 200 OK\r\nConnection: close\r\n{headers}\r\n\r\n").as_bytes()).await.unwrap();
                socket.write_all(&body).await.unwrap();
            });
            let response = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(5))
                .build().unwrap().get(format!("http://{address}")).send().await.unwrap();
            let error = install_model_response(&root, name, response, max_bytes, |_, _| {}).await.unwrap_err();
            server.await.unwrap();
            assert!(error.contains(expected), "{error}");
            assert_eq!(std::fs::read_to_string(installed.join("tokens.txt")).unwrap(), "existing");
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        }
        for (name, prefix) in [(name, "tiny"), ("sherpa-onnx-whisper-base", "base")] {
            let mut tar = tar::Builder::new(bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast()));
            for file in [format!("{prefix}-encoder.onnx"), format!("{prefix}-decoder.onnx"), format!("{prefix}-tokens.txt")] {
                let mut header = tar::Header::new_gnu();
                header.set_size(7);
                header.set_mode(0o600);
                header.set_cksum();
                tar.append_data(&mut header, Path::new(name).join(file), &b"fixture"[..]).unwrap();
            }
            let archive = tar.into_inner().unwrap().finish().unwrap();
            let model = install_speech_model(&root, name, archive.as_slice()).unwrap();
            assert!(resolve_whisper_files(&model).is_ok());
        }
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with('.')));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_transcription_has_one_worker_and_releases_it() {
        let first = SPEECH_WORKERS.try_acquire().unwrap();
        assert!(SPEECH_WORKERS.try_acquire().is_err());
        drop(first);
        assert!(SPEECH_WORKERS.try_acquire().is_ok());
    }

    #[test]
    fn resolves_official_and_legacy_whisper_models_and_rejects_incomplete_models() {
        let root =
            std::env::temp_dir().join(format!("bridgecrm-whisper-check-{}", uuid::Uuid::new_v4()));
        let nested = root.join("sherpa-onnx-whisper-tiny");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("tiny-encoder.int8.onnx"), b"fixture").unwrap();
        assert!(resolve_whisper_files(&root).is_err());
        std::fs::write(nested.join("tiny-decoder.int8.onnx"), b"fixture").unwrap();
        assert!(resolve_whisper_files(&root).is_err());
        for name in ["tiny-tokens.txt", "base-tokens.txt", "tokens.txt"] {
            let tokens = nested.join(name);
            std::fs::write(&tokens, b"fixture").unwrap();
            let (encoder, decoder, found_tokens) = resolve_whisper_files(&root).unwrap();
            assert!(encoder.ends_with("tiny-encoder.int8.onnx"));
            assert!(decoder.ends_with("tiny-decoder.int8.onnx"));
            assert_eq!(found_tokens, tokens);
            std::fs::remove_file(tokens).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();

        // Optional integration check with the official archive, using the unchanged product engine.
        if let Ok(model_dir) = std::env::var("BRIDGECRM_VERIFY_MODEL_DIR") {
            let (encoder, decoder, tokens) = resolve_whisper_files(Path::new(&model_dir)).unwrap();
            let mut recognizer =
                sherpa_rs::whisper::WhisperRecognizer::new(sherpa_rs::whisper::WhisperConfig {
                    encoder: encoder.to_string_lossy().into_owned(),
                    decoder: decoder.to_string_lossy().into_owned(),
                    tokens: tokens.to_string_lossy().into_owned(),
                    num_threads: Some(2),
                    ..Default::default()
                })
                .unwrap();
            let wav = Path::new(&model_dir).join("test_wavs/0.wav");
            let (samples, rate) = sherpa_rs::read_audio_file(&wav.to_string_lossy()).unwrap();
            let result = recognizer.transcribe(rate, samples);
            assert!(!result.text.trim().is_empty());
            println!(
                "Current product engine resolved the official model and transcribed its sample"
            );
        }
    }
}
