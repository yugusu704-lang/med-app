"""Single source of truth for the quizbank SQLite schema.

Both importers (``json_to_sqlite`` and ``mongo_to_sqlite``) build this schema,
and the Tauri desktop app (``quizrx/src-tauri``) reads it. Keeping one
definition here is what makes the pipeline usable end to end.

Column naming follows the desktop app's expectations:
    questions.type / stem / answer / point / discuss / source / extracted_year
Additive columns (``mongo_id``, ``sub_quiz_id`` ...) exist so both importers can
share the same tables without one of them losing provenance.
"""

from __future__ import annotations

import sqlite3

#: Bump when a column or table changes in a way the desktop app must notice.
SCHEMA_VERSION = 1

#: Question types the desktop app can render. B/C are single-choice shaped:
#: B shares an option list across a group, C is an undefined-case question.
KNOWN_TYPES = ("A1", "A2", "A3", "A4", "B", "C", "X")

SCHEMA_SQL = """
-- Schema marker. The desktop app refuses to open a database it does not know.
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 科目维度表
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    question_count INTEGER DEFAULT 0
);

-- 章节维度表。A3/部分题型可能没有章节，unit_id 允许为空。
CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    name TEXT NOT NULL,
    UNIQUE(subject_id, name)
);

-- 题目主表。列名与 quizrx/src-tauri/src/commands.rs 的查询保持一致。
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                       -- A1 / A2 / A3 / A4 / B / C / X
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    unit_id INTEGER REFERENCES units(id),     -- 允许为空
    source TEXT,                              -- 来源名称（题库名或采集批次）
    extracted_year INTEGER,                   -- 真题年份，可为空
    stem TEXT NOT NULL,                       -- 题干（A3 存共用题干）
    answer TEXT NOT NULL,                     -- A1/A2/B/C: 单字母；X: 拼接如 "BCD"
    point TEXT DEFAULT '',                    -- 知识点/课本出处
    discuss TEXT DEFAULT '',                  -- 解析
    sub_stem TEXT,                            -- 未拆分时的子题题干文本
    mongo_id TEXT UNIQUE,                     -- BSON 导入的溯源 id，JSON 导入为空
    processed_at TEXT,                        -- ISO 8601 时间
    content_hash TEXT UNIQUE NOT NULL         -- 去重哈希（完整题目内容）
);

-- 题目选项表。A1/A2/B/C/X 使用；A3 通常挂��� sub_options。
CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,                      -- A / B / C / D / E
    content TEXT NOT NULL,                    -- 选项文本（去掉前缀字母）
    sort_order INTEGER NOT NULL
);

-- A3 子题表（病例串题共用题干，子题独立选项和答案）
CREATE TABLE IF NOT EXISTS sub_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    sub_quiz_id INTEGER NOT NULL,             -- 子题序号（0,1,2...）
    mongo_id TEXT,
    stem TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    UNIQUE(question_id, sub_quiz_id)
);

-- 子题选项表
CREATE TABLE IF NOT EXISTS sub_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_question_id INTEGER NOT NULL REFERENCES sub_questions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_unit ON questions(unit_id);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_year ON questions(extracted_year);
CREATE INDEX IF NOT EXISTS idx_questions_source_unit ON questions(source, subject_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
CREATE INDEX IF NOT EXISTS idx_subq_question ON sub_questions(question_id);

-- 全文检索：只索引题干与子题题干。
-- 用 trigram 分词，因为 unicode61 会把连续中文当成一个整词：
-- "冠心病" 搜不到 "冠心病患者的治疗方案"。
-- 解析（point/discuss）文本很长，纳入 trigram 会让索引体积和构建时间
-- 都膨胀数倍，因此不进入索引；桌面端搜索框只承诺检索题干。
CREATE VIRTUAL TABLE IF NOT EXISTS questions_fts USING fts5(
    stem,
    sub_stem,
    tokenize='trigram',
    content='questions',
    content_rowid='id'
);"""


def create_schema(conn: sqlite3.Connection) -> None:
    """Create the schema and stamp its version."""
    conn.executescript(SCHEMA_SQL)
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES('version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()


def read_schema_version(conn: sqlite3.Connection) -> int | None:
    """Return the stored schema version, or None when the marker is absent."""
    try:
        row = conn.execute("SELECT value FROM schema_meta WHERE key='version'").fetchone()
    except sqlite3.Error:
        return None
    return int(row[0]) if row else None


def rebuild_fts(conn: sqlite3.Connection) -> int:
    """Rebuild the external-content FTS index and return the row count."""
    conn.execute("INSERT INTO questions_fts(questions_fts) VALUES('rebuild')")
    conn.commit()
    return int(conn.execute("SELECT COUNT(*) FROM questions_fts").fetchone()[0])
