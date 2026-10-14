"""Quarantine .md files containing a search string. Dry-run by default."""
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def process(run: SafeRun, source_folder: str, search_string: str) -> None:
    if not ensure_directory(run, source_folder):
        return
    for filename in sorted(os.listdir(source_folder)):
        if not filename.endswith(".md"):
            continue
        path = os.path.join(source_folder, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                matched = search_string in fh.read()
            if matched:
                run.quarantine(path, reason=f"contains {search_string!r}")
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "md"))
    parser.add_argument("--search", default="医考帮")
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="remove", default_run_root=args.source)
    process(run, args.source, args.search)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
