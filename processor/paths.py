"""Shared source-directory validation for the file processors."""
from __future__ import annotations

import os


def ensure_directory(run, directory: str, *, label: str = "source") -> bool:
    """Return True when the directory exists; otherwise record an error."""
    if os.path.isdir(directory):
        return True
    run.error(f"{label} directory is missing: {directory}")
    return False

def collect_json_files(directory: str) -> list[str]:
    """Snapshot the input files up front.

    Backups and run directories are created *inside* the tree being processed,
    so a live os.walk() would pick up its own output and rewrite it again.
    """
    found = []
    for base, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in sorted(files):
            if name.endswith(".json"):
                found.append(os.path.join(base, name))
    return found

