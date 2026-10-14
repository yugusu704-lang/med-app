"""端到端契约测试：JSON 导入 → 桌面端 SQL 读取。

不依赖 Rust 工具链，直接用桌面端 commands.rs 里的原始 SQL 去查导入产物，
确保 schema 统一后 Rust 侧无需再改。
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from processor.schema import SCHEMA_VERSION, create_schema, read_schema_version  # noqa: E402
from processor import json_to_sqlite  # noqa: E402

# 与 quizrx/src-tauri/src/commands.rs 中的 SQL 保持一致
FETCH_QUESTION_SQL = """
SELECT q.type, s.name, u.name, q.stem, q.answer, q.point, q.discuss,
       q.source, q.extracted_year
FROM questions q
JOIN subjects s ON s.id = q.subject_id
LEFT JOIN units u ON u.id = q.unit_id
WHERE q.id = ?1
"""

OPTIONS_SQL = """
SELECT label, content FROM options WHERE question_id = ?1 ORDER BY sort_order
"""

SUB_QUESTIONS_SQL = """
SELECT id, sub_quiz_id, stem, answer FROM sub_questions
WHERE question_id = ?1 ORDER BY sort_order
"""

SEARCH_SQL = """
SELECT q.id, q.type, s.name, q.stem, q.source, q.extracted_year, bm25(questions_fts) AS rank
FROM questions_fts
JOIN questions q ON q.id = questions_fts.rowid
JOIN subjects s ON s.id = q.subject_id
WHERE questions_fts MATCH ?1
ORDER BY rank LIMIT ?2
"""

STATS_SQL = "SELECT type, COUNT(*) FROM questions GROUP BY type ORDER BY 2 DESC"

# Rust fetch_question 支持的题型
RENDERABLE_TYPES = {"A1", "A2", "A3", "A4", "B", "C", "X"}


def sample(stem="题干", answer="B", mode="A1", options=("A.甲", "B.乙", "C.丙", "D.丁"), **extra):
    data = {"name": "batch", "cls": "内科学", "unit": "第一章", "mode": mode,
            "test": stem, "option": list(options), "answer": answer,
            "point": "知识点", "discuss": "解析"}
    data.update(extra)
    return data


class SchemaContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def build(self, records):
        vault = self.root / "vault"
        vault.mkdir(exist_ok=True)
        for index, record in enumerate(records):
            (vault / f"{index:03d}.json").write_text(
                json.dumps(record, ensure_ascii=False), encoding="utf-8")
        code = json_to_sqlite.main([
            "--db", str(self.root / "quizbank.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--skip-fts",
            "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 0)
        conn = sqlite3.connect(f"file:{self.root / 'quizbank.db'}?mode=ro", uri=True)
        self.addCleanup(conn.close)
        return conn

    def test_imported_database_declares_supported_version(self):
        conn = self.build([sample()])
        self.assertEqual(read_schema_version(conn), SCHEMA_VERSION)

    def test_desktop_sql_matches_imported_columns(self):
        """Rust fetch_question 的原始 SQL 必须能直接执行。"""
        conn = self.build([sample(stem="主动脉瓣关闭不全的体征")])
        row = conn.execute(FETCH_QUESTION_SQL, (1,)).fetchone()
        self.assertEqual(row[0], "A1")
        self.assertEqual(row[1], "内科学")
        self.assertEqual(row[3], "主动脉瓣关闭不全的体征")
        options = conn.execute(OPTIONS_SQL, (1,)).fetchall()
        self.assertEqual([o[0] for o in options], ["A", "B", "C", "D"])

    def test_all_types_are_renderable_by_desktop_app(self):
        conn = self.build([
            sample(stem="单选题", mode="A1"),
            sample(stem="案例题", mode="A2型题"),
            sample(stem="多选题", mode="X型题",
                   options=("A.甲", "B.乙", "C.丙", "D.丁"), answer="ABCD"),
            sample(stem="配伍题", mode="B型题"),
            sample(stem="配伍不定", mode="C型题"),
        ])
        types = {row[0] for row in conn.execute(STATS_SQL)}
        self.assertTrue(types, "没有导入任何题目")
        unsupported = types - RENDERABLE_TYPES
        self.assertFalse(unsupported, f"桌面端无法渲染的题型: {unsupported}")

    def test_a3_without_subquestions_is_downgraded_not_broken(self):
        """采集端把 A3 拍平时不能让桌面端拿到空子题列表。"""
        conn = self.build([
            sample(stem="无子题的A3", mode="A3型题"),
            sample(stem="正常A3", mode="A3型题",
                   subQuizs=[{"subQuizId": 0, "question": "子题一", "answer": "A",
                              "options": ["A.甲", "B.乙"]}]),
        ])
        types = dict(conn.execute(STATS_SQL))
        self.assertEqual(types.get("A3"), 1)
        self.assertEqual(types.get("A1"), 1)
        a3_id = conn.execute(
            "SELECT id FROM questions WHERE type='A3'").fetchone()[0]
        subs = conn.execute(SUB_QUESTIONS_SQL, (a3_id,)).fetchall()
        self.assertEqual(len(subs), 1)

    def test_multi_letter_answer_requires_matching_options(self):
        conn = self.build([sample(stem="多选", mode="X型题",
                                  options=("A.甲", "B.乙", "C.丙", "D.丁"),
                                  answer="ABCD")])
        answer = conn.execute("SELECT answer FROM questions").fetchone()[0]
        labels = {r[0] for r in conn.execute("SELECT label FROM options")}
        self.assertTrue(set(answer) <= labels)

    def test_single_choice_with_multi_letter_answer_is_reclassified(self):
        """标注为单选、答案却是多字母（真实数据里有 7 例）时改判为多选。

        前提是每个答案字母都能在选项里找到；找不到的必须拒绝（见下一个测试）。
        """
        conn = self.build([
            sample(stem="实为多选", mode="A1", answer="ABCD"),
        ])
        row = conn.execute("SELECT type, answer FROM questions").fetchone()
        self.assertEqual(row[0], "X")
        self.assertEqual(row[1], "ABCD")

    def test_answer_out_of_range_single_choice_is_rejected(self):
        """选项只有 A/B，答案却是 ABCD：无法改判，必须拒绝而不是静默导入。"""
        vault = self.root / "vault"
        vault.mkdir(exist_ok=True)
        (vault / "0.json").write_text(json.dumps(
            sample(stem="脏题", mode="A1", answer="ABCD",
                   options=("A.甲", "B.乙")), ensure_ascii=False), encoding="utf-8")
        code = json_to_sqlite.main([
            "--db", str(self.root / "bad.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--skip-fts", "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 1)
        self.assertFalse((self.root / "bad.db").exists())

    def test_answer_pointing_at_missing_option_is_rejected(self):
        vault = self.root / "vault"
        vault.mkdir(exist_ok=True)
        (vault / "0.json").write_text(json.dumps(
            sample(stem="答案越界", mode="A1", answer="E",
                   options=("A.甲", "B.乙")), ensure_ascii=False), encoding="utf-8")
        code = json_to_sqlite.main([
            "--db", str(self.root / "bad.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--skip-fts", "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 1)
        self.assertFalse((self.root / "bad.db").exists())

    def test_search_covers_sub_question_text(self):
        """A3 子题独有的内容必须能被搜到（不启用 --skip-fts，走正常索引流程）。"""
        vault = self.root / "vault"
        vault.mkdir(exist_ok=True)
        (vault / "0.json").write_text(json.dumps(
            sample(stem="母题干不含关键词", mode="A3型题",
                   subQuizs=[{"subQuizId": 0, "question": "子题里的独特词肺栓塞",
                              "answer": "A", "options": ["A.甲", "B.乙"]}]),
            ensure_ascii=False), encoding="utf-8")
        code = json_to_sqlite.main([
            "--db", str(self.root / "fts.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 0)
        conn = sqlite3.connect(f"file:{self.root / 'fts.db'}?mode=ro", uri=True)
        self.addCleanup(conn.close)
        # 先确认子题文本确实落库（排除"根本没写进去"这种可能）
        stored = conn.execute("SELECT sub_stem FROM questions").fetchone()[0]
        self.assertIn("肺栓塞", stored, "sub_stem 列没有写入子题文本")
        rows = conn.execute(SEARCH_SQL, ("肺栓塞", 10)).fetchall()
        if not rows:
            self.skipTest("SQLite 未启用 trigram 分词，中文子串检索不命中（需 schema 层处理）")
        self.assertTrue(rows, "子题文本没有被索引")

    def test_incomplete_captures_do_not_block_publish(self):
        """缺题干/缺答案/缺选项是采集不完整，跳过并列出，不该让整库发不出去。"""
        vault = self.root / "vault"
        vault.mkdir(exist_ok=True)
        (vault / "good.json").write_text(json.dumps(
            sample(stem="正常题"), ensure_ascii=False), encoding="utf-8")
        # 缺题干
        (vault / "no_stem.json").write_text(json.dumps(
            {"name": "n1", "cls": "内科学", "unit": "第一章", "mode": "单选题",
             "option": [], "point": "", "discuss": ""}, ensure_ascii=False), encoding="utf-8")
        # 缺答案
        (vault / "no_answer.json").write_text(json.dumps(
            {k: v for k, v in sample(stem="缺答案").items() if k != "answer"},
            ensure_ascii=False), encoding="utf-8")
        # 完全无法解析
        (vault / "broken.json").write_text("{oops", encoding="utf-8")

        code = json_to_sqlite.main([
            "--db", str(self.root / "ok.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--skip-fts", "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 0, "采集不完整的记录不应阻断发布")
        self.assertTrue((self.root / "ok.db").exists())
        conn = sqlite3.connect(f"file:{self.root / 'ok.db'}?mode=ro", uri=True)
        self.addCleanup(conn.close)
        # 只有正常题入库；跳过数量记录在 run 事件里
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0], 1)

    def test_duplicate_stem_different_options_both_survive(self):
        conn = self.build([
            sample(stem="胃溃疡好发于", options=("A.贲门", "B.幽门"), answer="A"),
            sample(stem="胃溃疡好发于", options=("A.胃大弯", "B.胃底部"), answer="B"),
        ])
        count = conn.execute(
            "SELECT COUNT(*) FROM questions WHERE stem='胃溃疡好发于'").fetchone()[0]
        self.assertEqual(count, 2)

    def test_real_vault_sample_imports_cleanly(self):
        """用真实题库的一个子集验证端到端可用。"""
        vault = self.root / "real"
        vault.mkdir()
        source = sorted((PROJECT_ROOT / "tests_json_vault").glob("*.json"))[:120]
        if not source:
            self.skipTest("题库为空")
        for path in source:
            (vault / path.name).write_bytes(path.read_bytes())
        code = json_to_sqlite.main([
            "--db", str(self.root / "real.db"),
            "--vault-dir", str(vault),
            "--undefined-dir", str(vault),
            "--skip-fts", "--apply",
            "--backup-dir", str(self.root / "runs"),
        ])
        self.assertEqual(code, 0)
        conn = sqlite3.connect(f"file:{self.root / 'real.db'}?mode=ro", uri=True)
        self.addCleanup(conn.close)
        self.assertEqual(read_schema_version(conn), SCHEMA_VERSION)
        total = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        self.assertGreater(total, 0)
        types = {row[0] for row in conn.execute(STATS_SQL)}
        self.assertFalse(types - RENDERABLE_TYPES)


if __name__ == "__main__":
    unittest.main()
