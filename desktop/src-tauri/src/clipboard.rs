use base64::Engine;
use png::{ColorType, Decoder, Limits, Transformations};
use std::io::Cursor;
use std::thread::sleep;
use std::time::Duration;
use windows_sys::Win32::Foundation::{GlobalFree, HWND};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

const MAX_PNG_BYTES: usize = 24 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 16_000_000;
const DIBV5_HEADER_SIZE: usize = 124;
const CF_DIB: u32 = 8;
const CF_DIBV5: u32 = 17;
const BI_RGB: u32 = 0;
const BI_BITFIELDS: u32 = 3;
const LCS_SRGB: u32 = 0x7352_4742;
const LCS_GM_IMAGES: u32 = 4;

pub fn write_png(hwnd: HWND, png_base64: &str) -> Result<(), String> {
    if png_base64.len() > MAX_PNG_BYTES * 4 / 3 + 8 {
        return Err("图片超过 24 MB，无法复制".into());
    }
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64)
        .map_err(|e| format!("图片数据解码失败：{e}"))?;
    if png_bytes.len() > MAX_PNG_BYTES || !png_bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("图片不是有效的 PNG 数据或超过 24 MB".into());
    }

    let (width, height, rgba) = decode_png(&png_bytes)?;
    let dibv5 = make_dibv5(width, height, &rgba)?;
    let dib = make_dib(width, height, &rgba)?;
    let png_format =
        unsafe { RegisterClipboardFormatW([b'P' as u16, b'N' as u16, b'G' as u16, 0].as_ptr()) };
    if png_format == 0 {
        return Err("Windows 无法注册 PNG 剪贴板格式".into());
    }

    let mut opened = false;
    for _ in 0..10 {
        if unsafe { OpenClipboard(hwnd) } != 0 {
            opened = true;
            break;
        }
        sleep(Duration::from_millis(20));
    }
    if !opened {
        return Err("Windows 剪贴板正被占用，请稍后重试".into());
    }

    let result = unsafe {
        if EmptyClipboard() == 0 {
            Err("Windows 无法清空剪贴板".to_string())
        } else {
            let wrote_v5 = set_clipboard_data(CF_DIBV5, &dibv5);
            let wrote_dib = set_clipboard_data(CF_DIB, &dib);
            let wrote_png = set_clipboard_data(png_format, &png_bytes);
            if wrote_v5 || wrote_dib || wrote_png {
                Ok(())
            } else {
                Err("Windows 拒绝将图片写入剪贴板".to_string())
            }
        }
    };
    unsafe { CloseClipboard() };
    result
}

fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = Decoder::new_with_limits(
        Cursor::new(bytes),
        Limits {
            bytes: MAX_IMAGE_PIXELS as usize * 4,
        },
    );
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("PNG 图片读取失败：{e}"))?;
    let canvas_pixels = u64::from(reader.info().width) * u64::from(reader.info().height);
    if canvas_pixels == 0 || canvas_pixels > MAX_IMAGE_PIXELS {
        return Err("图片分辨率超过复制限制（1600 万像素）".into());
    }
    let mut decoded = vec![0; reader.output_buffer_size().ok_or("PNG 图片尺寸无效")?];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|e| format!("PNG 图片解码失败：{e}"))?;
    let width = frame.width;
    let height = frame.height;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err("PNG 帧分辨率无效".into());
    }
    decoded.truncate(frame.buffer_size());
    let mut rgba = Vec::with_capacity(pixels as usize * 4);
    for y in 0..height as usize {
        let row = &decoded[y * frame.line_size..(y + 1) * frame.line_size];
        match frame.color_type {
            ColorType::Grayscale => {
                for &gray in row {
                    rgba.extend_from_slice(&[gray, gray, gray, 255]);
                }
            }
            ColorType::Rgb => {
                for pixel in row.chunks_exact(3) {
                    rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
                }
            }
            ColorType::GrayscaleAlpha => {
                for pixel in row.chunks_exact(2) {
                    rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
                }
            }
            ColorType::Rgba => rgba.extend_from_slice(row),
            ColorType::Indexed => return Err("PNG 调色板无法展开".into()),
        }
    }
    Ok((width, height, rgba))
}

fn make_dibv5(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let image_size = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("图片尺寸溢出")?;
    if rgba.len() != image_size || image_size > MAX_IMAGE_PIXELS as usize * 4 {
        return Err("图片尺寸无效".into());
    }
    let mut dib = vec![0; DIBV5_HEADER_SIZE + image_size];
    put_u32(&mut dib, 0, DIBV5_HEADER_SIZE as u32);
    put_i32(&mut dib, 4, width as i32);
    put_i32(&mut dib, 8, -(height as i32));
    put_u16(&mut dib, 12, 1);
    put_u16(&mut dib, 14, 32);
    put_u32(&mut dib, 16, BI_BITFIELDS);
    put_u32(&mut dib, 20, image_size as u32);
    put_u32(&mut dib, 40, 0x00ff_0000);
    put_u32(&mut dib, 44, 0x0000_ff00);
    put_u32(&mut dib, 48, 0x0000_00ff);
    put_u32(&mut dib, 52, 0xff00_0000);
    put_u32(&mut dib, 56, LCS_SRGB);
    put_u32(&mut dib, 108, LCS_GM_IMAGES);
    for (pixel, bgra) in rgba
        .chunks_exact(4)
        .zip(dib[DIBV5_HEADER_SIZE..].chunks_exact_mut(4))
    {
        bgra.copy_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }
    Ok(dib)
}

fn make_dib(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let v5 = make_dibv5(width, height, rgba)?;
    let mut dib = vec![0; 40 + rgba.len()];
    put_u32(&mut dib, 0, 40);
    put_i32(&mut dib, 4, width as i32);
    put_i32(&mut dib, 8, -(height as i32));
    put_u16(&mut dib, 12, 1);
    put_u16(&mut dib, 14, 32);
    put_u32(&mut dib, 16, BI_RGB);
    put_u32(&mut dib, 20, rgba.len() as u32);
    dib[40..].copy_from_slice(&v5[DIBV5_HEADER_SIZE..]);
    Ok(dib)
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_i32(bytes: &mut [u8], offset: usize, value: i32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

unsafe fn set_clipboard_data(format: u32, bytes: &[u8]) -> bool {
    let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
    if memory.is_null() {
        return false;
    }
    let destination = GlobalLock(memory);
    if destination.is_null() {
        GlobalFree(memory);
        return false;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), destination.cast(), bytes.len());
    GlobalUnlock(memory);
    if SetClipboardData(format, memory).is_null() {
        GlobalFree(memory);
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_pixels_and_alpha_survive_windows_bitmap_conversion() {
        let rgba = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0];
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 2, 2);
            encoder.set_color(ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&rgba)
                .unwrap();
        }
        let (width, height, decoded) = decode_png(&png).unwrap();
        assert_eq!((width, height), (2, 2));
        assert_eq!(decoded, rgba);
        let v5 = make_dibv5(width, height, &decoded).unwrap();
        assert_eq!(&v5[0..4], &124u32.to_le_bytes());
        assert_eq!(&v5[8..12], &(-2i32).to_le_bytes());
        assert_eq!(&v5[52..56], &0xff00_0000u32.to_le_bytes());
        let bgra = [0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 255, 0, 0, 0, 0];
        assert_eq!(&v5[124..], &bgra);
        let dib = make_dib(width, height, &decoded).unwrap();
        assert_eq!(&dib[0..4], &40u32.to_le_bytes());
        assert_eq!(&dib[16..20], &BI_RGB.to_le_bytes());
        assert_eq!(&dib[40..], &bgra);
    }

    #[test]
    fn invalid_images_are_rejected_before_clipboard_access() {
        assert!(write_png(std::ptr::null_mut(), "broken").is_err());
        assert!(decode_png(b"not a PNG").is_err());
        assert!(make_dibv5(2, 2, &[0; 4]).is_err());
        assert!(make_dibv5(u32::MAX, u32::MAX, &[]).is_err());
    }
}
