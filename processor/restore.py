"""Restore original files recorded in a processor backup manifest.

Only the originals are restored. Newly written output files and quarantined
files are deliberately kept on disk. A restore refuses to overwrite a file
that changed after processing, and refuses when a backup checksum does not
match the manifest.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from processor.safety import (
    SafeRun,
    add_safety_arguments,
    checked_path,
    file_digest,
    run_from_args,
)


def _read_manifest(manifest_path: Path) -> list[dict]:
    records = []
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def restore_manifest(manifest: str | Path, run: SafeRun) -> None:
    manifest_path = checked_path(manifest)
    try:
        records = _read_manifest(manifest_path)
    except Exception as exc:
        run.error(str(exc), path=manifest_path)
        return

    backups: dict = {}
    written: dict = {}
    moved_sources: set = set()
    for record in records:
        action = record.get("action")
        if action == "backup":
            backups.setdefault(record["source"], record)
        elif action in ("write", "publish_database"):
            written[record["destination"]] = record["sha256"]
        elif action == "move":
            moved_sources.add(record["source"])

    if not backups:
        run.error("清单中没有可恢复的原文件备份", path=manifest_path)
        return

    plans = []
    try:
        for source_name, record in backups.items():
            source = checked_path(source_name)
            backup = checked_path(record["backup"])
            if not backup.is_file() or file_digest(backup) != record["sha256"]:
                raise ValueError(f"备份缺失或校验失败: {backup}")
            for suffix in ("-wal", "-shm", "-journal"):
                if Path(str(source) + suffix).exists():
                    raise ValueError(f"请先关闭并 checkpoint 该数据库再恢复: {source}{suffix}")
            if source.exists():
                actual = file_digest(source)
                if actual == record["sha256"]:
                    continue
                if source_name not in written or actual != written[source_name]:
                    raise ValueError(f"文件在处理后被再次修改，拒绝覆盖: {source}")
            elif source_name not in moved_sources and source_name not in written:
                raise ValueError(f"原文件意外缺失: {source}")
            plans.append((source, backup))
    except Exception as exc:
        run.error(str(exc), path=manifest_path)
        return

    for source, backup in plans:
        run.write_bytes(source, backup.read_bytes(), overwrite=source.exists())
    run.event("restore_outputs_retained", path=manifest_path,
              message="新生成的输出与隔离文件保留在磁盘，未被删除。")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="从 manifest.jsonl 恢复原文件（默认预演）")
    parser.add_argument("manifest", type=Path, help="manifest.jsonl 路径")
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    manifest = checked_path(args.manifest)
    run = run_from_args(args, name="restore", default_run_root=manifest.parent)
    restore_manifest(manifest, run)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())