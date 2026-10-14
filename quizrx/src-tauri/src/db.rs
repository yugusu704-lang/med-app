use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 全局共享的 SQLite 连接（只读）。
pub struct DbState(pub Mutex<Connection>);

/// 以只读方式打开 quizbank.db。
///
/// 路径解析顺序：
/// 1. Tauri resource 目录（打包后由 `tauri.conf.json` 的 resources 提供）
/// 2. 开发期仓库根的 quizbank.db（quizrx/src-tauri/../quizbank.db）
/// 3. 兜底绝对路径
pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let resource_dir = app.path().resource_dir().ok();
    let candidates: Vec<PathBuf> = [
        // Bundled resource. `tauri.conf.json` maps the file explicitly, so this
        // is the only path that works in an installed build.
        resource_dir.as_ref().map(|p| p.join("quizbank.db")),
        // Development: quizbank.db next to quizrx/, and at the repo root.
        std::env::current_dir().ok().map(|d| d.join("quizbank.db")),
        std::env::current_dir()
            .ok()
            .map(|d| d.join("../../quizbank.db")),
        std::env::current_dir()
            .ok()
            .map(|d| d.join("../../../quizbank.db")),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut attempts = Vec::new();
    for path in &candidates {
        if path.exists() {
            match Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                Ok(conn) => {
                    check_schema(&conn, path)?;
                    return Ok(conn);
                }
                Err(e) => attempts.push(format!("{:?}: {}", path, e)),
            }
        } else {
            attempts.push(format!("{:?}: not found", path));
        }
    }

    Err(format!(
        "找不到可用的 quizbank.db。请先运行 python -m processor.json_to_sqlite --apply 生成。\n尝试记录:\n{}",
        attempts.join("\n")
    ))
}

/// 数据库结构版本。必须与 processor/schema.py 的 SCHEMA_VERSION 一致。
pub const SUPPORTED_SCHEMA_VERSION: i64 = 1;

/// 打开后立即校验结构，避免在缺列的旧库上跑到一半才报错。
pub(crate) fn check_schema(conn: &Connection, path: &PathBuf) -> Result<(), String> {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'version'",
            [],
            |row| row.get(0),
        )
        .ok();
    match version {
        None => Err(format!(
            "{:?}: 缺少 schema_meta 版本标记，请用 processor/ 下的导入器重新生成数据库",
            path
        )),
        Some(v) => {
            let found: i64 = v
                .parse()
                .map_err(|_| format!("{:?}: 无法解析 schema 版本 {:?}", path, v))?;
            if found != SUPPORTED_SCHEMA_VERSION {
                return Err(format!(
                    "{:?}: schema 版本 {} 与应用支持的 {} 不一致，请重新生成数据库",
                    path, found, SUPPORTED_SCHEMA_VERSION
                ));
            }
            Ok(())
        }
    }
}
