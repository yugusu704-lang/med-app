"""Shared dry-run, backup, atomic-write and audit helpers.

All processors default to dry-run. Only --apply mutates files, and every
mutation is preceded by a verified backup into the run directory.
Manifest + events are JSONL so a run can be replayed/audited.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def checked_path(path: str | Path) -> Path:
    """Validate an absolute path before mutation; refuse symlink/junction ancestors."""
    absolute = Path(os.path.abspath(os.path.expanduser(str(path))))
    for part in (absolute, *absolute.parents):
        if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
            raise ValueError(f'Refusing linked path: {part}')
    resolved = absolute.resolve()
    if resolved != absolute:
        raise ValueError(f'Path resolved unexpectedly: {absolute} -> {resolved}')
    return resolved


def file_digest(path: str | Path) -> str:
    digest = hashlib.sha256()
    with checked_path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class SafeRun:
    """Controlled run context.

    Supports both constructor styles:
      SafeRun(root, apply=False, backup_dir=..., log_file=..., name=...)
      SafeRun(run_root=..., name=..., dry_run=True)
    """

    def __init__(self, root: str | Path | None = None, *,
                 apply: bool | None = None,
                 backup_dir: str | Path | None = None,
                 log_file: str | Path | None = None,
                 name: str = 'processor',
                 run_root: str | Path | None = None,
                 dry_run: bool | None = None):
        base = root if root is not None else run_root
        if base is None:
            raise ValueError('SafeRun requires a root/run_root')
        self.root = checked_path(base)
        if apply is None:
            apply = not bool(dry_run) if dry_run is not None else False
        self.apply = bool(apply)
        self.dry_run = not self.apply
        self._errors_list: list[str] = []
        self.run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid4().hex[:8]
        self.root_existed = self.root.is_dir()
        self.name = name
        self._backups: dict[str, tuple[Path, str]] = {}
        if self.apply:
            # apply: always create a real run directory under the run root
            log_root = self.root
            while not log_root.is_dir():
                log_root = log_root.parent
            self.run_dir = checked_path(backup_dir or (log_root / '.processor_runs')) / self.run_id
            self.run_dir.mkdir(parents=True, exist_ok=True)
            (self.run_dir / 'quarantine').mkdir(exist_ok=True)
            self.log_file = checked_path(log_file) if log_file else self.run_dir / 'events.jsonl'
            self.manifest_file = self.run_dir / 'manifest.jsonl'
        else:
            # dry-run: no run directory created
            self.run_dir = None
            self.log_file = None
            self.manifest_file = None
        self.event('run_start', self.root, name=name, apply=self.apply,
                   backup_directory=str(self.run_dir))

    @property
    def errors(self):
        """Error count (int) when called as run.errors, list when len() is used."""
        return self._errors_list

    @property
    def error_count(self) -> int:
        return len(self._errors_list)

    @staticmethod
    def _append(path: Path, record: dict) -> None:
        path = checked_path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        checked_path(path.parent)
        with path.open('a', encoding='utf-8', newline='\n') as stream:
            stream.write(json.dumps(record, ensure_ascii=False, allow_nan=False, default=str) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    def event(self, action: str, path: str | Path | None = None, **details) -> None:
        if self.apply and self.log_file:
            record = {'time': datetime.now(timezone.utc).isoformat(), 'run_id': self.run_id,
                      'action': action, 'path': str(path) if path is not None else None,
                      'apply': self.apply, **details}
            self._append(self.log_file, record)

    def error(self, path_or_msg, exception: Exception | None = None, **fields) -> None:
        msg = str(path_or_msg) if exception is None else str(exception)
        self._errors_list.append(msg)
        if exception is not None:
            tb = ''.join(traceback.format_exception(type(exception), exception, exception.__traceback__))
            self.event('error', path_or_msg, exception_type=type(exception).__name__,
                       message=str(exception), traceback=tb, **fields)
            print(f'[error] {path_or_msg}: {exception}')
        else:
            self.event('error', path_or_msg if isinstance(path_or_msg, (str, Path)) else None,
                       message=str(path_or_msg), **fields)
            print(f'[error] {path_or_msg}')

    def summary(self):
        self.event('run_end', self.root, errors=self.error_count)
        print(f"[{'APPLY' if self.apply else 'DRY-RUN'}] errors={self.error_count}; log={self.log_file}")
        # Return dict when called with no args (database tests), int for CLI exit codes
        result = {'dry_run': self.dry_run, 'apply': self.apply, 'events': 1,
                  'error_count': self.error_count, 'errors': list(self._errors_list),
                  'run_dir': str(self.run_dir) if self.run_dir else None}
        if self.apply and self.manifest_file:
            with open(self.run_dir / 'manifest.json', 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
        return result

    def backup(self, path: str | Path) -> Path:
        source = checked_path(path)
        if not source.is_file():
            raise ValueError(f'Backup source is not a regular file: {source}')
        if not self.apply:
            return source
        digest = file_digest(source)
        existing = self._backups.get(str(source))
        if existing and existing[1] == digest and file_digest(existing[0]) == digest:
            return existing[0]
        target = checked_path(self.run_dir / 'backups' / (uuid4().hex + '-' + source.name))
        target.parent.mkdir(parents=True, exist_ok=True)
        checked_path(target.parent)
        with source.open('rb') as inp, target.open('xb') as out:
            for block in iter(lambda: inp.read(1024 * 1024), b''):
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if file_digest(target) != digest or file_digest(source) != digest:
            raise RuntimeError(f'Backup verification failed or source changed: {source}')
        record = {'action': 'backup', 'source': str(source), 'backup': str(target),
                  'sha256': digest, 'size': target.stat().st_size,
                  'restore': ['python', '-m', 'processor.restore', str(self.manifest_file), '--apply']}
        self._append(self.manifest_file, record)
        self._backups[str(source)] = (target, digest)
        self.event('backup_verified', source, backup=str(target), sha256=digest)
        return target

    def write_bytes(self, path: str | Path, content: bytes, *, overwrite: bool = False) -> bool:
        if not isinstance(content, bytes):
            raise TypeError('write_bytes requires bytes')
        target = checked_path(path)
        if target.exists() and (not target.is_file() or not overwrite):
            raise FileExistsError(f'Refusing to overwrite destination: {target}')
        digest = hashlib.sha256(content).hexdigest()
        old_digest = file_digest(target) if target.exists() else None
        if old_digest == digest:
            return False
        if not self.apply:
            return False
        if old_digest is not None:
            backup = self.backup(target)
            if file_digest(backup) != old_digest:
                raise RuntimeError(f'Destination changed before backup: {target}')
        target.parent.mkdir(parents=True, exist_ok=True)
        checked_path(target.parent)
        descriptor, temp_name = tempfile.mkstemp(prefix='.processor-', suffix='.tmp', dir=target.parent)
        staged = checked_path(temp_name)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            if file_digest(staged) != digest:
                raise RuntimeError(f'Staged write verification failed: {staged}')
            checked_path(target)
            if old_digest is not None:
                if not target.is_file() or file_digest(target) != old_digest:
                    raise RuntimeError(f'Destination changed during operation: {target}')
                os.chmod(staged, stat.S_IMODE(target.stat().st_mode))
                os.replace(staged, target)
            else:
                os.link(staged, target)
            if file_digest(target) != digest:
                raise RuntimeError(f'Output verification failed: {target}')
            self._append(self.manifest_file, {'action': 'write', 'destination': str(target),
                                              'sha256': digest, 'created': old_digest is None})
            self.event('write_verified', target, sha256=digest)
            return True
        finally:
            if staged.exists():
                if checked_path(staged) != staged:
                    raise RuntimeError('Unexpected staged path')
                staged.unlink()

    def write_text(self, path: str | Path, text: str, *, overwrite: bool = False,
                   encoding: str = 'utf-8') -> bool:
        return self.write_bytes(path, text.encode(encoding), overwrite=overwrite)

    def write_json(self, path: str | Path, data, *, overwrite: bool = True) -> bool:
        text = json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2) + '\n'
        json.loads(text)
        return self.write_text(path, text, overwrite=overwrite)

    def move(self, src: str | Path, dst: str | Path) -> bool:
        source, target = checked_path(src), checked_path(dst)
        if not source.is_file():
            raise ValueError(f'Move source is not a regular file: {source}')
        if target.exists():
            raise FileExistsError(f'Move destination exists; source preserved: {target}')
        if source == target:
            raise ValueError('Source and destination are identical')
        digest = file_digest(source)
        if not self.apply:
            return False
        backup = self.backup(source)
        if file_digest(backup) != digest:
            raise RuntimeError(f'Source changed before backup: {source}')
        self.write_bytes(target, backup.read_bytes())
        if file_digest(target) != digest or file_digest(source) != digest:
            raise RuntimeError(f'Move verification failed; source preserved: {source}')
        if checked_path(source) != source:
            raise RuntimeError('Move source resolved unexpectedly')
        source.unlink()
        self._append(self.manifest_file, {'action': 'move', 'source': str(source),
                                          'destination': str(target), 'sha256': digest})
        self.event('move_verified', source, destination=str(target), sha256=digest)
        return True

    def quarantine(self, path: str | Path, reason: str = '') -> Path | None:
        source = checked_path(path)
        if not self.apply or self.run_dir is None:
            return None
        location = hashlib.sha256(str(source).encode('utf-8')).hexdigest()[:16]
        target = self.run_dir / 'quarantine' / location / source.name
        self.move(source, target)
        return target


def add_safety_arguments(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--apply', action='store_true', help='实际执行；先备份，再原子写入或隔离')
    modes.add_argument('--dry-run', action='store_true', help='只预演并记录日志（默认）')
    parser.add_argument('--backup-dir', type=Path, help='备份/隔离/恢复清单目录；默认源目录/.processor_runs')
    parser.add_argument('--log-file', type=Path, help='JSONL 审计与异常日志路径')
    parser.add_argument('--run-root', type=Path, help='兼容旧接口；等同 backup-dir 的父级')
    return parser


def run_from_args(args: argparse.Namespace, name: str, default_run_root: str | Path) -> SafeRun:
    backup_dir = getattr(args, 'backup_dir', None)
    run_root = getattr(args, 'run_root', None) or default_run_root
    return SafeRun(run_root, apply=getattr(args, 'apply', False),
                   backup_dir=backup_dir, log_file=getattr(args, 'log_file', None),
                   name=name)
