"""Guess and set 'mode' for JSON files whose mode is missing or empty.

Mode is inferred from the normalized answer: a single letter A-Z maps to
'A1'; multiple letters map to 'X'. Files whose answers cannot be normalized
are recorded as errors and never written. Dry-run by default.
"""
import json
import os
import re
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_LETTERS_RE = re.compile(r"[A-Z]")


def normalize_answer(answer) -> str:
    """Extract the canonical answer letters (uppercase A-Z, sorted order
    preserved as they appear). Raises ValueError when impossible."""
    if not isinstance(answer, str):
        raise ValueError(f"answer is not a string: {answer!r}")
    letters = _LETTERS_RE.findall(answer)
    if not letters:
        raise ValueError(f"no answer letters in {answer!r}")
    return "".join(letters)


def guess_mode(answer) -> str:
    letters = normalize_answer(answer)
    return "A1" if len(letters) == 1 else "X"


def process(run: SafeRun, folder_path: str) -> None:
    if not ensure_directory(run, folder_path):
        return
    for filename in sorted(os.listdir(folder_path)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(folder_path, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                raise ValueError("top-level JSON is not an object")
            if data.get("mode"):
                continue
            data["mode"] = guess_mode(data.get("answer"))
            run.write_json(path, data)
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "undefined"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="guess_undefine",
                        default_run_root=args.directory)
    process(run, args.directory)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
