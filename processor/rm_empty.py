"""Quarantine empty or empty-content JSON files. Dry-run by default."""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def is_empty_json(path: str) -> bool:
    if os.path.getsize(path) == 0:
        return True
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return not data
    except json.JSONDecodeError:
        return False


def process(run: SafeRun, directory: str) -> None:
    if not ensure_directory(run, directory):
        return
    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(directory, filename)
        try:
            if is_empty_json(path):
                run.quarantine(path, reason="empty json")
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "tests_json_vault"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="rm_empty", default_run_root=args.directory)
    process(run, args.directory)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
