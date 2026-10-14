"""对真实导入产物做端到端校验（只读）。

用法:
    python tests/verify_pipeline.py [数据库路径]

用桌面端 quizrx/src-tauri/src/commands.rs 里的原始 SQL 直接查询，
并核对 schema 版本、题型覆盖、A3 子题完整性和中文检索是否可用。
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from processor.schema import SCHEMA_VERSION, read_schema_version  # noqa: E402

DEFAULT_DB = PROJECT_ROOT / "quizbank.db"
RENDERABLE = {"A1", "A2", "A3", "A4", "B", "C", "X"}

FETCH_QUESTION = """
SELECT q.type, s.name, u.name, q.stem, q.answer, q.point, q.discuss,
       q.source, q.extracted_year
FROM questions q
JOIN subjects s ON s.id = q.subject_id
LEFT JOIN units u ON u.id = q.unit_id
WHERE q.id = ?
"""

SEARCH = """
SELECT q.id, q.type, s.name, q.stem
FROM questions_fts
JOIN questions q ON q.id = questions_fts.rowid
JOIN subjects s ON s.id = q.subject_id
WHERE questions_fts MATCH ?
ORDER BY bm25(questions_fts)
LIMIT ?
"""


def check(db_path: Path) -> int:
    if not db_path.exists():
        print(f"[x] 数据库不存在: {db_path}")
        print("    先生成: python -m processor.json_to_sqlite --apply")
        return 1

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    failures: list[str] = []

    version = read_schema_version(conn)
    if version != SCHEMA_VERSION:
        failures.append(f"schema 版本 {version} != 期望 {SCHEMA_VERSION}")
    print(f"[*] 数据库: {db_path}")
    print(f"[*] schema 版本: {version}")

    total = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    subjects = conn.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    units = conn.execute("SELECT COUNT(*) FROM units").fetchone()[0]
    print(f"[*] 题目 {total} | 科目 {subjects} | 章节 {units}")
    if total == 0:
        failures.append("题库为空")

    # 题型必须都是桌面端能渲染的
    types = dict(conn.execute("SELECT type, COUNT(*) FROM questions GROUP BY type ORDER BY 2 DESC"))
    print(f"[*] 题型分布: {types}")
    unsupported = set(types) - RENDERABLE
    if unsupported:
        failures.append(f"桌面端无法渲染的题型: {sorted(unsupported)}")

    # 桌面端取题 SQL 必须对每种题型都能执行
    for q_type in types:
        row = conn.execute(
            "SELECT q.id FROM questions q WHERE q.type = ? LIMIT 1", (q_type,)
        ).fetchone()
        if row is None:
            continue
        qid = row[0]
        try:
            detail = conn.execute(FETCH_QUESTION, (qid,)).fetchone()
        except sqlite3.Error as exc:
            failures.append(f"题型 {q_type} 取题失败: {exc}")
            continue
        if detail is None:
            failures.append(f"题型 {q_type} 取不到题目 id={qid}")
            continue
        # 选项或子题至少要有一个，否则无法作答
        options = conn.execute(
            "SELECT COUNT(*) FROM options WHERE question_id = ?", (qid,)).fetchone()[0]
        subs = conn.execute(
            "SELECT COUNT(*) FROM sub_questions WHERE question_id = ?", (qid,)).fetchone()[0]
        if options == 0 and subs == 0:
            failures.append(f"题型 {q_type} 的题目 id={qid} 既无选项也无子题")
        if q_type == "A3" and subs == 0:
            failures.append(f"A3 题目 id={qid} 没有子题，判分会永远正确")

    # 答案引用的选项必须存在
    broken = conn.execute("""
        SELECT COUNT(*) FROM questions q
        WHERE q.type IN ('A1','A2','A4','B','C')
          AND (SELECT COUNT(*) FROM options o WHERE o.question_id = q.id) > 0
          AND NOT EXISTS (SELECT 1 FROM options o
                          WHERE o.question_id = q.id AND o.label = q.answer)
    """).fetchone()[0]
    if broken:
        failures.append(f"{broken} 道单选题的答案在选项里找不到")

    empty_answer = conn.execute("SELECT COUNT(*) FROM questions WHERE answer = ''").fetchone()[0]
    if empty_answer:
        failures.append(f"{empty_answer} 道题答案为空")

    # 中文子串检索（trigram）
    sample = conn.execute("SELECT stem FROM questions WHERE length(stem) > 8 LIMIT 1").fetchone()
    if sample:
        probe = sample[0][2:6]
        if probe:
            hits = conn.execute(SEARCH, (probe, 5)).fetchall()
            if not hits:
                failures.append(f"中文检索失效：搜 {probe!r} 无结果")
            else:
                print(f"[*] 中文检索正常：{probe!r} 命中 {len(hits)} 条")

    if failures:
        print("\n[x] 校验未通过:")
        for item in failures:
            print(f"    - {item}")
        return 1

    print("\n[√] 校验通过：数据库可被桌面端直接读取")
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    raise SystemExit(check(target))
