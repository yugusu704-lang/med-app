"""Tests for the hardened file processors. Temporary directories only."""
import json
import os
import shutil
import sys
import tempfile
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from processor.safety import SafeRun  # noqa: E402
from processor import (changemode, cleanjson, dedupe, guess_undefine,  # noqa: E402
                       remove, rm_empty, rm_undefined, tomd)


def question(stem="题干", options=("A.甲", "B.乙"), answer="A", **extra):
    data = {"name": "x", "cls": "内科学", "unit": "第一章", "mode": "A1",
            "test": stem, "option": list(options), "answer": answer,
            "point": "p", "discuss": "d"}
    data.update(extra)
    return data


class ProcessorTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def mk(self, name, obj=None, raw=None):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(raw if raw is not None else json.dumps(obj, ensure_ascii=False))
        return path

    def read(self, path):
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def read_json(self, path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def make_run(self, apply=True):
        run_root = os.path.join(self.tmp, "runs")
        os.makedirs(run_root, exist_ok=True)
        return SafeRun(run_root, name="test", dry_run=not apply)

    def quarantine_files(self, run):
        base = run.run_dir / "quarantine"
        return [str(p) for p in base.rglob("*") if p.is_file()] if base.exists() else []


class TestRmEmpty(ProcessorTestCase):
    def test_quarantines_empty_files_and_empty_content(self):
        a = self.mk("a.json", raw="")
        b = self.mk("b.json", obj={})
        c = self.mk("c.json", obj=question())
        run = self.make_run()
        rm_empty.process(run, self.tmp)
        self.assertEqual(len(run.errors), 0)
        self.assertFalse(os.path.exists(a))
        self.assertFalse(os.path.exists(b))
        self.assertTrue(os.path.exists(c))
        self.assertEqual(len(self.quarantine_files(run)), 2)

    def test_invalid_json_is_kept(self):
        bad = self.mk("bad.json", raw="{oops")
        run = self.make_run()
        rm_empty.process(run, self.tmp)
        self.assertTrue(os.path.exists(bad))
        self.assertEqual(len(run.errors), 0)

    def test_dry_run_keeps_everything(self):
        a = self.mk("a.json", raw="")
        run = self.make_run(apply=False)
        rm_empty.process(run, self.tmp)
        self.assertTrue(os.path.exists(a))
        self.assertEqual(len(run.errors), 0)


class TestRmUndefined(ProcessorTestCase):
    def test_quarantines_missing_mode(self):
        keep = self.mk("keep.json", obj=question())
        drop = self.mk("drop.json", obj={k: v for k, v in question().items() if k != "mode"})
        run = self.make_run()
        rm_undefined.process(run, self.tmp)
        self.assertTrue(os.path.exists(keep))
        self.assertFalse(os.path.exists(drop))
        self.assertEqual(len(self.quarantine_files(run)), 1)


class TestDedupe(ProcessorTestCase):
    def test_identical_duplicate_is_quarantined(self):
        a = self.mk("a.json", obj=question())
        b = self.mk("b.json", obj=question())
        run = self.make_run()
        dedupe.process(run, self.tmp)
        # Name order decides which copy is kept; the later one is quarantined.
        self.assertTrue(os.path.exists(a))
        self.assertFalse(os.path.exists(b))
        self.assertEqual(len(run.errors), 0)

    def test_same_stem_different_options_is_kept(self):
        a = self.mk("a.json", obj=question(stem="胃溃疡好发于", options=("A.贲门", "B.幽门")))
        b = self.mk("b.json", obj=question(stem="胃溃疡好发于", options=("A.胃大弯", "B.胃窦")))
        run = self.make_run()
        dedupe.process(run, self.tmp)
        self.assertTrue(os.path.exists(a))
        self.assertTrue(os.path.exists(b))
        self.assertEqual(len(run.errors), 0)

    def test_missing_test_is_reported_not_deduplicated(self):
        a = self.mk("a.json", obj={"cls": "内科学"})
        b = self.mk("b.json", obj={"cls": "内科学"})
        run = self.make_run()
        dedupe.process(run, self.tmp)
        self.assertEqual(len(run.errors), 2)
        self.assertTrue(os.path.exists(a))
        self.assertTrue(os.path.exists(b))

    def test_dry_run_removes_nothing(self):
        a = self.mk("a.json", obj=question())
        b = self.mk("b.json", obj=question())
        run = self.make_run(apply=False)
        dedupe.process(run, self.tmp)
        self.assertTrue(os.path.exists(a))
        self.assertTrue(os.path.exists(b))


class TestChangeMode(ProcessorTestCase):
    def test_dry_run_changes_nothing(self):
        path = self.mk("q.json", obj=question(mode="A1型题"))
        run = self.make_run(apply=False)
        changemode.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "A1型题")

    def test_replacements_applied_with_backup(self):
        path = self.mk("q.json", obj=question(mode="A1型题"))
        original = self.read(path)
        run = self.make_run()
        changemode.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "A1")
        backups = list((run.run_dir / "backups").glob("*"))
        self.assertEqual(len(backups), 1)
        with open(backups[0], encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)

    def test_invalid_json_is_reported(self):
        self.mk("bad.json", raw="{oops")
        run = self.make_run()
        changemode.process(run, self.tmp)
        self.assertEqual(len(run.errors), 1)


class TestCleanJson(ProcessorTestCase):
    def test_repeated_identical_objects_are_repaired(self):
        body = json.dumps(question(), ensure_ascii=False)
        path = self.mk("dup.json", raw=body + body)
        run = self.make_run()
        cleanjson.process(run, self.tmp)
        self.assertEqual(len(run.errors), 0)
        self.assertEqual(self.read_json(path)["test"], "题干")

    def test_differing_objects_are_left_untouched(self):
        a = json.dumps(question(stem="甲"), ensure_ascii=False)
        b = json.dumps(question(stem="乙"), ensure_ascii=False)
        path = self.mk("diff.json", raw=a + b)
        run = self.make_run()
        cleanjson.process(run, self.tmp)
        self.assertEqual(len(run.errors), 1)
        self.assertEqual(self.read(path), a + b)

    def test_valid_single_object_is_unchanged(self):
        body = json.dumps(question(), ensure_ascii=False)
        path = self.mk("ok.json", raw=body)
        run = self.make_run()
        cleanjson.process(run, self.tmp)
        self.assertEqual(len(run.errors), 0)
        self.assertEqual(self.read(path), body)

    def test_truncated_file_is_left_untouched(self):
        body = json.dumps(question(), ensure_ascii=False)
        path = self.mk("cut.json", raw=body[:-5])
        run = self.make_run()
        cleanjson.process(run, self.tmp)
        self.assertEqual(self.read(path), body[:-5])


class TestGuessUndefine(ProcessorTestCase):
    def test_single_letter_answer_sets_a1(self):
        path = self.mk("q.json", obj={k: v for k, v in question().items() if k != "mode"})
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "A1")

    def test_prefixed_single_answer_sets_a1(self):
        data = question(answer="答案：C")
        del data["mode"]
        path = self.mk("q.json", obj=data)
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "A1")

    def test_multi_letter_answer_sets_x(self):
        data = question(options=("A.甲", "B.乙", "C.丙", "D.丁"), answer="ABCD")
        del data["mode"]
        path = self.mk("q.json", obj=data)
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "X")

    def test_existing_mode_is_kept(self):
        path = self.mk("q.json", obj=question(mode="B"))
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        self.assertEqual(self.read_json(path)["mode"], "B")
        self.assertEqual(len(run.errors), 0)

    def test_bad_answer_is_reported_without_write(self):
        data = question(answer="见解析")
        del data["mode"]
        path = self.mk("q.json", obj=data)
        original = self.read(path)
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        self.assertEqual(len(run.errors), 1)
        self.assertEqual(self.read(path), original)

    def test_file_stays_single_valid_json_object(self):
        data = question(answer="ABCD", options=("A.甲", "B.乙", "C.丙", "D.丁"))
        del data["mode"]
        path = self.mk("q.json", obj=data)
        run = self.make_run()
        guess_undefine.process(run, self.tmp)
        json.loads(self.read(path))


class TestToMd(ProcessorTestCase):
    def test_renders_valid_file(self):
        self.mk("q.json", obj=question())
        out = os.path.join(self.tmp, "md")
        run = self.make_run()
        tomd.process(run, self.tmp, out, overwrite=False)
        md = os.path.join(out, "q.md")
        self.assertTrue(os.path.exists(md))
        with open(md, encoding="utf-8") as fh:
            content = fh.read()
        self.assertIn("# Q", content)
        self.assertIn("# A", content)

    def test_missing_keys_error_without_output(self):
        self.mk("q.json", obj={"test": "题干"})
        out = os.path.join(self.tmp, "md")
        run = self.make_run()
        tomd.process(run, self.tmp, out, overwrite=False)
        self.assertEqual(len(run.errors), 1)
        self.assertFalse(os.path.exists(os.path.join(out, "q.md")))

    def test_existing_output_is_preserved_without_overwrite(self):
        self.mk("q.json", obj=question())
        out = os.path.join(self.tmp, "md")
        os.makedirs(out)
        existing = os.path.join(out, "q.md")
        with open(existing, "w", encoding="utf-8") as fh:
            fh.write("OLD")
        run = self.make_run()
        tomd.process(run, self.tmp, out, overwrite=False)
        with open(existing, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "OLD")

    def test_overwrite_with_apply_backs_up(self):
        self.mk("q.json", obj=question())
        out = os.path.join(self.tmp, "md")
        os.makedirs(out)
        existing = os.path.join(out, "q.md")
        with open(existing, "w", encoding="utf-8") as fh:
            fh.write("OLD")
        run = self.make_run()
        tomd.process(run, self.tmp, out, overwrite=True)
        with open(existing, encoding="utf-8") as fh:
            self.assertIn("# Q", fh.read())
        self.assertEqual(len(list((run.run_dir / "backups").glob("*"))), 1)

    def test_broken_question_never_reuses_previous_content(self):
        self.mk("a.json", obj=question(stem="第一题"))
        self.mk("b.json", obj={"test": "坏题"})
        out = os.path.join(self.tmp, "md")
        run = self.make_run()
        tomd.process(run, self.tmp, out, overwrite=False)
        self.assertFalse(os.path.exists(os.path.join(out, "b.md")))
        with open(os.path.join(out, "a.md"), encoding="utf-8") as fh:
            self.assertIn("第一题", fh.read())


class TestRemove(ProcessorTestCase):
    def test_quarantines_matching_md(self):
        hit = self.mk("hit.md", raw="包含 医考帮 标记")
        keep = self.mk("keep.md", raw="无关内容")
        run = self.make_run()
        remove.process(run, self.tmp, "医考帮")
        self.assertFalse(os.path.exists(hit))
        self.assertTrue(os.path.exists(keep))
        self.assertEqual(len(self.quarantine_files(run)), 1)

    def test_dry_run_moves_nothing(self):
        hit = self.mk("hit.md", raw="医考帮")
        run = self.make_run(apply=False)
        remove.process(run, self.tmp, "医考帮")
        self.assertTrue(os.path.exists(hit))


class TestCliContract(unittest.TestCase):
    def test_apply_and_dry_run_are_mutually_exclusive(self):
        for module in (dedupe, rm_empty, guess_undefine, changemode, tomd):
            with self.assertRaises(SystemExit):
                module.main(["--apply", "--dry-run"])

    def test_default_run_is_dry_run(self):
        with tempfile.TemporaryDirectory() as td:
            dup = os.path.join(td, "a.json")
            with open(dup, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(question(), ensure_ascii=False))
            dup2 = os.path.join(td, "b.json")
            with open(dup2, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(question(), ensure_ascii=False))
            code = dedupe.main([td])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(dup))
            self.assertTrue(os.path.exists(dup2))
            self.assertFalse(os.path.exists(os.path.join(td, ".processor_runs")))

    def test_missing_directory_returns_nonzero(self):
        with tempfile.TemporaryDirectory() as td:
            missing = os.path.join(td, "does-not-exist")
            self.assertEqual(rm_empty.main([missing]), 1)


if __name__ == "__main__":
    unittest.main()