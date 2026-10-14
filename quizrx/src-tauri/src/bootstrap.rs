//! Prepare APK assets off the UI thread and expose a recoverable startup state.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    phase: String,
    message: String,
    copied_bytes: u64,
    total_bytes: u64,
    error: Option<String>,
}
pub struct StartupState {
    status: Mutex<StartupStatus>,
    busy: AtomicBool,
}
fn update(app: &AppHandle, phase: &str, message: &str, copied: u64, error: Option<String>) {
    if let Ok(mut status) = app.state::<StartupState>().status.lock() {
        *status = StartupStatus {
            phase: phase.into(),
            message: message.into(),
            copied_bytes: copied,
            total_bytes: env!("QUIZRX_BANK_SIZE").parse().unwrap_or(0),
            error,
        };
    }
}
#[tauri::command]
pub fn get_startup_status(state: State<StartupState>) -> Result<StartupStatus, String> {
    state
        .status
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn retry_startup(app: AppHandle) {
    if app.try_state::<crate::db::DbState>().is_none() {
        spawn(&app);
    }
}
pub fn start(app: &AppHandle) {
    app.manage(StartupState {
        status: Mutex::new(StartupStatus {
            phase: "preparing".into(),
            message: "正在准备离线题库".into(),
            copied_bytes: 0,
            total_bytes: env!("QUIZRX_BANK_SIZE").parse().unwrap_or(0),
            error: None,
        }),
        busy: AtomicBool::new(false),
    });
    spawn(app);
}
fn spawn(app: &AppHandle) {
    if app
        .state::<StartupState>()
        .busy
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        update(&app, "preparing", "正在准备离线题库", 0, None);
        match initialize(&app) {
            Ok(()) => update(
                &app,
                "ready",
                "离线题库已就绪",
                env!("QUIZRX_BANK_SIZE").parse().unwrap_or(0),
                None,
            ),
            Err(error) => {
                log::error!("数据初始化失败：{error}");
                update(&app, "error", "题库准备失败", 0, Some(error));
            }
        }
        app.state::<StartupState>()
            .busy
            .store(false, Ordering::SeqCst);
    });
}
fn initialize(app: &AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    let directory = std::env::var_os("QUIZRX_DATA_DIR")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| app.path().app_data_dir().map_err(|e| e.to_string()))?;
    #[cfg(target_os = "android")]
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    crate::startup::configure_file(&directory.join("logs"));
    #[cfg(not(target_os = "android"))]
    let bank = crate::db::open_db(app)?;
    #[cfg(target_os = "android")]
    let bank = prepare_android_bank(app, &directory)?;
    let user = crate::practice::open_user_db(&directory.join("user.sqlite"))?;
    app.manage(crate::db::DbState(Mutex::new(bank)));
    app.manage(crate::practice::UserDbState(Mutex::new(user)));
    Ok(())
}
#[cfg(target_os = "android")]
fn prepare_android_bank(
    app: &AppHandle,
    directory: &std::path::Path,
) -> Result<rusqlite::Connection, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let banks = directory.join("banks");
    std::fs::create_dir_all(&banks).map_err(|e| e.to_string())?;
    let destination = banks.join(format!("quizbank-{}.db", env!("QUIZRX_BANK_SHA256")));
    let expected_size: u64 = env!("QUIZRX_BANK_SIZE")
        .parse()
        .map_err(|e: std::num::ParseIntError| e.to_string())?;
    let open = |path: &PathBuf| -> Result<rusqlite::Connection, String> {
        let conn =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| e.to_string())?;
        crate::db::check_schema(&conn, path)?;
        Ok(conn)
    };
    if destination
        .metadata()
        .is_ok_and(|m| m.len() == expected_size)
    {
        let mut file = std::fs::File::open(&destination).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        if format!("{:x}", hash.finalize()) == env!("QUIZRX_BANK_SHA256") {
            return open(&destination);
        }
    }
    update(app, "copying", "首次启动正在安装离线题库", 0, None);
    let temporary = destination.with_extension("part");
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Copied {
        copied_bytes: u64,
    }
    let result = app
        .state::<BankPlugin>()
        .0
        .run_mobile_plugin::<Copied>(
            "copyBankAsset",
            serde_json::json!({"destination": temporary.to_string_lossy()}),
        )
        .map_err(|e| e.to_string())?;
    if result.copied_bytes != expected_size {
        return Err("APK 题库长度校验失败".into());
    }
    let mut input = std::fs::File::open(&temporary).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
        bytes += count as u64;
        update(app, "copying", "首次启动正在安装离线题库", bytes, None);
    }
    drop(input);
    if bytes != expected_size || format!("{:x}", digest.finalize()) != env!("QUIZRX_BANK_SHA256") {
        return Err("APK 题库完整性校验失败，请重新安装".into());
    }
    drop(open(&temporary)?);
    std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
    open(&destination)
}

#[cfg(target_os = "android")]
struct BankPlugin(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
pub fn android_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("quizrx-bank")
        .setup(|app, api| {
            let plugin = api.register_android_plugin("com.wjx.quizrx", "BankPlugin")?;
            app.manage(BankPlugin(plugin));
            Ok(())
        })
        .build()
}
