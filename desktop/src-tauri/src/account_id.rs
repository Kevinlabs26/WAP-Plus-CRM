pub fn validate_account_id(raw: &str) -> Result<String, String> {
    // Windows 会话目录大小写不敏感；只接受规范的小写 ID，禁止改写或截断。
    let reserved = matches!(raw, "con" | "prn" | "aux" | "nul")
        || (raw.len() == 4 && (raw.starts_with("com") || raw.starts_with("lpt"))
            && matches!(raw.as_bytes()[3], b'1'..=b'9'));
    if raw.is_empty() || raw.len() > 64 || reserved
        || !raw.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_') {
        return Err("账号 ID 无效：需为 1–64 位小写字母、数字、短横线或下划线".into());
    }
    Ok(raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_colliding_paths_without_rewriting_ids() {
        assert_eq!(validate_account_id("wa-default").unwrap(), "wa-default");
        for id in ["", "wa/a", "wa?a", "wa-A", " wa-a", "../wa-a", "con", "com1", &"a".repeat(65)] {
            assert!(validate_account_id(id).is_err(), "accepted {id}");
        }
    }
}
