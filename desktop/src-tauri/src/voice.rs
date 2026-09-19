//! 本地语音识别（sherpa-onnx，经 sherpa-rs 绑定）。
//!
//! 设计要点：
//! - 音频解码放在前端（WebView2 能解 ogg/opus/mp4 等所有 WhatsApp 语音格式），
//!   Rust 只接收 16k 单声道 PCM i16，转成 f32 喂给识别器，零重解码栈。
//! - 模型由前端下载 .tar.bz2 后交给 [`save_speech_model`] 解包到
//!   `app_data_dir/speech-models/<name>/`，Rust 不做网络请求。
//! - 所有路径操作都校验必须落在 speech-models 根内，防目录穿越。

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed.starts_with('.') {
        return Err("非法的模型名".into());
    }
    Ok(trimmed.to_string())
}

/// 目录里（最多两层深）是否存在 onnx 权重 —— 有即认为模型可用。
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
            name.to_ascii_lowercase().contains(tag)
                && name.to_ascii_lowercase().ends_with(".onnx")
        })
        .ok_or_else(|| format!("模型缺少 {tag} 文件"))
    };
    let encoder = pick("encoder")?;
    let decoder = pick("decoder")?;
    let tokens = find_file(&dir, 0, &|name: &str| {
        name.eq_ignore_ascii_case("tokens.txt")
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
        out.push(SpeechModelInfo {
            ready: has_onnx_weight(&path, 0),
            name,
            dir: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 前端已下载好的 .tar.bz2 压缩包字节流；解包进 speech-models/<name>/。
/// 模型上百 MB：走 Tauri 原始字节通道（Uint8Array → InvokeBody::Raw），
/// 名称放 x-speech-model-name 头，避免 JSON 数字数组膨胀数倍。
#[tauri::command]
pub fn save_speech_model(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let name = request
        .headers()
        .get("x-speech-model-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let archive: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.to_vec(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|_| "请求体不是有效字节数组".to_string())?,
    };
    if archive.len() < 1024 {
        return Err("压缩包内容过小，疑似下载失败".into());
    }
    let safe = sanitize_name(&name)?;
    let root = models_root(&app)?;
    let dest = root.join(&safe);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let archive_path = root.join(format!("{safe}.tar.bz2"));
    std::fs::write(&archive_path, &archive).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
    let decoder = bzip2::read::BzDecoder::new(std::io::BufReader::new(file));
    tar::Archive::new(decoder)
        .unpack(&dest)
        .map_err(|e| format!("解包失败：{e}"))?;
    let _ = std::fs::remove_file(&archive_path);

    if !has_onnx_weight(&dest, 0) {
        let _ = std::fs::remove_dir_all(&dest);
        return Err("压缩包里没有找到 onnx 模型文件".into());
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn remove_speech_model(app: AppHandle, name: String) -> Result<(), String> {
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
pub fn speech_transcribe(
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
}
