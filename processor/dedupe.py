"""Quarantine duplicate JSON files whose normalized content matches.

Normalization: parse JSON, drop collection-specific keys ('name', 'numb'),
dump canonically. Files missing a 'test' key are recorded as errors and are
never deduplicated against the None key. Dry-run by default.
"""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDED_KEYS = ("name", "numb")


def normalize(path: str) -> str:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top-level JSON is not an object")
    if "test" not in data:
        raise KeyError(f"{path}: missing 'test' key")
    stripped = {k: v for k, v in data.items() if k not in EXCLUDED_KEYS}
    return json.dumps(stripped, ensure_ascii=False, sort_keys=True)


def process(run: SafeRun, folder_path: str) -> None:
    if not ensure_directory(run, folder_path):
        return
    seen: dict[str, str] = {}
    for filename in sorted(os.listdir(folder_path)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(folder_path, filename)
        try:
            key = normalize(path)
            if key in seen:
                run.quarantine(path, reason=f"duplicate of {seen[key]}")
            else:
                seen[key] = filename
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "tests_json_vault"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="dedupe", default_run_root=args.directory)
    process(run, args.directory)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
