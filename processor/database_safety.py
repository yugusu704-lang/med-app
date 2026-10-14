"""
SQLite 数据库安全发布（StagedDatabase）。

核心原则（第 1 段：绝不触碰旧库）:
    - 绝不 unlink 旧库本体或其 sidecar（-wal/-shm/-journal）。
    - 绝不以读写方式打开活跃旧库；仅可用只读 URI 做校验。
    - 拒绝接受任何 sidecar 作为目标/源。

第 2 段（分阶段发布）:
    1. 在同目录创建临时数据库（destination.staging-*），写入全部内容。
    2. apply 前两次只读校验（destination 不存在 vs 旧库可读一致性）。
    3. run.backup 旧库（verified：复制 + 只读完整性校验）。
    4. sqlite3 checkpoint DELETE 模式整理临时库。
    5. os.replace(staged -> destination)，之后再次只读校验。
    6. 写 manifest / event。

dry-run:
    finish() 关闭临时库并返回 False；不创建 destination 父目录/db；
    允许在临时目录（tempfile）中工作。
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

from .safety import SafeRun

SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


class DatabaseSafetyError(RuntimeError):
    """数据库安全检查失败。"""


def is_sidecar(path: str | Path) -> bool:
    """判断路径是否是 SQLite sidecar 文件。"""
    p = str(path)
    return any(p.endswith(sfx) for sfx in SIDECAR_SUFFIXES)


def _reject_sidecar(path: Path) -> None:
    if is_sidecar(path):
        raise DatabaseSafetyError(
            f"拒绝把 sidecar 文件当作数据库: {path} "
            f"(sidecar 后缀: {SIDECAR_SUFFIXES})"
        )


def _readonly_connect(path: Path) -> sqlite3.Connection:
    """以只读 URI 打开数据库（绝不写入/修改原库）。"""
    uri = f"file:{path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def verify_readonly(path: Path) -> dict:
    """对数据库做只读完整性校验。

    返回 {"ok": bool, "detail": str}。绝不修改数据库。
    """
    result = {"ok": False, "detail": ""}
    conn = None
    try:
        conn = _readonly_connect(path)
        row = conn.execute("PRAGMA integrity_check").fetchone()
        ok = bool(row) and str(row[0]).lower() == "ok"
        result["ok"] = ok
        result["detail"] = str(row[0]) if row else "no row"
    except sqlite3.Error as exc:  # 文件不存在/损坏等
        result["detail"] = f"sqlite error: {exc}"
    finally:
        if conn is not None:
            conn.close()
    return result


class StagedDatabase:
    """分阶段 SQLite 发布器。

    用法:
        staged = StagedDatabase(destination, run)
        conn = staged.connect()       # 打开临时库（或 dry-run 临时文件）
        ... 写入全部内容 ...
        ok = staged.finish()          # dry-run: 关闭并返回 False
                                      # apply : 校验→备份→checkpoint→replace→校验→manifest
    """

    def __init__(self, destination: str | Path, run: SafeRun):
        self.destination = Path(destination)
        _reject_sidecar(self.destination)
        self.run = run
        self._conn: sqlite3.Connection | None = None
        self._staging_path: Path | None = None
        self._temp_dir: tempfile.TemporaryDirectory | None = None
        self._backup_path: Path | None = None
        self._finished = False

    # ─── 临时库路径 ───────────────────────────────────────

    def _make_staging_path(self) -> Path:
        """创建临时数据库路径。

        apply 模式: 与 destination 同目录，文件名 destination.staging-<ts>.db。
        dry-run 模式: 系统临时目录（不创建 destination 父目录/本体）。
        """
        if self.run.dry_run:
            self._temp_dir = tempfile.TemporaryDirectory(prefix="ykb-staged-")
            return Path(self._temp_dir.name) / "staging.db"
        dest = self.destination
        dest.parent.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        staging = dest.parent / f"{dest.name}.staging-{ts}.db"
        i = 1
        while staging.exists():
            i += 1
            staging = dest.parent / f"{dest.name}.staging-{ts}-{i}.db"
        return staging

    def connect(self) -> sqlite3.Connection:
        """打开（必要时创建）临时数据库连接。"""
        if self._conn is not None:
            return self._conn
        self._staging_path = self._make_staging_path()
        self.run.event(
            "staging_open",
            staging=self._staging_path,
            destination=self.destination,
            dry_run=self.run.dry_run,
        )
        conn = sqlite3.connect(str(self._staging_path))
        conn.execute("PRAGMA journal_mode=DELETE")  # 传统回滚日志，便于最终 checkpoint
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("PRAGMA foreign_keys=ON")
        self._conn = conn
        return conn

    # ─── 校验与备份 ───────────────────────────────────────

    def _verify_staging_twice(self) -> None:
        """apply 前对临时库做两次只读校验。"""
        assert self._staging_path is not None
        for attempt in (1, 2):
            res = verify_readonly(self._staging_path)
            if not res["ok"]:
                raise DatabaseSafetyError(
                    f"临时库只读校验失败（第 {attempt} 次）: {res['detail']}"
                )
        self.run.event("staging_verified", staging=self._staging_path, attempts=2)

    def _backup_existing(self) -> Path | None:
        """run.backup 旧库：复制到 run 目录并做只读校验（verified）。

        绝不 unlink/修改旧库；只复制。若旧库不存在则跳过。
        """
        dest = self.destination
        if not dest.exists():
            return None
        run_dir = self.run.run_dir
        if run_dir is None:
            raise DatabaseSafetyError("apply 模式必须有 run 目录")
        backup = run_dir / f"backup-{dest.name}"
        shutil.copy2(dest, backup)  # copy2 保留元数据；绝不删除源
        res = verify_readonly(backup)
        if not res["ok"]:
            raise DatabaseSafetyError(f"旧库备份只读校验失败: {res['detail']}")
        self._backup_path = backup
        self.run.event("backup", src=dest, backup=backup, verified=True)
        return backup

    def _checkpoint(self) -> None:
        """对临时库做 checkpoint（DELETE 模式）并收尾。"""
        assert self._staging_path is not None
        conn = sqlite3.connect(str(self._staging_path))
        try:
            conn.execute("PRAGMA journal_mode=DELETE")
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.commit()
        finally:
            conn.close()
        self.run.event("checkpoint", staging=self._staging_path, mode="DELETE")

    def _cleanup_staging_sidecars(self) -> None:
        """清理临时库的 sidecar（只针对我们创建的 staging 文件，绝不碰旧库）。"""
        assert self._staging_path is not None
        for sfx in SIDECAR_SUFFIXES:
            p = Path(str(self._staging_path) + sfx)
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass

    # ─── 收尾 ─────────────────────────────────────────────

    def abort(self, reason: str) -> bool:
        """放弃发布：关闭连接、清理临时库，绝不触碰目标文件。"""
        self.close()
        if self.run.dry_run:
            if self._temp_dir is not None:
                self._temp_dir.cleanup()
                self._temp_dir = None
            return False
        self.run.error(reason)
        self._cleanup_staging()
        return False

    def close(self) -> None:
        """关闭临时库连接。Windows 上未关闭的文件无法删除。"""
        if self._conn is not None:
            try:
                self._conn.rollback()
                self._conn.close()
            except sqlite3.Error:
                pass
            self._conn = None

    def _cleanup_staging(self) -> None:
        """删除我们自己的临时库与 sidecar。"""
        self._cleanup_staging_sidecars()
        if self._staging_path is not None and self._staging_path.exists():
            try:
                self._staging_path.unlink()
            except OSError as exc:
                self.run.error(f"无法删除临时库 {self._staging_path}: {exc}")

    def finish(self) -> bool:
        """完成发布。dry-run: 关闭临时库并返回 False。"""
        if self._finished:
            return False
        self._finished = True

        if self._conn is not None:
            self._conn.commit()
            self._conn.close()
            self._conn = None

        if self.run.dry_run:
            self.run.event(
                "dry_run_finish",
                destination=self.destination,
                staging=self._staging_path,
            )
            if self._temp_dir is not None:
                self._temp_dir.cleanup()
                self._temp_dir = None
            return False

        assert self._staging_path is not None
        dest = self.destination
        try:
            # 1) apply 前两次只读校验临时库
            self._verify_staging_twice()
            # 2) 备份旧库（verified），绝不删除旧库
            self._backup_existing()
            # 3) checkpoint（DELETE）
            self._checkpoint()
            # 4) 原子替换 staged -> destination
            os.replace(self._staging_path, dest)
            self.run.event("replace", staging=self._staging_path, destination=dest)
            # 5) replace 后只读校验
            res = verify_readonly(dest)
            if not res["ok"]:
                raise DatabaseSafetyError(f"发布后只读校验失败: {res['detail']}")
            self.run.event("post_replace_verified", destination=dest)
            # 6) manifest / event
            manifest = {
                "destination": str(dest),
                "backup": str(self._backup_path) if self._backup_path else None,
                "published_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "verified": True,
            }
            self.run.write_json(
                (self.run.run_dir or dest.parent) / "publish-manifest.json",
                manifest,
            )
            self.run.event("publish_manifest", destination=dest)
            self._cleanup_staging_sidecars()
            return True
        except DatabaseSafetyError as exc:
            self.run.error(str(exc), destination=dest)
            # 发布失败：保留旧库（我们从未删除它），清理临时库
            self._cleanup_staging()
            return False

    def __enter__(self) -> "StagedDatabase":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
        if self.run.dry_run and self._temp_dir is not None:
            self._temp_dir.cleanup()
            self._temp_dir = None
