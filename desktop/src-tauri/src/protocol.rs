use serde_json::Value;

/// Constructs the Android envelope shared with `shared/protocol.ts`.
pub fn make_envelope(msg_type: &str, device_id: Option<&str>, payload: Value) -> Value {
    serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "type": msg_type,
        "ts": chrono::Utc::now().timestamp_millis(),
        "deviceId": device_id,
        "payload": payload,
    })
}

pub fn response_ok(value: &Value) -> bool {
    value.pointer("/payload/ok").and_then(Value::as_bool) == Some(true)
}

pub fn response_error(value: &Value) -> String {
    value
        .pointer("/payload/message")
        .or_else(|| value.pointer("/payload/error"))
        .and_then(Value::as_str)
        .unwrap_or("Android command failed")
        .to_string()
}
