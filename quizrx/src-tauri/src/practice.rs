//! Writable, local-only practice data. The bundled question bank is never modified.
use crate::{
    commands::{fetch_question, select_quiz_ids},
    db::DbState,
    models::{Question, QuizConfig, QuizOption},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub struct UserDbState(pub Mutex<Connection>);
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn open_user_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    let mut conn = Connection::open(path).map_err(err)?;
    migrate(&mut conn)?;
    Ok(conn)
}
fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(err)?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version > 1 {
        return Err(format!("用户记录版本 {version} 高于应用支持的 1"));
    }
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(err)?;
    if version == 0 {
        let tx = conn.transaction().map_err(err)?;
        tx.execute_batch("CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,bank_revision TEXT NOT NULL,current_position INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE session_items(session_id INTEGER NOT NULL REFERENCES sessions(id),position INTEGER NOT NULL,stable_key TEXT NOT NULL,content_hash TEXT NOT NULL,answer_json TEXT,correct INTEGER,sub_json TEXT,draft_json TEXT,PRIMARY KEY(session_id,position));
          CREATE TABLE bookmarks(stable_key TEXT PRIMARY KEY,content_hash TEXT NOT NULL,updated_at INTEGER NOT NULL);
          CREATE TABLE mistakes(stable_key TEXT PRIMARY KEY,content_hash TEXT NOT NULL,updated_at INTEGER NOT NULL,wrong_count INTEGER NOT NULL DEFAULT 1);
          PRAGMA user_version=1;").map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedAnswer {
    #[serde(default)]
    pub selected: Vec<String>,
    #[serde(default)]
    pub sub_answers: Vec<SubAnswer>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubAnswer {
    pub sub_id: i64,
    pub selected: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubCorrectness {
    pub sub_id: i64,
    pub correct: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerRecord {
    pub position: usize,
    pub answer: SubmittedAnswer,
    pub correct: bool,
    pub sub_correctness: Vec<SubCorrectness>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerDraft {
    pub position: usize,
    pub answer: SubmittedAnswer,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizSession {
    pub id: i64,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub bank_revision: String,
    pub question_ids: Vec<Option<i64>>,
    pub answers: Vec<AnswerRecord>,
    pub drafts: Vec<AnswerDraft>,
    pub current_position: usize,
    pub total: usize,
    pub correct_count: usize,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: i64,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub current_position: usize,
    pub total: usize,
    pub correct_count: usize,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionRecord {
    pub question_id: Option<i64>,
    pub stable_key: String,
    pub updated_at: i64,
}

fn identity(bank: &Connection, id: i64) -> Result<(String, String), String> {
    bank.query_row(
        "SELECT mongo_id,content_hash FROM questions WHERE id=?1",
        [id],
        |r| {
            let mongo: Option<String> = r.get(0)?;
            let hash: String = r.get(1)?;
            let key = match mongo.filter(|m| !m.is_empty()) {
                Some(m) => format!("mongo:{m}"),
                None => format!("hash:{hash}"),
            };
            Ok((key, hash))
        },
    )
    .map_err(err)
}
fn resolve(bank: &Connection, key: &str, hash: &str) -> Result<Option<i64>, String> {
    let (column, value) = if let Some(m) = key.strip_prefix("mongo:") {
        ("mongo_id", m)
    } else if let Some(h) = key.strip_prefix("hash:") {
        ("content_hash", h)
    } else {
        return Err("无效题目标识".into());
    };
    bank.query_row(
        &format!("SELECT id FROM questions WHERE {column}=?1 AND content_hash=?2"),
        params![value, hash],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
fn session(bank: &Connection, user: &Connection, id: i64) -> Result<QuizSession, String> {
    let (status,created_at,updated_at,bank_revision,current_position)=user.query_row("SELECT status,created_at,updated_at,bank_revision,current_position FROM sessions WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,usize>(4)?))).map_err(err)?;
    let mut stmt=user.prepare("SELECT position,stable_key,content_hash,answer_json,correct,sub_json,draft_json FROM session_items WHERE session_id=?1 ORDER BY position").map_err(err)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, usize>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<bool>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(err)?;
    let mut question_ids = Vec::new();
    let mut answers = Vec::new();
    let mut drafts = Vec::new();
    for row in rows {
        let (position, key, hash, a, c, s, d) = row.map_err(err)?;
        question_ids.push(resolve(bank, &key, &hash)?);
        if let Some(d) = d {
            drafts.push(AnswerDraft {
                position,
                answer: serde_json::from_str(&d).map_err(err)?,
            });
        }
        if let Some(a) = a {
            answers.push(AnswerRecord {
                position,
                answer: serde_json::from_str(&a).map_err(err)?,
                correct: c.unwrap_or(false),
                sub_correctness: serde_json::from_str(s.as_deref().unwrap_or("[]")).map_err(err)?,
            });
        }
    }
    Ok(QuizSession {
        id,
        status,
        created_at,
        updated_at,
        bank_revision,
        current_position,
        total: question_ids.len(),
        correct_count: answers.iter().filter(|a| a.correct).count(),
        question_ids,
        answers,
        drafts,
    })
}
fn start(
    bank: &Connection,
    user: &mut Connection,
    config: &QuizConfig,
) -> Result<QuizSession, String> {
    let ids = select_quiz_ids(bank, config)?;
    // Validate before saving: malformed A3 questions must not create unusable sessions.
    let items: Vec<_> = ids
        .into_iter()
        .filter(|id| fetch_question(bank, *id).is_ok())
        .map(|id| identity(bank, id))
        .collect::<Result<_, _>>()?;
    if items.is_empty() {
        return Err("当前筛选没有可用题目".into());
    }
    let revision: String = bank
        .query_row(
            "SELECT CAST(COUNT(*) AS TEXT)||':'||COALESCE(MAX(processed_at),'') FROM questions",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let tx = user.transaction().map_err(err)?;
    let timestamp = now();
    tx.execute(
        "INSERT INTO sessions(created_at,updated_at,bank_revision) VALUES(?1,?1,?2)",
        params![timestamp, revision],
    )
    .map_err(err)?;
    let id = tx.last_insert_rowid();
    for (position, (key, hash)) in items.iter().enumerate() {
        tx.execute("INSERT INTO session_items(session_id,position,stable_key,content_hash) VALUES(?1,?2,?3,?4)",params![id,position,key,hash]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    session(bank, user, id)
}

fn selection(selected: &[String], options: &[QuizOption]) -> Result<BTreeSet<String>, String> {
    let labels: BTreeSet<_> = options.iter().map(|o| o.label.to_uppercase()).collect();
    let picked: BTreeSet<_> = selected.iter().map(|s| s.trim().to_uppercase()).collect();
    if picked.is_empty() || picked.len() != selected.len() || !picked.is_subset(&labels) {
        return Err("请选择有效选项（不能重复）".into());
    }
    Ok(picked)
}
fn canonical(answer: &str) -> BTreeSet<String> {
    answer
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase().to_string())
        .collect()
}
fn grade(
    question: &Question,
    answer: &SubmittedAnswer,
) -> Result<(bool, Vec<SubCorrectness>), String> {
    match question {
        Question::A1(q) | Question::A2(q) | Question::A4(q) | Question::B(q) | Question::C(q) => {
            if !answer.sub_answers.is_empty() {
                return Err("单选题不能提交子题答案".into());
            }
            let picked = selection(&answer.selected, &q.options)?;
            if picked.len() != 1 {
                return Err("单选题只能选择一项".into());
            }
            Ok((picked == canonical(&q.answer), vec![]))
        }
        Question::X(q) => {
            if !answer.sub_answers.is_empty() {
                return Err("多选题不能提交子题答案".into());
            }
            let expected: BTreeSet<_> = q.answer.iter().map(|s| s.to_uppercase()).collect();
            Ok((selection(&answer.selected, &q.options)? == expected, vec![]))
        }
        Question::A3(q) => {
            if q.sub_questions.is_empty() {
                return Err("案例题没有子题".into());
            }
            if !answer.selected.is_empty() || answer.sub_answers.len() != q.sub_questions.len() {
                return Err("请回答全部子题".into());
            }
            let unique: BTreeSet<_> = answer.sub_answers.iter().map(|a| a.sub_id).collect();
            if unique.len() != answer.sub_answers.len() {
                return Err("重复子题答案".into());
            }
            let mut results = vec![];
            for sub in &q.sub_questions {
                let a = answer
                    .sub_answers
                    .iter()
                    .find(|a| a.sub_id == sub.sub_id)
                    .ok_or("子题标识不匹配")?;
                let picked = selection(&a.selected, &sub.options)?;
                if picked.len() != 1 {
                    return Err("案例子题只能选择一项".into());
                }
                results.push(SubCorrectness {
                    sub_id: sub.sub_id,
                    correct: picked == canonical(&sub.answer),
                });
            }
            Ok((results.iter().all(|s| s.correct), results))
        }
    }
}
fn submit(
    bank: &Connection,
    user: &mut Connection,
    id: i64,
    position: usize,
    answer: SubmittedAnswer,
) -> Result<QuizSession, String> {
    let current = session(bank, user, id)?;
    // A committed answer cannot be replaced; retries return the original result.
    if current.answers.iter().any(|a| a.position == position) {
        return Ok(current);
    }
    if current.status != "active" {
        return Err("练习已结束".into());
    }
    let question_id = current
        .question_ids
        .get(position)
        .copied()
        .flatten()
        .ok_or("题目已变化或不存在，请开始新练习")?;
    let (correct, sub) = grade(&fetch_question(bank, question_id)?, &answer)?;
    let (key, hash) = identity(bank, question_id)?;
    let timestamp = now();
    let tx = user.transaction().map_err(err)?;
    let changed=tx.execute("UPDATE session_items SET answer_json=?3,correct=?4,sub_json=?5,draft_json=NULL WHERE session_id=?1 AND position=?2 AND answer_json IS NULL",params![id,position,serde_json::to_string(&answer).map_err(err)?,correct,serde_json::to_string(&sub).map_err(err)?]).map_err(err)?;
    if changed == 0 {
        tx.commit().map_err(err)?;
        return session(bank, user, id);
    }
    if !correct {
        tx.execute("INSERT INTO mistakes(stable_key,content_hash,updated_at) VALUES(?1,?2,?3) ON CONFLICT(stable_key) DO UPDATE SET content_hash=excluded.content_hash,updated_at=excluded.updated_at,wrong_count=wrong_count+1",params![key,hash,timestamp]).map_err(err)?;
    }
    let next:usize=tx.query_row("SELECT COALESCE(MIN(position),(SELECT COUNT(*) FROM session_items WHERE session_id=?1)) FROM session_items WHERE session_id=?1 AND answer_json IS NULL",[id],|r|r.get(0)).map_err(err)?;
    tx.execute(
        "UPDATE sessions SET current_position=?2,updated_at=?3 WHERE id=?1",
        params![id, next, timestamp],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    session(bank, user, id)
}

#[tauri::command]
pub fn start_quiz_session(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    config: QuizConfig,
) -> Result<QuizSession, String> {
    start(
        &*db.0.lock().map_err(err)?,
        &mut *user_db.0.lock().map_err(err)?,
        &config,
    )
}
#[tauri::command]
pub fn get_quiz_session(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    session_id: i64,
) -> Result<QuizSession, String> {
    session(
        &*db.0.lock().map_err(err)?,
        &*user_db.0.lock().map_err(err)?,
        session_id,
    )
}
#[tauri::command]
pub fn resume_quiz_session(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    session_id: i64,
) -> Result<QuizSession, String> {
    get_quiz_session(db, user_db, session_id)
}
#[tauri::command]
pub fn submit_quiz_answer(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    session_id: i64,
    position: usize,
    answer: SubmittedAnswer,
) -> Result<QuizSession, String> {
    submit(
        &*db.0.lock().map_err(err)?,
        &mut *user_db.0.lock().map_err(err)?,
        session_id,
        position,
        answer,
    )
}
fn save_draft(
    bank: &Connection,
    user: &mut Connection,
    id: i64,
    position: usize,
    answer: SubmittedAnswer,
) -> Result<QuizSession, String> {
    let current = session(bank, user, id)?;
    if current.status != "active" {
        return Err("练习已结束".into());
    }
    if current.answers.iter().any(|a| a.position == position) {
        return Ok(current);
    }
    let question_id = current
        .question_ids
        .get(position)
        .copied()
        .flatten()
        .ok_or("题目已变化或不存在")?;
    let question = fetch_question(bank, question_id)?;
    // Drafts may be incomplete, but only valid labels/sub-question identifiers are accepted.
    match &question {
        Question::A3(q) => {
            let unique: BTreeSet<_> = answer.sub_answers.iter().map(|a| a.sub_id).collect();
            if !answer.selected.is_empty() || unique.len() != answer.sub_answers.len() {
                return Err("无效子题草稿".into());
            }
            for a in &answer.sub_answers {
                let sub = q
                    .sub_questions
                    .iter()
                    .find(|s| s.sub_id == a.sub_id)
                    .ok_or("无效子题标识")?;
                if a.selected.len() > 1 {
                    return Err("子题只能选择一项".into());
                }
                if !a.selected.is_empty() {
                    selection(&a.selected, &sub.options)?;
                }
            }
        }
        Question::X(q) => {
            if !answer.sub_answers.is_empty() {
                return Err("无效多选草稿".into());
            }
            if !answer.selected.is_empty() {
                selection(&answer.selected, &q.options)?;
            }
        }
        Question::A1(q) | Question::A2(q) | Question::A4(q) | Question::B(q) | Question::C(q) => {
            if !answer.sub_answers.is_empty() || answer.selected.len() > 1 {
                return Err("无效单选草稿".into());
            }
            if !answer.selected.is_empty() {
                selection(&answer.selected, &q.options)?;
            }
        }
    }
    let tx = user.transaction().map_err(err)?;
    tx.execute("UPDATE session_items SET draft_json=?3 WHERE session_id=?1 AND position=?2 AND answer_json IS NULL",params![id,position,serde_json::to_string(&answer).map_err(err)?]).map_err(err)?;
    tx.execute(
        "UPDATE sessions SET current_position=?2,updated_at=?3 WHERE id=?1",
        params![id, position, now()],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    session(bank, user, id)
}
#[tauri::command]
pub fn save_quiz_draft(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    session_id: i64,
    position: usize,
    answer: SubmittedAnswer,
) -> Result<QuizSession, String> {
    save_draft(
        &*db.0.lock().map_err(err)?,
        &mut *user_db.0.lock().map_err(err)?,
        session_id,
        position,
        answer,
    )
}
#[tauri::command]
pub fn finish_quiz_session(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    session_id: i64,
) -> Result<QuizSession, String> {
    let bank = db.0.lock().map_err(err)?;
    let mut user = user_db.0.lock().map_err(err)?;
    let tx = user.transaction().map_err(err)?;
    tx.execute(
        "UPDATE sessions SET status='finished',updated_at=?2 WHERE id=?1 AND status='active'",
        params![session_id, now()],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    session(&bank, &user, session_id)
}
#[tauri::command]
pub fn list_active_sessions(
    user_db: tauri::State<'_, UserDbState>,
) -> Result<Vec<SessionSummary>, String> {
    let user = user_db.0.lock().map_err(err)?;
    let mut stmt=user.prepare("SELECT s.id,s.status,s.created_at,s.updated_at,s.current_position,COUNT(i.position),COALESCE(SUM(i.correct),0) FROM sessions s JOIN session_items i ON i.session_id=s.id WHERE s.status='active' GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 50").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionSummary {
                id: r.get(0)?,
                status: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
                current_position: r.get(4)?,
                total: r.get(5)?,
                correct_count: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
#[tauri::command]
pub fn set_bookmark(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    question_id: i64,
    bookmarked: bool,
) -> Result<(), String> {
    let bank = db.0.lock().map_err(err)?;
    let user = user_db.0.lock().map_err(err)?;
    let (key, hash) = identity(&bank, question_id)?;
    if bookmarked {
        user.execute("INSERT INTO bookmarks(stable_key,content_hash,updated_at) VALUES(?1,?2,?3) ON CONFLICT(stable_key) DO UPDATE SET content_hash=excluded.content_hash,updated_at=excluded.updated_at",params![key,hash,now()]).map_err(err)?;
    } else {
        user.execute("DELETE FROM bookmarks WHERE stable_key=?1", [key])
            .map_err(err)?;
    }
    Ok(())
}
fn records(
    bank: &Connection,
    user: &Connection,
    table: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<QuestionRecord>, String> {
    if limit == 0 || limit > 500 {
        return Err("分页大小必须在 1..=500".into());
    }
    let mut stmt=user.prepare(&format!("SELECT stable_key,content_hash,updated_at FROM {table} ORDER BY updated_at DESC,stable_key LIMIT ?1 OFFSET ?2")).map_err(err)?;
    let rows = stmt
        .query_map(params![limit, offset], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(err)?;
    rows.map(|r| {
        let (key, hash, updated_at) = r.map_err(err)?;
        Ok(QuestionRecord {
            question_id: resolve(bank, &key, &hash)?,
            stable_key: key,
            updated_at,
        })
    })
    .collect()
}
#[tauri::command]
pub fn list_bookmarks(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    offset: u32,
    limit: u32,
) -> Result<Vec<QuestionRecord>, String> {
    records(
        &*db.0.lock().map_err(err)?,
        &*user_db.0.lock().map_err(err)?,
        "bookmarks",
        offset,
        limit,
    )
}
#[tauri::command]
pub fn list_mistakes(
    db: tauri::State<'_, DbState>,
    user_db: tauri::State<'_, UserDbState>,
    offset: u32,
    limit: u32,
) -> Result<Vec<QuestionRecord>, String> {
    records(
        &*db.0.lock().map_err(err)?,
        &*user_db.0.lock().map_err(err)?,
        "mistakes",
        offset,
        limit,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Analysis, CaseQuestion, MultiChoice, SingleChoice, SubQuestion};
    fn options() -> Vec<QuizOption> {
        ["A", "B", "C"]
            .iter()
            .map(|s| QuizOption {
                label: s.to_string(),
                content: s.to_string(),
            })
            .collect()
    }
    fn single() -> SingleChoice {
        SingleChoice {
            id: 1,
            subject: "s".into(),
            unit: "u".into(),
            stem: "stem".into(),
            options: options(),
            answer: "A".into(),
            analysis: Analysis {
                point: "".into(),
                discuss: "".into(),
                links: vec![],
            },
            source: None,
            extracted_year: None,
        }
    }
    fn answer(labels: &[&str]) -> SubmittedAnswer {
        SubmittedAnswer {
            selected: labels.iter().map(|s| s.to_string()).collect(),
            sub_answers: vec![],
        }
    }
    #[test]
    fn grades_single_and_multi_strictly() {
        for q in [
            Question::A1(single()),
            Question::A2(single()),
            Question::A4(single()),
            Question::B(single()),
            Question::C(single()),
        ] {
            assert!(grade(&q, &answer(&["a"])).unwrap().0);
            assert!(!grade(&q, &answer(&["B"])).unwrap().0);
            assert!(grade(&q, &answer(&["A", "B"])).is_err());
            assert!(grade(&q, &answer(&["D"])).is_err());
        }
        let s = single();
        let q = Question::X(MultiChoice {
            id: s.id,
            subject: s.subject,
            unit: s.unit,
            stem: s.stem,
            options: s.options,
            answer: vec!["A".into(), "C".into()],
            analysis: s.analysis,
            source: None,
            extracted_year: None,
        });
        assert!(grade(&q, &answer(&["C", "A"])).unwrap().0);
        assert!(!grade(&q, &answer(&["A"])).unwrap().0);
        assert!(grade(&q, &answer(&["A", "A"])).is_err());
    }
    #[test]
    fn case_grades_each_sub_and_rejects_empty() {
        let s = single();
        let mut q = CaseQuestion {
            id: 1,
            subject: s.subject,
            unit: s.unit,
            stem: s.stem,
            sub_questions: vec![],
            analysis: s.analysis,
            source: None,
            extracted_year: None,
        };
        assert!(grade(&Question::A3(q.clone()), &SubmittedAnswer::default()).is_err());
        q.sub_questions = vec![
            SubQuestion {
                sub_id: 8,
                stem: "s".into(),
                options: options(),
                answer: "A".into(),
            },
            SubQuestion {
                sub_id: 9,
                stem: "s".into(),
                options: options(),
                answer: "B".into(),
            },
        ];
        let a = SubmittedAnswer {
            selected: vec![],
            sub_answers: vec![
                SubAnswer {
                    sub_id: 9,
                    selected: vec!["C".into()],
                },
                SubAnswer {
                    sub_id: 8,
                    selected: vec!["A".into()],
                },
            ],
        };
        let (correct, subs) = grade(&Question::A3(q), &a).unwrap();
        assert!(!correct);
        assert!(subs[0].correct);
        assert!(!subs[1].correct);
    }
    fn bank() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE subjects(id INTEGER,name TEXT);INSERT INTO subjects VALUES(1,'s');CREATE TABLE units(id INTEGER,name TEXT);INSERT INTO units VALUES(1,'u');CREATE TABLE questions(id INTEGER,type TEXT,subject_id INTEGER,unit_id INTEGER,stem TEXT,answer TEXT,point TEXT,discuss TEXT,source TEXT,extracted_year INTEGER,mongo_id TEXT,content_hash TEXT,processed_at TEXT);INSERT INTO questions VALUES(1,'A1',1,1,'stem','A','','',NULL,NULL,'m1','h1','2026');CREATE TABLE options(question_id INTEGER,label TEXT,content TEXT,sort_order INTEGER);INSERT INTO options VALUES(1,'A','a',0),(1,'B','b',1);").unwrap();
        c
    }
    #[test]
    fn restart_recovers_order_answers_and_idempotent_mistakes() {
        let path = std::env::temp_dir().join(format!(
            "quizrx-practice-{}-{}.sqlite",
            std::process::id(),
            now()
        ));
        let bank = bank();
        let mut user = open_user_db(&path).unwrap();
        let config = QuizConfig {
            source: None,
            unit_id: None,
            subject_id: None,
            types: vec![],
            count: 1,
            randomize: Some(false),
        };
        let started = start(&bank, &mut user, &config).unwrap();
        let id = started.id;
        save_draft(&bank, &mut user, id, 0, answer(&["B"])).unwrap();
        drop(user);
        let mut user = open_user_db(&path).unwrap();
        assert_eq!(
            session(&bank, &user, id).unwrap().drafts[0].answer,
            answer(&["B"])
        );
        let result = submit(&bank, &mut user, id, 0, answer(&["B"])).unwrap();
        assert_eq!(result.current_position, 1);
        assert_eq!(result.correct_count, 0);
        assert!(result.drafts.is_empty());
        assert_eq!(
            submit(&bank, &mut user, id, 0, answer(&["A"]))
                .unwrap()
                .answers[0]
                .answer,
            answer(&["B"])
        );
        assert_eq!(
            user.query_row("SELECT wrong_count FROM mistakes", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(user);
        let user = open_user_db(&path).unwrap();
        let restored = session(&bank, &user, id).unwrap();
        assert_eq!(restored.question_ids, vec![Some(1)]);
        assert_eq!(restored.answers.len(), 1);
        bank.execute("UPDATE questions SET id=42", []).unwrap();
        assert_eq!(
            session(&bank, &user, id).unwrap().question_ids,
            vec![Some(42)]
        );
        bank.execute("UPDATE questions SET content_hash='changed'", [])
            .unwrap();
        assert_eq!(session(&bank, &user, id).unwrap().question_ids, vec![None]);
        drop(user);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_future_schema_and_invalid_session() {
        let mut user = Connection::open_in_memory().unwrap();
        user.pragma_update(None, "user_version", 2).unwrap();
        assert!(migrate(&mut user).is_err());
        user.pragma_update(None, "user_version", 0).unwrap();
        migrate(&mut user).unwrap();
        assert!(session(&bank(), &user, 999).is_err());
    }
    #[test]
    fn invalid_submission_does_not_advance_or_write_mistake() {
        let bank = bank();
        let mut user = Connection::open_in_memory().unwrap();
        migrate(&mut user).unwrap();
        let config = QuizConfig {
            source: None,
            unit_id: None,
            subject_id: None,
            types: vec![],
            count: 1,
            randomize: Some(false),
        };
        let id = start(&bank, &mut user, &config).unwrap().id;
        assert!(submit(&bank, &mut user, id, 0, answer(&["Z"])).is_err());
        let restored = session(&bank, &user, id).unwrap();
        assert_eq!(restored.current_position, 0);
        assert!(restored.answers.is_empty());
        assert!(records(&bank, &user, "mistakes", 0, 20).unwrap().is_empty());
        assert!(start(
            &bank,
            &mut user,
            &QuizConfig {
                count: 501,
                ..config
            }
        )
        .is_err());
    }
    #[test]
    fn bookmark_hash_fallback_resolves_and_pages() {
        let bank = bank();
        bank.execute("UPDATE questions SET mongo_id=NULL", [])
            .unwrap();
        let (key, hash) = identity(&bank, 1).unwrap();
        assert_eq!(key, "hash:h1");
        let mut user = Connection::open_in_memory().unwrap();
        migrate(&mut user).unwrap();
        user.execute(
            "INSERT INTO bookmarks(stable_key,content_hash,updated_at) VALUES(?1,?2,1)",
            params![key, hash],
        )
        .unwrap();
        assert_eq!(
            records(&bank, &user, "bookmarks", 0, 20).unwrap()[0].question_id,
            Some(1)
        );
        assert!(records(&bank, &user, "bookmarks", 1, 20)
            .unwrap()
            .is_empty());
        assert!(records(&bank, &user, "bookmarks", 0, 501).is_err());
        bank.execute("DELETE FROM questions", []).unwrap();
        assert_eq!(
            records(&bank, &user, "bookmarks", 0, 20).unwrap()[0].question_id,
            None
        );
    }
}
