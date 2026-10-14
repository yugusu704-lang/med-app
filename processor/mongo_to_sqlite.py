"""
QuizBank MongoDB BSON → SQLite 转换脚本（安全版）。

默认 dry-run；加 --apply 才通过 StagedDatabase 发布。
- bson 惰性可选导入（import 时不强制）。
- tar 安全读取 quiz.bson，校验来源（路径穿越防护）。
- 空源/缺源拒绝，不先删旧库。
- A3 payload 参与哈希；subQuizs fail closed。

用法:
    python processor/mongo_to_sqlite.py --bson-dir /path/QuizBank   # dry-run
    python processor/mongo_to_sqlite.py --tar /path.tar.gz --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import tarfile
from datetime import datetime
from pathlib import Path

from .safety import SafeRun, add_safety_arguments, run_from_args
from .schema import create_schema as create_shared_schema, rebuild_fts, SCHEMA_VERSION
from .database_safety import StagedDatabase, DatabaseSafetyError

bson = None  # 惰性导入


def _load_bson_module():
    """惰性加载 bson；不可用时给出清晰错误。"""
    global bson
    if bson is not None:
        return bson
    try:
        import bson as _bson  # type: ignore
    except ImportError as exc:
        raise DatabaseSafetyError(
            "bson 模块不可用（pip install pymongo）。dry-run 校验路径不需要它。"
        ) from exc
    bson = _bson
    return bson


DEFAULT_TAR = Path("/mnt/disk3/QuizBank.tar.gz")
DEFAULT_EXTRACT_DIR = Path("/tmp/quizbank_extract")
DEFAULT_BSON_DIR = DEFAULT_EXTRACT_DIR / "QuizBank"
DEFAULT_DB = Path("/mnt/disk3/ykb_copyer/quizbank.db")



def parse_option(opt: object) -> tuple[str, str]:
    if not isinstance(opt, dict):
        return "", str(opt)
    label = str(opt.get("oid", "")).strip()
    content = str(opt.get("text", "")).strip()
    if content and label and content.startswith(label + "."):
        content = content[len(label) + 1:].strip()
    return label, content


def normalize_answer(answer) -> str:
    if answer is None:
        return ""
    if isinstance(answer, str):
        return answer.strip()
    if isinstance(answer, list):
        return "".join(str(a).strip() for a in answer)
    return str(answer)


def compute_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def compute_payload_hash(doc: dict) -> str:
    """完整 payload 哈希（含 A3 subQuizs），排除元数据 _id。"""
    payload = {k: v for k, v in doc.items() if k not in ("_id", "processedAt")}
    canon = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def create_schema(conn: sqlite3.Connection) -> None:
    create_shared_schema(conn)


def get_or_create_subject(conn: sqlite3.Connection, name: str) -> int:
    name = (name or "").strip() or "未分类"
    cur = conn.execute("SELECT id FROM subjects WHERE name = ?", (name,))
    row = cur.fetchone()
    if row is not None:
        return int(row[0])
    cur = conn.execute("INSERT INTO subjects (name) VALUES (?)", (name,))
    assert cur.lastrowid is not None
    return int(cur.lastrowid)


def get_or_create_unit(conn: sqlite3.Connection, subject_id: int, name: str) -> int | None:
    name = (name or "").strip()
    if not name:
        return None
    cur = conn.execute(
        "SELECT id FROM units WHERE subject_id = ? AND name = ?", (subject_id, name)
    )
    row = cur.fetchone()
    if row is not None:
        return int(row[0])
    cur = conn.execute(
        "INSERT INTO units (subject_id, name) VALUES (?, ?)", (subject_id, name)
    )
    assert cur.lastrowid is not None
    return int(cur.lastrowid)


def import_quiz_doc(conn: sqlite3.Connection, doc: dict, stats: dict) -> bool:
    """导入单条 quiz 文档；单题 savepoint rollback。"""
    sp = f"sp_q_{stats['total']}"
    conn.execute(f"SAVEPOINT {sp}")
    try:
        q_type = (doc.get("type") or "").strip()
        subject_name = (doc.get("class") or "").strip()
        unit_name = (doc.get("unit") or "").strip()

        is_a3 = q_type == "A3"
        stem = ((doc.get("mainQuestion") if is_a3 else doc.get("question")) or "").strip()
        if not stem:
            raise ValueError("empty stem")

        answer = normalize_answer(doc.get("answer"))

        # A3: subQuizs fail closed（无有效子题则整题拒绝）
        sub_quizs = doc.get("subQuizs") or []
        if is_a3:
            if not isinstance(sub_quizs, list) or not sub_quizs:
                raise ValueError("A3 without subQuizs (fail closed)")
            valid = [s for s in sub_quizs
                     if isinstance(s, dict) and (s.get("question") or "").strip()]
            if not valid:
                raise ValueError("A3 subQuizs all invalid (fail closed)")

        analysis = doc.get("analysis") or {}
        point = (analysis.get("point") or "").strip()
        discuss = (analysis.get("discuss") or "").strip()

        mongo_id = str(doc["_id"])
        source = (doc.get("source") or "").strip() or None
        extracted_year = doc.get("extractedYear")
        processed_at = iso(doc.get("processedAt"))

        subject_id = get_or_create_subject(conn, subject_name)
        unit_id = get_or_create_unit(conn, subject_id, unit_name) if unit_name else None

        # A3 payload 参与哈希
        sub_stem = "\n".join(
            (s.get("question") or "").strip()
            for s in (sub_quizs if isinstance(sub_quizs, list) else [])
            if isinstance(s, dict) and (s.get("question") or "").strip()
        )
        content_hash = compute_payload_hash(doc)

        cur = conn.execute(
            """
            INSERT OR IGNORE INTO questions
                (mongo_id, type, subject_id, unit_id, source, extracted_year,
                 stem, answer, point, discuss, sub_stem, processed_at, content_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (mongo_id, q_type, subject_id, unit_id, source, extracted_year,
             stem, answer, point, discuss, sub_stem, processed_at, content_hash),
        )
        if cur.rowcount == 0:
            stats["skipped"] += 1
            conn.execute(f"RELEASE {sp}")
            return False

        assert cur.lastrowid is not None
        question_id = int(cur.lastrowid)

        if not is_a3:
            for idx, opt in enumerate(doc.get("options") or []):
                label, content = parse_option(opt)
                if not label:
                    continue
                conn.execute(
                    "INSERT INTO options (question_id, label, content, sort_order)"
                    " VALUES (?, ?, ?, ?)",
                    (question_id, label, content, idx),
                )
        else:
            for idx, sub in enumerate(sub_quizs):
                if not isinstance(sub, dict):
                    continue
                sub_stem = (sub.get("question") or "").strip()
                if not sub_stem:
                    continue
                sub_answer = normalize_answer(sub.get("answer"))
                sub_mongo_id = str(sub.get("_id", ""))
                sub_quiz_id = sub.get("subQuizId", idx)
                cur2 = conn.execute(
                    "INSERT INTO sub_questions"
                    " (question_id, sub_quiz_id, mongo_id, stem, answer, sort_order)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (question_id, sub_quiz_id, sub_mongo_id, sub_stem, sub_answer, idx),
                )
                assert cur2.lastrowid is not None
                sub_id = int(cur2.lastrowid)
                for o_idx, opt in enumerate(sub.get("options") or []):
                    label, content = parse_option(opt)
                    if not label:
                        continue
                    conn.execute(
                        "INSERT INTO sub_options"
                        " (sub_question_id, label, content, sort_order)"
                        " VALUES (?, ?, ?, ?)",
                        (sub_id, label, content, o_idx),
                    )

        conn.execute(f"RELEASE {sp}")
        stats["inserted"] += 1
        return True
    except Exception as exc:
        conn.execute(f"ROLLBACK TO {sp}")
        conn.execute(f"RELEASE {sp}")
        stats["errors"] += 1
        stats["error_samples"].append(str(exc)[:200])
        return False


def update_subject_counts(conn: sqlite3.Connection) -> None:
    conn.execute("""
        UPDATE subjects SET question_count = (
            SELECT COUNT(*) FROM questions WHERE questions.subject_id = subjects.id
        )
    """)
    conn.commit()


def build_fts(conn: sqlite3.Connection) -> None:
    rebuild_fts(conn)


# ─── 安全 tar 读取 ──────────────────────────────────────────

def _safe_tar_members(tf: tarfile.TarFile, extract_dir: Path) -> list[tarfile.TarInfo]:
    """过滤 tar 成员：仅允许常规文件且目标路径必须在 extract_dir 内。"""
    base = extract_dir.resolve()
    safe: list[tarfile.TarInfo] = []
    for member in tf.getmembers():
        if not member.isreg():
            continue
        target = (extract_dir / member.name).resolve()
        if not str(target).startswith(str(base) + str(Path("/"))[0]) and target != base:
            # 路径穿越防护
            if not str(target).startswith(str(base)):
                continue
        safe.append(member)
    return safe


def extract_quiz_bson(tar_path: Path, extract_dir: Path, run: SafeRun) -> Path:
    """安全解压 tar 并定位 quiz.bson；校验来源。"""
    if not tar_path.is_file():
        raise DatabaseSafetyError(f"tar 源不存在: {tar_path}")
    extract_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r:*") as tf:
        members = _safe_tar_members(tf, extract_dir)
        quiz_members = [m for m in members if m.name.endswith("quiz.bson")]
        if not quiz_members:
            raise DatabaseSafetyError(f"tar 中缺少 quiz.bson: {tar_path}")
        for m in members:
            tf.extract(m, extract_dir)
    run.event("tar_extract", tar=tar_path, extract_dir=extract_dir)
    candidates = sorted(extract_dir.rglob("quiz.bson"))
    if not candidates:
        raise DatabaseSafetyError(f"解压后找不到 quiz.bson: {extract_dir}")
    quiz_path = candidates[0]
    if quiz_path.stat().st_size == 0:
        raise DatabaseSafetyError(f"quiz.bson 为空: {quiz_path}")
    return quiz_path


def load_bson_docs(bson_path: Path):
    """流式读取 BSON。空文件拒绝。"""
    _load_bson_module()
    if not bson_path.exists():
        raise DatabaseSafetyError(f"quiz.bson 不存在: {bson_path}")
    if bson_path.stat().st_size == 0:
        raise DatabaseSafetyError(f"quiz.bson 为空: {bson_path}")
    docs = []
    with open(bson_path, "rb") as f:
        for doc in bson.decode_file_iter(f):
            docs.append(doc)
    if not docs:
        raise DatabaseSafetyError(f"quiz.bson 无文档: {bson_path}")
    return docs


def main() -> int:
    parser = argparse.ArgumentParser(description="QuizBank BSON → SQLite（安全版）")
    parser.add_argument("--tar", type=str, default=str(DEFAULT_TAR))
    parser.add_argument("--bson-dir", type=str, default=None,
                        help="已解压的 BSON 目录（跳过解压）")
    parser.add_argument("--db", type=str, default=str(DEFAULT_DB))
    parser.add_argument("--skip-fts", action="store_true")
    parser.add_argument("--vacuum", action="store_true")
    add_safety_arguments(parser)
    args = parser.parse_args()

    db_path = Path(args.db)
    run = run_from_args(args, name="mongo-to-sqlite",
                        default_run_root=db_path.parent / "runs")

    try:
        # 确定 quiz.bson（校验来源；空/缺源拒绝；不先删旧库）
        if args.bson_dir:
            quiz_path = Path(args.bson_dir) / "quiz.bson"
        else:
            quiz_path = extract_quiz_bson(Path(args.tar), DEFAULT_EXTRACT_DIR, run)
        if not quiz_path.exists():
            raise DatabaseSafetyError(f"quiz.bson 不存在: {quiz_path}")
        if quiz_path.stat().st_size == 0:
            raise DatabaseSafetyError(f"quiz.bson 为空，拒绝发布: {quiz_path}")

        staged = StagedDatabase(db_path, run)
    except DatabaseSafetyError as exc:
        print(f"[!] {exc}", file=sys.stderr)
        run.error(str(exc))
        run.summary()
        return 2

    conn = staged.connect()
    create_schema(conn)

    stats = {"total": 0, "inserted": 0, "skipped": 0, "errors": 0, "error_samples": []}

    try:
        docs = load_bson_docs(quiz_path)
    except DatabaseSafetyError as exc:
        print(f"[!] {exc}", file=sys.stderr)
        run.error(str(exc))
        run.summary()
        return 2

    print(f"[*] 加载 {len(docs)} 个文档")
    for i, doc in enumerate(docs, 1):
        stats["total"] += 1
        import_quiz_doc(conn, doc, stats)
        if i % 1000 == 0:
            conn.commit()
            print(f"  [{i}/{len(docs)}] 插入 {stats['inserted']} "
                  f"跳过 {stats['skipped']} 错误 {stats['errors']}")
    conn.commit()

    # 有错误时拒绝 publish
    if stats["errors"] > 0:
        run.error(f"导入出现 {stats['errors']} 个错误，拒绝发布",
                  samples=stats["error_samples"][:5])
        run.summary()
        print(f"[!] 导入出错，未发布。样本: {stats['error_samples'][:3]}")
        return 1

    update_subject_counts(conn)
    if not args.skip_fts:
        build_fts(conn)
    if args.vacuum and run.apply:
        conn.execute("VACUUM")

    published = staged.finish()
    summary = run.summary()
    summary["stats"] = {k: v for k, v in stats.items() if k != "error_samples"}
    print(f"[*] 统计: {stats}")
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
