"""Quarantine JSON files lacking a 'mode' key. Dry-run by default."""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def process(run: SafeRun, source_folder: str) -> None:
    if not ensure_directory(run, source_folder):
        return
    for filename in sorted(os.listdir(source_folder)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(source_folder, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if "mode" not in data:
                run.quarantine(path, reason="missing mode")
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "tests_json_vault"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="rm_undefined", default_run_root=args.source)
    process(run, args.source)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
