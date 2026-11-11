mod account_id;
mod app_lock;
mod app_instance;
mod atomic_file;
mod baileys;
mod bridge;
#[cfg(windows)]
mod clipboard;
mod clone_calls;
mod commands;
mod crm_backup;
mod db;
mod db_encryption;
mod dpapi;
mod google_sheets;
mod google_drive;
mod image_library;
mod image_library_import;
mod muse_web;
mod protocol;
mod speech_archive;
mod vertex_ai;
mod voice;

use baileys::BaileysState;
use bridge::BridgeState;
use db::DbState;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "windows")]
fn configure_webview2_speech_compatibility() {
    const FEATURE: &str = "msSpeechRecognitionServiceUseCetoService";
    const ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

    // Recent WebView2 Runtime builds can return SpeechRecognition's `network`
    // error when the Ceto speech endpoint rejects the connection. Keep using
    // the previous speech service until the WebView2 regression is resolved.
    let existing = std::env::var(ENV).unwrap_or_default();
    let mut args = Vec::new();
    let mut disabled_features = Vec::new();
    let mut first_disable_arg = None;
    for arg in existing.split_whitespace() {
        if let Some(features) = arg.strip_prefix("--disable-features=") {
            if first_disable_arg.is_none() {
                first_disable_arg = Some(args.len());
            }
            disabled_features.extend(
                features
                    .split(',')
                    .filter(|feature| !feature.is_empty())
                    .map(str::to_owned),
            );
        } else {
            args.push(arg.to_owned());
        }
    }

    if !disabled_features.iter().any(|feature| feature == FEATURE) {
        disabled_features.push(FEATURE.to_owned());
    }
    let disable_arg = format!("--disable-features={}", disabled_features.join(","));
    let insert_at = first_disable_arg.unwrap_or(args.len()).min(args.len());
    args.insert(insert_at, disable_arg);
    std::env::set_var(ENV, args.join(" "));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    #[cfg(target_os = "windows")]
    configure_webview2_speech_compatibility();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BridgeState::default())
        .manage(BaileysState::default())
        .manage(google_sheets::GoogleState::default())
        .manage(vertex_ai::VertexState::default())
        .manage(clone_calls::CloneCallsState::default())
        .manage(muse_web::MuseWebState::default())
        .setup(|app| {
            app.manage(app_instance::AppInstanceGuard::acquire(&app.path().app_data_dir()?)?);
            let conn = db::open_db(app.handle())?;
            app.manage(DbState(Mutex::new(conn)));

            // 读线程 / connect 可向 WebView 推送 bridge://event 与 bridge://status
            #[cfg(not(test))]
            {
                let bridge = app.state::<BridgeState>();
                bridge.attach_app(app.handle().clone());
            }

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }

            let open = MenuItem::with_id(app, "open", "打开 WAP Plus CRM", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("WAP Plus CRM · WhatsApp 后台连接中")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_lock::app_lock_status,
            app_lock::app_lock_create,
            app_lock::app_lock_verify,
            app_lock::app_lock_change,
            clone_calls::clone_call_setup,
            clone_calls::clone_call_bind,
            clone_calls::clone_call_verify,
            clone_calls::clone_call_open,
            clone_calls::clone_call_open_link,
            clone_calls::clone_call_start,
            clone_calls::clone_call_cancel,
            muse_web::muse_web_open,
            muse_web::muse_web_status,
            muse_web::muse_web_generate,
            muse_web::muse_web_collect_media,
            muse_web::muse_web_cancel,
            vertex_ai::vertex_ai_status,
            vertex_ai::vertex_ai_save,
            vertex_ai::vertex_ai_remove,
            vertex_ai::vertex_ai_access_token,
            baileys::baileys_runtime,
            baileys::baileys_stop_account,
            baileys::baileys_reset_account,
            baileys::baileys_stop_all,
            baileys::baileys_cancel_update,
            commands::list_adb_devices,
            commands::adb_forward,
            commands::phone_screenshot,
            commands::bridge_status,
            commands::bridge_connect,
            commands::bridge_disconnect,
            commands::bridge_drain_events,
            commands::bridge_send_raw,
            commands::save_phone_contact,
            commands::save_phone_contacts,
            commands::open_whatsapp_chat,
            commands::sync_whatsapp_conversations,
            commands::search_whatsapp_contact,
            commands::send_whatsapp_media,
            commands::show_overlay_card,
            commands::hide_overlay,
            commands::type_and_send,
            commands::get_app_info,
            commands::save_chat_media,
            commands::open_chat_media_folder,
            commands::read_dropped_file,
            commands::read_dropped_video,
            commands::read_dropped_audio,
            commands::clipboard_write_image,
            commands::clipboard_write_text,
            commands::show_windows_branded_notification,
            google_drive::google_drive,
            google_drive::google_drive_jobs,
            commands::db_load,
            commands::db_save,
            commands::db_clear,
            commands::db_clear_chat_messages,
            commands::db_clear_remote_messages,
            commands::db_delete_messages_by_keys,
            commands::db_update_message_acks,
            commands::db_info,
            commands::app_storage_usage,
            crm_backup::crm_backup_status,
            crm_backup::crm_backup_save,
            crm_backup::crm_backup_latest,
            crm_backup::crm_backup_latest_info,
            crm_backup::crm_backup_read_part,
            image_library::image_library,
            commands::db_load_full_history,
            commands::db_load_messages_page,
            commands::db_chats_with_inbound,
            commands::db_search_messages,
            commands::db_get_message,
            commands::secure_load_secrets,
            google_sheets::google_sheets_status,
            google_sheets::google_sheets_prepare_connect,
            google_sheets::google_sheets_connect,
            google_sheets::google_sheets_cancel_connect,
            google_sheets::google_sheets_disconnect,
            google_sheets::google_sheets_read,
            google_sheets::google_sheets_read_grid,
            google_sheets::google_docs_read,
            google_sheets::google_sheets_update_cell,
            google_sheets::google_sheets_update_cells,
            google_sheets::google_sheets_append_row,
            commands::secure_save_secrets,
            commands::typing_diagnostic_write,
            voice::list_speech_models,
            voice::save_speech_model,
            voice::remove_speech_model,
            voice::speech_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WAP Plus CRM");
}
