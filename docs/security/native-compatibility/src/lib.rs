// Compile the actual application database code and run its existing regression tests.
#[path = "../../../../desktop/src-tauri/src/db.rs"]
mod db;

#[test]
fn sqlite_runtime_version_and_fts5_are_available() {
    println!("Candidate bundled SQLite: {}", rusqlite::version());
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE VIRTUAL TABLE candidate_fts USING fts5(body); INSERT INTO candidate_fts VALUES ('hello bridge');").unwrap();
    let count: i64 = conn.query_row("SELECT count(*) FROM candidate_fts WHERE candidate_fts MATCH ?1", ["hello"], |row| row.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[cfg(feature = "speech")]
#[test]
fn official_engine_loads_existing_tiny_model_and_decodes_sample() {
    use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineWhisperModelConfig, Wave};
    let root = std::env::var("BRIDGECRM_COMPAT_MODEL_DIR").expect("isolated model directory required");
    let file = |name: &str| std::path::Path::new(&root).join(name).to_string_lossy().into_owned();
    println!("Candidate sherpa: {}; ONNX Runtime: {}", sherpa_onnx::version(), sherpa_onnx::onnxruntime_version());
    assert_eq!(sherpa_onnx::version(), "1.13.8");
    for suffix in ["", ".int8"] {
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.whisper = OfflineWhisperModelConfig {
            encoder: Some(file(&format!("tiny-encoder{suffix}.onnx"))),
            decoder: Some(file(&format!("tiny-decoder{suffix}.onnx"))),
            language: Some("en".into()), task: Some("transcribe".into()), ..Default::default()
        };
        config.model_config.tokens = Some(file("tiny-tokens.txt"));
        config.model_config.num_threads = 2;
        config.model_config.provider = Some("cpu".into());
        let recognizer = OfflineRecognizer::create(&config).expect("existing tiny model should load");
        let wave = Wave::read(&file("test_wavs/0.wav")).expect("official sample wav should load");
        let stream = recognizer.create_stream();
        stream.accept_waveform(wave.sample_rate(), wave.samples());
        recognizer.decode(&stream);
        let result = stream.get_result().expect("recognizer result");
        assert!(!result.text.trim().is_empty());
        println!("Official sample variant {suffix:?} decoded successfully ({} characters)", result.text.chars().count());
    }
}
