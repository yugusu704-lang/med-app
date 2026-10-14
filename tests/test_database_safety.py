"""database_safety 与导入器安全行为的临时 unittest。"""

import argparse
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.database_safety import (
    StagedDatabase,
    DatabaseSafetyError,
    is_sidecar,
    verify_readonly,
)
from processor.json_to_sqlite import compute_payload_hash, UNCLASSIFIED_UNIT


def _make_db(path: Path, rows: int = 1) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    for i in range(rows):
        conn.execute("INSERT INTO t (v) VALUES (?)", (f"v{i}",))
    conn.commit()
    conn.close()


class TestSafeRunContract(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as td:
            run = SafeRun(Path(td) / "runs", name="x", dry_run=True)
            self.assertFalse(run.apply)
            target = Path(td) / "out.txt"
            self.assertFalse(run.write_text(target, "hi"))
            self.assertFalse(target.exists())
            self.assertIsNone(run.run_dir)
            s = run.summary()
            self.assertTrue(s["dry_run"])
            self.assertEqual(s["events"], 1)

    def test_apply_writes_and_events(self):
        with tempfile.TemporaryDirectory() as td:
            run = SafeRun(Path(td), name="x", dry_run=False)
            self.assertTrue(run.apply)
            target = run.run_dir / "a.json"
            self.assertTrue(run.write_json(target, {"a": 1}))
            self.assertTrue(target.exists())
            run.error("boom")
            s = run.summary()
            self.assertEqual(s["error_count"], 1)
            self.assertTrue((run.run_dir / "manifest.json").exists())
            self.assertTrue((run.run_dir / "events.jsonl").exists())

    def test_add_safety_arguments(self):
        parser = argparse.ArgumentParser()
        add_safety_arguments(parser)
        args = parser.parse_args([])
        self.assertFalse(args.apply)
        run = run_from_args(args, "n", Path(tempfile.gettempdir()) / "rr")
        self.assertTrue(run.dry_run)
        args2 = parser.parse_args(["--apply"])
        run2 = run_from_args(args2, "n", Path(tempfile.gettempdir()) / "rr2")
        self.assertFalse(run2.dry_run)


class TestStagedDatabase(unittest.TestCase):
    def test_sidecar_rejected(self):
        self.assertTrue(is_sidecar("a.db-wal"))
        self.assertTrue(is_sidecar("a.db-shm"))
        self.assertFalse(is_sidecar("a.db"))
        with tempfile.TemporaryDirectory() as td:
            run = SafeRun(td, name="x", dry_run=True)
            with self.assertRaises(DatabaseSafetyError):
                StagedDatabase(Path(td) / "a.db-wal", run)

    def test_dry_run_finish_returns_false_and_no_destination(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "sub" / "out.db"
            run = SafeRun(Path(td) / "runs", name="x", dry_run=True)
            staged = StagedDatabase(dest, run)
            conn = staged.connect()
            conn.execute("CREATE TABLE t (id INTEGER)")
            conn.execute("INSERT INTO t VALUES (1)")
            ok = staged.finish()
            self.assertFalse(ok)
            # dry-run 不创建 destination 父目录/db
            self.assertFalse(dest.exists())
            self.assertFalse(dest.parent.exists())

    def test_apply_publish_and_old_db_preserved(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.db"
            _make_db(dest, rows=3)
            old_bytes = dest.read_bytes()

            run = SafeRun(Path(td) / "runs", name="x", dry_run=False)
            staged = StagedDatabase(dest, run)
            conn = staged.connect()
            conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            conn.execute("INSERT INTO t (v) VALUES ('new')")
            conn.commit()
            ok = staged.finish()
            self.assertTrue(ok)

            # destination 被替换且通过只读校验
            self.assertTrue(verify_readonly(dest)["ok"])
            conn2 = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
            n = conn2.execute("SELECT COUNT(*) FROM t").fetchone()[0]
            conn2.close()
            self.assertEqual(n, 1)

            # 旧库被备份且 verified，run 目录无 sidecar 残留
            backups = list(run.run_dir.glob("backup-*"))
            self.assertEqual(len(backups), 1)
            self.assertTrue(verify_readonly(backups[0])["ok"])
            self.assertNotEqual(dest.read_bytes(), old_bytes)
            # manifest 已写
            self.assertTrue((run.run_dir / "publish-manifest.json").exists())
            # 没有遗留 staging 文件
            self.assertEqual(list(Path(td).glob("*.staging-*")), [])

    def test_apply_fresh_destination(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "new.db"
            run = SafeRun(Path(td) / "runs", name="x", dry_run=False)
            staged = StagedDatabase(dest, run)
            conn = staged.connect()
            conn.execute("CREATE TABLE t (id INTEGER)")
            conn.commit()
            self.assertTrue(staged.finish())
            self.assertTrue(verify_readonly(dest)["ok"])


class TestJsonImporterHelpers(unittest.TestCase):
    def test_payload_hash_excludes_metadata(self):
        a = {"test": "题干", "cls": "内科", "name": "f1", "numb": 1, "id": 9}
        b = {"test": "题干", "cls": "内科", "name": "f2", "numb": 2, "id": 10}
        self.assertEqual(compute_payload_hash(a), compute_payload_hash(b))
        c = {"test": "别的", "cls": "内科"}
        self.assertNotEqual(compute_payload_hash(a), compute_payload_hash(c))

    def test_unclassified_unit_constant(self):
        self.assertEqual(UNCLASSIFIED_UNIT, "未分类")


class TestJsonImporterDryRun(unittest.TestCase):
    def test_main_dry_run_creates_nothing(self):
        from processor import json_to_sqlite

        with tempfile.TemporaryDirectory() as td:
            vault = Path(td) / "vault"
            vault.mkdir()
            (vault / "a.json").write_text(json.dumps({
                "cls": "内科", "test": "题干1", "answer": "A",
                "option": ["A.甲", "B.乙"], "unit": "",
            }), encoding="utf-8")
            undef = Path(td) / "undef"
            undef.mkdir()
            # 导入器现在对空源目录是 fail-closed 的，所以给第二个源一份有效数据。
            (undef / "b.json").write_text(json.dumps({
                "cls": "内科", "test": "题干2", "answer": "A",
                "option": ["A.甲", "B.乙"], "unit": "第一章", "mode": "A1",
            }), encoding="utf-8")
            dest = Path(td) / "out" / "q.db"

            argv = sys.argv
            sys.argv = [
                "json_to_sqlite.py", "--db", str(dest),
                "--vault-dir", str(vault), "--undefined-dir", str(undef),
                "--skip-fts",
            ]
            try:
                code = json_to_sqlite.main()
            finally:
                sys.argv = argv
            self.assertEqual(code, 0)
            self.assertFalse(dest.exists())
            self.assertFalse(dest.parent.exists())


class TestMongoImporterSafety(unittest.TestCase):
    def test_empty_bson_rejected(self):
        from processor.mongo_to_sqlite import load_bson_docs

        with tempfile.TemporaryDirectory() as td:
            empty = Path(td) / "quiz.bson"
            empty.write_bytes(b"")
            with self.assertRaises(DatabaseSafetyError):
                load_bson_docs(empty)
            with self.assertRaises(DatabaseSafetyError):
                load_bson_docs(Path(td) / "missing.bson")

    def test_tar_traversal_blocked(self):
        import io
        import tarfile
        from processor.mongo_to_sqlite import extract_quiz_bson

        with tempfile.TemporaryDirectory() as td:
            tar_path = Path(td) / "evil.tar"
            with tarfile.open(tar_path, "w") as tf:
                data = b"x"
                info = tarfile.TarInfo("../evil.txt")
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
            run = SafeRun(td, name="x", dry_run=False)
            with self.assertRaises(DatabaseSafetyError):
                extract_quiz_bson(tar_path, Path(td) / "out", run)
            self.assertFalse((Path(td) / "evil.txt").exists())


if __name__ == "__main__":
    unittest.main()
