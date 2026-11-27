use base64::Engine;
use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString};
use objc2_foundation::{NSData, NSString};
use std::io::Cursor;

const MAX_PNG_BYTES: usize = 24 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 16_000_000;

pub fn write_text(text: &str) -> Result<(), String> {
    if text.len() > 8192 || text.contains('\0') {
        return Err("复制文本无效或过长".into());
    }
    let text = NSString::from_str(text);
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    if !pasteboard.setString_forType(&text, unsafe { NSPasteboardTypeString }) {
        return Err("无法写入 Mac 剪贴板，请重试".into());
    }
    Ok(())
}

pub fn write_png(png_base64: &str) -> Result<(), String> {
    if png_base64.len() > MAX_PNG_BYTES * 4 / 3 + 8 {
        return Err("图片超过 24 MB，无法复制".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64)
        .map_err(|_| "图片数据解码失败")?;
    if bytes.len() > MAX_PNG_BYTES {
        return Err("图片超过 24 MB，无法复制".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes.as_slice()));
    let info = decoder.read_header_info().map_err(|_| "图片不是有效的 PNG 数据")?;
    let pixels = u64::from(info.width) * u64::from(info.height);
    if pixels == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err("图片分辨率超过复制限制（1600 万像素）".into());
    }
    let data = NSData::with_bytes(&bytes);
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    if !pasteboard.setData_forType(Some(&data), unsafe { NSPasteboardTypePNG }) {
        return Err("无法将图片写入 Mac 剪贴板，请重试".into());
    }
    Ok(())
}
