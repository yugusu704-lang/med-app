"""题库 JSON → SQLite（统一 schema 版）。

默认 dry-run；``--apply`` 才发布。发布走 StagedDatabase：临时建库 → 只读校验
→ 备份旧库 → 原子替换。导入出错或结果为空时拒绝发布，旧库保持原样。

数据库结构由 :mod:`processor.schema` 统一定义，与 quizrx 桌面端读取的列名一致。

用法:
    python -m processor.json_to_sqlite                     # dry-run
    python -m processor.json_to_sqlite --apply              # 真正发布
    python -m processor.json_to_sqlite --vault-dir X --undefined-dir Y
    python -m processor.json_to_sqlite --incremental --input-dir X --source OBE大纲 --apply

--incremental 先只读复制现有库到临时库，保留已有 ID/题目；支持章节 JSON 数组。
重复导入全部已存在的题目时不发布；任何损坏或不完整的新题目会阻止发布。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from contextlib import closing
import sys
from pathlib import Path

from .safety import SafeRun, add_safety_arguments, run_from_args
from .database_safety import StagedDatabase, DatabaseSafetyError
from .schema import create_schema, rebuild_fts, read_schema_version, SCHEMA_VERSION

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VAULT_DIR = PROJECT_ROOT / "tests_json_vault"
UNDEFINED_DIR = PROJECT_ROOT / "undefined"
DEFAULT_DB = PROJECT_ROOT / "quizbank.db"

MODE_MAP = {
    "A1型题": "A1", "单选题": "A1", "A1": "A1",
    "A2型题": "A2", "A2": "A2",
    "A3型题": "A3", "A4型题": "A3", "A3/A4型题": "A3", "A3": "A3",
    "B型题": "B", "B": "B",
    "X型题": "X", "多选题": "X", "X": "X",
    "C型题": "C", "C": "C",
}
DEFAULT_MODE = "A1"
UNCLASSIFIED_UNIT = "未分类"
UNCLASSIFIED_SUBJECT = "未分类"

RE_ANSWER_CORRECT = re.compile(r"正确答案\s*([A-E]+)")
RE_ANSWER_PREFIX = re.compile(r"答案[：:]\s*([A-E]+)")
RE_ANSWER_PURE = re.compile(r"^[A-E]+$")
RE_OPTION_PREFIX = re.compile(r"^([A-E])[.．、]\s*")


class UnusableQuestion(ValueError):
    """采集不完整（缺答案/缺选项），跳过并计数，不算数据损坏。"""
# 仅采集元数据，不参与题目去重
METADATA_KEYS = ("name", "numb", "id")


def normalize_answer(raw) -> str:
    if not isinstance(raw, str):
        raise ValueError(f"answer 必须是字符串: {type(raw).__name__}")
    text = raw.strip()
    if not text:
        return ""
    for pattern in (RE_ANSWER_CORRECT, RE_ANSWER_PREFIX, RE_ANSWER_PURE):
        match = pattern.search(text) if pattern is not RE_ANSWER_PURE else pattern.fullmatch(text)
        if match:
            return match.group(1) if match.lastindex else match.group(0)
    match = re.search(r"[A-E]{2,}", text)
    return match.group(0) if match else text


def normalize_mode(mode) -> str:
    if not isinstance(mode, str) or not mode.strip():
        return DEFAULT_MODE
    return MODE_MAP.get(mode.strip(), mode.strip())


def parse_option(option: str) -> tuple[str, str] | None:
    """'A. 脾亢' -> ('A', '脾亢')；没有标签时返回 None（该选项丢弃并记录）。"""
    match = RE_OPTION_PREFIX.match(option)
    if not match:
        return None
    return match.group(1), option[match.end():].strip()


def compute_payload_hash(data: dict) -> str:
    payload = {k: v for k, v in data.items() if k not in METADATA_KEYS}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_or_create_subject(conn, name: str) -> int:
    row = conn.execute("SELECT id FROM subjects WHERE name = ?", (name,)).fetchone()
    if row is not None:
        return int(row[0])
    return int(conn.execute("INSERT INTO subjects(name) VALUES(?)", (name,)).lastrowid)


def get_or_create_unit(conn, subject_id: int, name: str) -> int | None:
    if not name:
        return None
    row = conn.execute(
        "SELECT id FROM units WHERE subject_id = ? AND name = ?", (subject_id, name)
    ).fetchone()
    if row is not None:
        return int(row[0])
    return int(conn.execute(
        "INSERT INTO units(subject_id, name) VALUES(?, ?)", (subject_id, name)
    ).lastrowid)


def _insert_options(conn, question_id: int, options: list[str], stats: dict) -> set[str]:
    labels: set[str] = set()
    for index, option in enumerate(options):
        if not isinstance(option, str):
            stats["notes"].append(f"跳过非字符串选项 #{index}")
            continue
        parsed = parse_option(option)
        if parsed is None:
            stats["notes"].append(f"跳过无标签选项 #{index}: {option[:40]!r}")
            continue
        label, content = parsed
        conn.execute(
            "INSERT INTO options(question_id, label, content, sort_order) VALUES(?,?,?,?)",
            (question_id, label, content, index),
        )
        labels.add(label)
    return labels


def import_question(conn, data: dict, stats: dict) -> bool:
    """导入单题；出错回滚 savepoint 并记入错误样本。"""
    savepoint = f"sp_{stats['total']}"
    conn.execute(f"SAVEPOINT {savepoint}")
    try:
        if not isinstance(data, dict):
            raise ValueError("题目必须是 JSON 对象")

        subject_name = (data.get("cls") or "").strip() or UNCLASSIFIED_SUBJECT
        stem = (data.get("test") or "").strip()
        if not stem:
            raise UnusableQuestion("缺少题干")
        if data.get("answer") in (None, ""):
            raise UnusableQuestion("缺少答案")
        answer = normalize_answer(data.get("answer"))
        if not answer or not RE_ANSWER_PURE.match(answer):
            raise ValueError(f"无法规范化的答案: {data.get('answer')!r}")
        q_type = normalize_mode(data.get("mode"))
        options = data.get("option") or []
        if not isinstance(options, list):
            raise ValueError("option 必须是列表")
        if not options:
            raise UnusableQuestion("没有选项")
        if q_type in ("A1", "A2", "B", "C") and len(answer) != 1:
            # 真实数据里存在标注为单选、答案却是多字母的题（多为采集时题型判错）。
            # 只要每个答案字母都能在选项里找到，就改判为多选；否则拒绝该题。
            stats["reclassified_multi"] += 1
            q_type = "X"
        if q_type == "X" and len(answer) < 2:
            raise ValueError(f"X 题需要多字母答案，得到 {answer!r}")

        subs = data.get("subQuizs") or []
        if q_type == "A3" and not isinstance(subs, list):
            raise ValueError("A3 的 subQuizs 必须是列表")
        if q_type == "A3" and not subs:
            # 采集端把 A3/A4 拍平成普通选择题，没有子题就无法按串题渲染。
            # 降级为 A1 并计数，避免桌面端拿到空子题列表后判分永远正确。
            q_type = "A1"
            stats["downgraded_a3"] += 1

        unit_id = get_or_create_unit(
            conn, get_or_create_subject(conn, subject_name),
            (data.get("unit") or "").strip() or UNCLASSIFIED_UNIT,
        )
        subject_id = conn.execute(
            "SELECT id FROM subjects WHERE name = ?", (subject_name,)
        ).fetchone()[0]

        content_hash = compute_payload_hash(data)
        # 子题文本并入索引列，否则只出现在子题里的关键词搜不到。
        sub_stem = "\n".join(
            (s.get("question") or "").strip()
            for s in (subs if isinstance(subs, list) else [])
            if isinstance(s, dict) and (s.get("question") or "").strip()
        )
        cursor = conn.execute(
            """INSERT OR IGNORE INTO questions
                   (type, subject_id, unit_id, source, extracted_year, stem, answer,
                    point, discuss, sub_stem, processed_at, content_hash)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (q_type, subject_id, unit_id, data.get("source") or data.get("name") or None, None, stem,
             answer, (data.get("point") or "").strip(), (data.get("discuss") or "").strip(),
             sub_stem, None, content_hash),
        )
        if cursor.rowcount == 0:
            stats["skipped"] += 1
            conn.execute(f"RELEASE {savepoint}")
            return False
        question_id = int(cursor.lastrowid)

        labels = _insert_options(conn, question_id, options, stats)
        if not labels:
            raise ValueError("所有选项都缺少 A-E 标签")
        missing = set(answer) - labels
        if missing:
            raise ValueError(f"答案 {answer!r} 引用了不存在的选项 {sorted(missing)}")

        if q_type == "A3":
            for index, sub in enumerate(subs):
                if not isinstance(sub, dict):
                    continue
                sub_stem = (sub.get("question") or "").strip()
                if not sub_stem:
                    continue
                sub_answer = normalize_answer(sub.get("answer"))
                sub_cursor = conn.execute(
                    """INSERT INTO sub_questions
                           (question_id, sub_quiz_id, stem, answer, sort_order)
                       VALUES (?,?,?,?,?)""",
                    (question_id, sub.get("subQuizId", index), sub_stem, sub_answer, index),
                )
                sub_options = sub.get("options") or []
                if isinstance(sub_options, list):
                    _insert_options_conn(conn, int(sub_cursor.lastrowid), sub_options, stats)

        conn.execute(f"RELEASE {savepoint}")
        stats["inserted"] += 1
        return True
    except UnusableQuestion as exc:
        # 采集不完整：跳过但完整记录来源，便于之后回采，不算 corrupt。
        conn.execute(f"ROLLBACK TO {savepoint}")
        conn.execute(f"RELEASE {savepoint}")
        stats["unusable"] += 1
        stats["unusable_samples"].append(f"{data.get('name') or '<unnamed>'}: {exc}")
        return False
    except Exception as exc:  # noqa: BLE001 - 逐题隔离，记录后继续
        conn.execute(f"ROLLBACK TO {savepoint}")
        conn.execute(f"RELEASE {savepoint}")
        stats["errors"] += 1
        stats["error_samples"].append(f"{type(exc).__name__}: {exc}"[:200])
        return False


def _insert_options_conn(conn, sub_question_id: int, options: list[str], stats: dict) -> set[str]:
    labels: set[str] = set()
    for index, option in enumerate(options):
        if not isinstance(option, str):
            continue
        parsed = parse_option(option)
        if parsed is None:
            continue
        label, content = parsed
        conn.execute(
            "INSERT INTO sub_options(sub_question_id, label, content, sort_order) VALUES(?,?,?,?)",
            (sub_question_id, label, content, index),
        )
        labels.add(label)
    return labels


def import_directory(conn, dir_path: Path, stats: dict, source: str | None = None) -> None:
    if not dir_path.is_dir():
        stats["errors"] += 1
        stats["error_samples"].append(f"源目录不存在: {dir_path}")
        return
    files = sorted(dir_path.glob("*.json"))
    if not files:
        stats["errors"] += 1
        stats["error_samples"].append(f"源目录没有 JSON 文件: {dir_path}")
        return
    print(f"\n[*] 导入: {dir_path} ({len(files)} 个文件)")
    for index, filepath in enumerate(files, 1):
        try:
            with open(filepath, "r", encoding="utf-8-sig") as stream:
                data = json.load(stream)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            # 单个文件读不出来不代表整库不可用：跳过、计数、列出文件名。
            stats["unparseable"] += 1
            stats["unparseable_samples"].append(f"{filepath.name}: {type(exc).__name__}")
            continue
        records = data if isinstance(data, list) else [data]
        for record in records:
            stats["total"] += 1
            if source is not None and isinstance(record, dict):
                record = {**record, "source": source}
            import_question(conn, record, stats)
        if index % 1000 == 0:
            conn.commit()
            print(f"  [{index}/{len(files)}] 插入 {stats['inserted']} "
                  f"跳过 {stats['skipped']} 错误 {stats['errors']}")
    conn.commit()


def update_subject_counts(conn) -> None:
    conn.execute("""
        UPDATE subjects SET question_count = (
            SELECT COUNT(*) FROM questions WHERE questions.subject_id = subjects.id
        )
    """)
    conn.commit()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="题库 JSON → SQLite（默认预演）")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--vault-dir", type=Path, default=VAULT_DIR)
    parser.add_argument("--undefined-dir", type=Path, default=UNDEFINED_DIR)
    parser.add_argument("--input-dir", type=Path, action="append",
                        help="只导入指定目录（支持单题对象与章节数组，可重复指定）")
    parser.add_argument("--incremental", action="store_true",
                        help="以现有库为基础增量合并，保留已有题目与 ID")
    parser.add_argument("--source", help="为本次导入题目统一设置来源")
    parser.add_argument("--skip-fts", action="store_true")
    parser.add_argument("--vacuum", action="store_true")
    add_safety_arguments(parser)
    args = parser.parse_args(argv)

    db_path = Path(args.db)
    run = run_from_args(args, name="json-to-sqlite", default_run_root=db_path.parent / "runs")

    try:
        staged = StagedDatabase(db_path, run)
    except DatabaseSafetyError as exc:
        print(f"[!] {exc}", file=sys.stderr)
        return 2

    conn = staged.connect()
    if args.incremental:
        try:
            if not db_path.is_file():
                raise DatabaseSafetyError(f"增量导入要求现有数据库: {db_path}")
            if any(Path(str(db_path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
                raise DatabaseSafetyError("增量发布要求数据库已关闭且没有 SQLite sidecar")
            with closing(sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)) as existing:
                if read_schema_version(existing) != SCHEMA_VERSION:
                    raise DatabaseSafetyError("现有数据库 schema 版本不兼容，拒绝增量导入")
                existing.backup(conn)
            run.event("incremental_seed", source=db_path)
        except (sqlite3.Error, DatabaseSafetyError) as exc:
            staged.abort(str(exc))
            print(f"[!] {exc}", file=sys.stderr)
            return 2
    create_schema(conn)

    stats = {"total": 0, "inserted": 0, "skipped": 0, "errors": 0,
             "downgraded_a3": 0, "reclassified_multi": 0, "unusable": 0,
             "unparseable": 0, "error_samples": [], "unusable_samples": [],
             "unparseable_samples": [], "notes": []}

    for directory in args.input_dir or [args.vault_dir, args.undefined_dir]:
        import_directory(conn, directory, stats, args.source)

    if stats["errors"]:
        # 必须先关闭临时库，否则 Windows 上文件仍被占用、无法清理。
        staged.abort(f"导入出现 {stats['errors']} 个错误，拒绝发布")
        print(f"[!] 导入出错，未发布数据库。样本: {stats['error_samples'][:3]}")
        run.summary()
        return 1
    if args.incremental and (stats["unparseable"] or stats["unusable"]):
        staged.abort("增量导入含无法解析或不完整题目，拒绝发布")
        print(f"[!] 无法解析 {stats['unparseable']}，不完整 {stats['unusable']}")
        return 1
    if stats["inserted"] == 0 and args.incremental and stats["total"] > 0:
        staged.abort("全部题目已存在，数据库保持不变")
        print("[*] 全部题目已存在，数据库保持不变")
        return 0
    if stats["inserted"] == 0:
        staged.abort("没有插入任何题目，拒绝发布")
        run.summary()
        return 1

    update_subject_counts(conn)
    if not args.skip_fts:
        count = rebuild_fts(conn)
        print(f"[*] FTS5 索引: {count} 条")
    if args.vacuum and run.apply:
        conn.execute("VACUUM")

    published = staged.finish()
    run.summary()

    print(f"[*] schema v{SCHEMA_VERSION} | 总数 {stats['total']} | 插入 {stats['inserted']} "
          f"| 跳过 {stats['skipped']}")
    if stats["downgraded_a3"]:
        print(f"[!] {stats['downgraded_a3']} 道 A3/A4 缺少子题，已按 A1 导入")
    if stats["reclassified_multi"]:
        print(f"[!] {stats['reclassified_multi']} 道题标注为单选但答案是多字母，已按多选导入")
    if stats["unusable"]:
        print(f"[!] {stats['unusable']} 道题采集不完整（缺题干/答案/选项），已跳过：")
        for sample in stats["unusable_samples"][:5]:
            print(f"      {sample}")
    if stats["unparseable"]:
        print(f"[!] {stats['unparseable']} 个源文件无法解析，已跳过：")
        for sample in stats["unparseable_samples"][:5]:
            print(f"      {sample}")
    if published:
        print(f"[√] 已发布: {db_path}")
        return 0
    if run.dry_run:
        print(f"[dry-run] 未发布。加 --apply 才会写入 {db_path}")
        return 0
    print(f"[!] 发布失败: {db_path}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
