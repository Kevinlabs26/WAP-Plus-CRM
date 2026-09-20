mod baileys;
mod bridge;
mod commands;
mod db;
mod protocol;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BridgeState::default())
        .manage(BaileysState::default())
        .setup(|app| {
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
            baileys::baileys_runtime,
            baileys::baileys_stop_account,
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
            commands::read_dropped_file,
            commands::show_windows_branded_notification,
            commands::db_load,
            commands::db_save,
            commands::db_clear,
            commands::db_clear_chat_messages,
            commands::db_clear_remote_messages,
            commands::db_delete_messages_by_keys,
            commands::db_info,
            commands::db_load_full_history,
            commands::db_load_messages_page,
            commands::db_search_messages,
            commands::db_get_message,
            commands::secure_load_secrets,
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
