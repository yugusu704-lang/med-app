mod bootstrap;
mod commands;
mod db;
mod models;
mod practice;
mod startup;

#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup::init_logging();
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(bootstrap::android_plugin());
    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Wry can log a native creation error yet return a registered window.
            // Check the actual HWND so startup cannot silently leave a headless app.
            #[cfg(windows)]
            {
                let native_window = app
                    .get_webview_window("main")
                    .ok_or_else(|| "主窗口未注册".to_owned())
                    .and_then(|window| window.hwnd().map_err(|error| error.to_string()));
                if let Err(error) = native_window {
                    log::error!(
                        "主窗口初始化失败：{}。请检查启动日志；Windows Low 完整性进程需要可写的 WebView2 数据目录，且窗口应从用户默认桌面启动。",
                        startup::last_runtime_error().unwrap_or(error)
                    );
                    // Returning Err here makes Tauri panic. With panic=abort,
                    // Windows Error Reporting can hold the headless process open.
                    std::process::exit(1);
                }
            }
            bootstrap::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_subjects,
            commands::get_units,
            commands::get_quiz_ids,
            commands::get_question,
            commands::get_questions,
            commands::search_questions,
            commands::get_stats,
            bootstrap::get_startup_status,
            bootstrap::retry_startup,
            practice::start_quiz_session,
            practice::get_quiz_session,
            practice::resume_quiz_session,
            practice::list_active_sessions,
            practice::save_quiz_draft,
            practice::submit_quiz_answer,
            practice::finish_quiz_session,
            practice::set_bookmark,
            practice::list_bookmarks,
            practice::list_mistakes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
