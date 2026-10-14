"""跨语言契约检查：Python 侧 schema 与 Rust 侧 SQL/题型必须一致。

本机没有 Rust 工具链时也能运行，用于防止两侧再次漂移：
    1. processor/schema.py 的版本号必须等于 db.rs 的 SUPPORTED_SCHEMA_VERSION；
    2. schema.py 里 questions/options/sub_questions 的列必须覆盖 commands.rs
       引用的列名；
    3. Python 导入器可能产出的每种题型，commands.rs 都必须能处理。
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from processor.schema import KNOWN_TYPES, SCHEMA_SQL, SCHEMA_VERSION  # noqa: E402

RUST_DIR = PROJECT_ROOT / "quizrx" / "src-tauri" / "src"
COMMANDS_RS = RUST_DIR / "commands.rs"
DB_RS = RUST_DIR / "db.rs"
MODELS_RS = RUST_DIR / "models.rs"


def _table_columns(sql: str) -> dict[str, set[str]]:
    """从 CREATE TABLE 语句里取出每张表的列名。"""
    tables: dict[str, set[str]] = {}
    for match in re.finditer(
        r"CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\((.*?)\n\);", sql, re.S
    ):
        name, body = match.group(1), match.group(2)
        columns = set()
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            token = line.split()[0].strip(",")
            if token.upper() in {"UNIQUE", "PRIMARY", "FOREIGN", "CHECK", "CONSTRAINT"}:
                continue
            columns.add(token)
        tables[name] = columns
    return tables


class RustSchemaAlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for path in (COMMANDS_RS, DB_RS, MODELS_RS):
            if not path.exists():
                raise unittest.SkipTest(f"缺少 Rust 源文件: {path}")
        cls.schema_columns = _table_columns(SCHEMA_SQL)
        cls.commands = COMMANDS_RS.read_text(encoding="utf-8")
        cls.db = DB_RS.read_text(encoding="utf-8")
        cls.models = MODELS_RS.read_text(encoding="utf-8")

    def test_schema_version_matches_rust(self):
        match = re.search(
            r"SUPPORTED_SCHEMA_VERSION:\s*i64\s*=\s*(\d+)", self.db)
        self.assertIsNotNone(match, "db.rs 中没有 SUPPORTED_SCHEMA_VERSION")
        self.assertEqual(int(match.group(1)), SCHEMA_VERSION,
                         "Rust 与 Python 的 schema 版本号不一致")

    def test_rust_queries_reference_existing_columns(self):
        """commands.rs 里对 questions 的查询列必须都存在于共享 schema。"""
        question_columns = self.schema_columns["questions"]
        # 抓取 SELECT ... FROM questions 之间的列表达式
        for match in re.finditer(
            r"SELECT\s+(.*?)\s+FROM\s+questions\s+q", self.commands, re.S
        ):
            projection = match.group(1)
            for ref in re.findall(r"\bq\.(\w+)", projection):
                self.assertIn(ref, question_columns,
                              f"commands.rs 引用了不存在的列 questions.{ref}")
        # 抓取 WHERE / 子查询里对 q.* 的引用
        for ref in re.findall(r"\bq\.(\w+)", self.commands):
            self.assertIn(ref, question_columns,
                          f"commands.rs 引用了不存在的列 questions.{ref}")

    def test_rust_option_and_subquestion_columns_exist(self):
        for table in ("options", "sub_options", "sub_questions", "subjects", "units"):
            self.assertIn(table, self.schema_columns, f"schema 缺少表 {table}")
        # FTS 表只索引 stem / sub_stem
        fts = re.search(r"USING fts5\((.*?)\)", SCHEMA_SQL, re.S)
        self.assertIsNotNone(fts)
        self.assertIn("stem", fts.group(1))
        self.assertIn("sub_stem", fts.group(1))

    def test_every_importer_type_is_handled_by_rust(self):
        """Python 可能写出的题型，Rust 必须都有分支，否则取题会被跳过。

        分支有两种写法：`"A1" => Question::A1(...)` 和
        `"A3" => { ... Question::A3(...) }`，都要认。
        """
        arms = set(re.findall(r'"(\w+)"\s*=>', self.commands))
        arms |= set(re.findall(r'"(\w+)"\s*=>\s*\{', self.commands))
        missing = set(KNOWN_TYPES) - arms
        self.assertFalse(missing, f"commands.rs 未处理这些题型: {sorted(missing)}")

    def test_rust_question_enum_covers_importer_types(self):
        serde_names = set(re.findall(r'#\[serde\(rename = "(\w+)"\)\]', self.models))
        missing = set(KNOWN_TYPES) - serde_names
        self.assertFalse(missing, f"models.rs 的 Question 枚举缺: {sorted(missing)}")

    def test_quiz_config_types_is_optional(self):
        """前端会省略 types，Rust 必须给默认值，否则 IPC 反序列化直接失败。"""
        block = re.search(r"pub struct QuizConfig\s*\{(.*?)\n\}", self.models, re.S)
        self.assertIsNotNone(block, "找不到 QuizConfig 定义")
        body = block.group(1)
        self.assertIn("pub types", body)
        self.assertIn("serde(default)", body,
                      "QuizConfig.types 缺少 #[serde(default)]")

    def test_resource_mapping_targets_quizbank_db(self):
        conf = (PROJECT_ROOT / "quizrx" / "src-tauri" / "tauri.conf.json").read_text(
            encoding="utf-8")
        self.assertIn("quizbank.db", conf,
                      "tauri.conf.json 没有把数据库声明为打包资源")
        # 显式对象映射，避免 ../ 被重写成 _up_/ 后找不到文件
        self.assertRegex(conf, r'"\.\./\.\./quizbank\.db"\s*:\s*"quizbank\.db"',
                         "资源应显式映射到 quizbank.db")


if __name__ == "__main__":
    unittest.main()
