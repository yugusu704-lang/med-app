"""BSON 导入器的单条文档测试。

只调用 import_quiz_doc，不读取 .bson 文件，因此不需要 pymongo/bson 依赖。
用于验证与 JSON 导入器共用同一 schema。
"""
from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from processor import mongo_to_sqlite as M  # noqa: E402
from processor.schema import create_schema, read_schema_version, SCHEMA_VERSION  # noqa: E402


def doc(**overrides):
    base = {
        "_id": "507f1f77bcf86cd799439011",
        "type": "A1",
        "class": "内科学",
        "unit": "第一章",
        "question": "题干内容",
        "answer": "A",
        "options": [
            {"oid": "A", "text": "A.甲"},
            {"oid": "B", "text": "B.乙"},
        ],
        "analysis": {"point": "知识点", "discuss": "解析"},
        "source": "西综真题",
        "extractedYear": 2023,
    }
    base.update(overrides)
    return base


class MongoImporterTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.execute("PRAGMA foreign_keys=ON")
        create_schema(self.conn)
        self.stats = {"total": 0, "inserted": 0, "skipped": 0, "errors": 0,
                      "error_samples": []}

    def add(self, document):
        self.stats["total"] += 1
        return M.import_quiz_doc(self.conn, document, self.stats)

    def test_uses_shared_schema_and_version(self):
        self.assertEqual(read_schema_version(self.conn), SCHEMA_VERSION)

    def test_single_choice_document(self):
        self.assertTrue(self.add(doc()))
        row = self.conn.execute(
            "SELECT type, stem, answer, source, extracted_year FROM questions"
        ).fetchone()
        self.assertEqual(row, ("A1", "题干内容", "A", "西综真题", 2023))
        labels = [r[0] for r in self.conn.execute(
            "SELECT label FROM options ORDER BY sort_order")]
        self.assertEqual(labels, ["A", "B"])

    def test_b_and_c_types_are_stored(self):
        self.add(doc(_id="id-b", type="B", question="配伍题"))
        self.add(doc(_id="id-c", type="C", question="配伍不定题"))
        types = {r[0] for r in self.conn.execute("SELECT type FROM questions")}
        self.assertEqual(types, {"B", "C"})

    def test_a3_requires_sub_questions(self):
        self.assertFalse(self.add(doc(_id="id-a3", type="A3", mainQuestion="共用题干")))
        self.assertEqual(self.stats["errors"], 1)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0], 0)

    def test_a3_with_sub_questions(self):
        document = doc(
            _id="id-a3",
            type="A3",
            mainQuestion="共用题干",
            subQuizs=[{
                "subQuizId": 0,
                "question": "子题一",
                "answer": "B",
                "options": [{"oid": "A", "text": "A.甲"}, {"oid": "B", "text": "B.乙"}],
            }],
        )
        self.assertTrue(self.add(document))
        row = self.conn.execute(
            "SELECT sub_quiz_id, stem, answer FROM sub_questions").fetchone()
        self.assertEqual(row, (0, "子题一", "B"))
        sub_labels = [r[0] for r in self.conn.execute(
            "SELECT label FROM sub_options ORDER BY sort_order")]
        self.assertEqual(sub_labels, ["A", "B"])
        # 子题文本进入检索列
        stored = self.conn.execute("SELECT sub_stem FROM questions").fetchone()[0]
        self.assertIn("子题一", stored)

    def test_duplicate_mongo_id_is_skipped_not_failed(self):
        self.add(doc())
        self.assertFalse(self.add(doc()))
        self.assertEqual(self.stats["skipped"], 1)
        self.assertEqual(self.stats["errors"], 0)

    def test_same_stem_different_answer_is_not_deduped(self):
        """同题干不同答案不能算重复（真实题库里存在）。"""
        self.add(doc(_id="id-1"))
        self.add(doc(_id="id-2", class_="", answer="B"))
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
