"""Normalize verbose 'mode' values in JSON files. Dry-run by default."""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import collect_json_files, ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MODE_REPLACEMENTS = {
    "A1型题": "A1",
    "A2型题": "A2",
    "A3型题": "A3",
    "A4型题": "A4",
    "B型题": "B",
    "X型题": "X",
    "单选题": "A1",
    "多选题": "X",
}


def process(run: SafeRun, directory: str) -> None:
    if not ensure_directory(run, directory):
        return
    for path in collect_json_files(directory):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict) and data.get("mode") in MODE_REPLACEMENTS:
                    data["mode"] = MODE_REPLACEMENTS[data["mode"]]
                    run.write_json(path, data)
            except Exception:
                run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "tests_json_vault"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="changemode", default_run_root=args.directory)
    process(run, args.directory)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
