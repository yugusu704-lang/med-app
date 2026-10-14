"""Incremental OBE import must preserve exam IDs, hashes and searchable content."""
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from processor import json_to_sqlite as importer
from processor.schema import create_schema, rebuild_fts


def question(stem, **extra):
    return dict(cls="局部解剖学", unit="第一章 头部", numb="1", mode="A1型题",
                test=stem, option=[f"{a}. 选项{a}" for a in "ABCDE"], answer="A",
                point="教材P20", discuss="逐项解析", **extra)


class IncrementalImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / "quizbank.db"
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        conn = sqlite3.connect(self.db)
        create_schema(conn)
        stats = self.stats()
        stats["total"] += 1
        self.assertTrue(importer.import_question(conn, question("统考既有题干", name="统考"), stats))
        rebuild_fts(conn)
        conn.commit()
        self.old = conn.execute("SELECT id,source,stem,content_hash FROM questions").fetchone()
        conn.close()

    @staticmethod
    def stats():
        return dict(total=0, inserted=0, skipped=0, errors=0, unusable=0,
                    reclassified_multi=0, downgraded_a3=0, notes=[], error_samples=[], unusable_samples=[])

    def run_import(self, apply=True):
        args = ["--db", str(self.db), "--input-dir", str(self.inputs), "--incremental",
                "--source", "OBE大纲", "--backup-dir", str(self.root / "runs")]
        return importer.main(args + (["--apply"] if apply else []))

    def write(self, records):
        (self.inputs / "chapter.json").write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8-sig")

    def fingerprint(self):
        return hashlib.sha256(self.db.read_bytes()).hexdigest()

    def test_merge_preserves_old_ids_and_is_idempotent(self):
        self.write([question("头部大纲新增题一"), question("头部大纲新增题二")])
        self.assertEqual(self.run_import(), 0)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT id,source,stem,content_hash FROM questions WHERE id=?", (self.old[0],)).fetchone(), self.old)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM questions WHERE source='OBE大纲'").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM options").fetchone()[0], 15)
            self.assertEqual(conn.execute("SELECT question_count FROM subjects").fetchone()[0], 3)
            self.assertEqual(len(conn.execute("SELECT rowid FROM questions_fts WHERE questions_fts MATCH '大纲新增'").fetchall()), 2)
        before = self.fingerprint()
        self.assertEqual(self.run_import(), 0)
        self.assertEqual(self.fingerprint(), before)
        self.assertTrue(list((self.root / "runs").rglob("backup-quizbank.db")))

    def test_dry_run_and_partial_bad_batch_never_replace_existing_bank(self):
        before = self.fingerprint()
        self.write([question("头部大纲新增题")])
        self.assertEqual(self.run_import(apply=False), 0)
        self.assertEqual(self.fingerprint(), before)
        self.write([question("头部大纲新增题"), {"test": "缺答案"}])
        self.assertNotEqual(self.run_import(), 0)
        self.assertEqual(self.fingerprint(), before)

    def test_explicit_source_takes_precedence_over_legacy_name(self):
        self.write(question("大纲来源测试题", source="OBE大纲", name="其他批次"))
        self.assertEqual(self.run_import(), 0)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT source FROM questions WHERE stem='大纲来源测试题'").fetchone()[0], "OBE大纲")


if __name__ == "__main__":
    unittest.main()
