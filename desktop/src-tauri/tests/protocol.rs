#[path = "../src/protocol.rs"]
mod protocol;

#[test]
fn reads_android_responses() {
    let ok = serde_json::json!({ "payload": { "ok": true } });
    let message = serde_json::json!({ "payload": { "message": "phone missing" } });
    let error = serde_json::json!({ "payload": { "error": "invalid payload" } });

    assert!(protocol::response_ok(&ok));
    assert!(!protocol::response_ok(&message));
    assert_eq!(protocol::response_error(&message), "phone missing");
    assert_eq!(protocol::response_error(&error), "invalid payload");
}

#[test]
fn makes_android_envelope() {
    let envelope = protocol::make_envelope(
        "wa.open_and_send",
        Some("bridge-1"),
        serde_json::json!({ "text": "hello" }),
    );

    assert!(envelope["id"].as_str().is_some_and(|id| !id.is_empty()));
    assert_eq!(envelope["type"], "wa.open_and_send");
    assert!(envelope["ts"].as_i64().is_some_and(|timestamp| timestamp > 0));
    assert_eq!(envelope["deviceId"], "bridge-1");
    assert_eq!(envelope["payload"]["text"], "hello");
}
