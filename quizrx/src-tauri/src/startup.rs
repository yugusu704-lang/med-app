//! Keep runtime creation failures observable, including in the GUI subsystem.
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

struct StartupLogger {
    file: Mutex<Option<File>>,
    last_runtime_error: Mutex<Option<String>>,
}

static LOGGER: OnceLock<StartupLogger> = OnceLock::new();

impl log::Log for StartupLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let message = record.args().to_string();
        if record.level() == log::Level::Error && record.target().starts_with("tauri_runtime_wry") {
            if let Ok(mut last_error) = self.last_runtime_error.lock() {
                *last_error = Some(message.clone());
            }
        }
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let line = format!(
            "[{seconds}] {} {}: {message}",
            record.level(),
            record.target()
        );
        eprintln!("{line}");
        if let Ok(mut file) = self.file.lock() {
            if let Some(file) = file.as_mut() {
                let _ = writeln!(file, "{line}");
                let _ = file.flush();
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            if let Some(file) = file.as_mut() {
                let _ = file.flush();
            }
        }
    }
}

pub fn init_logging() {
    let directory = std::env::var_os("QUIZRX_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("com.wjx.quizrx")
                .join("logs")
        });
    let path = directory.join("startup.log");
    let file = std::fs::create_dir_all(&directory)
        .and_then(|()| OpenOptions::new().create(true).append(true).open(&path));
    let file = match file {
        Ok(file) => Some(file),
        Err(error) => {
            eprintln!(
                "无法写入启动日志 {}: {error}；可设置 QUIZRX_LOG_DIR。",
                path.display()
            );
            None
        }
    };
    let logger = LOGGER.get_or_init(|| StartupLogger {
        file: Mutex::new(file),
        last_runtime_error: Mutex::new(None),
    });
    if log::set_logger(logger).is_ok() {
        log::set_max_level(log::LevelFilter::Warn);
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            log::error!("{info}");
            previous_hook(info);
        }));
    }
}

#[cfg(windows)]
pub fn last_runtime_error() -> Option<String> {
    LOGGER.get()?.last_runtime_error.lock().ok()?.clone()
}

#[cfg(target_os = "android")]
pub fn configure_file(directory: &std::path::Path) {
    if let Some(logger) = LOGGER.get() {
        let file = std::fs::create_dir_all(directory).and_then(|()| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(directory.join("startup.log"))
        });
        if let (Ok(file), Ok(mut slot)) = (file, logger.file.lock()) {
            *slot = Some(file);
        }
    }
}
