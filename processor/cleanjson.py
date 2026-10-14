"""Repair files that are concatenations of the same JSON object repeated.

Uses JSONDecoder.raw_decode to split the stream; only rewrites the file when
every decoded object is identical to the first. Dry-run by default.
"""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args
from processor.paths import collect_json_files, ensure_directory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_DECODER = json.JSONDecoder()


def repair_content(content: str) -> str:
    """Return repaired text if content is repeated identical JSON objects,
    else raise ValueError."""
    idx = 0
    n = len(content)
    objects = []
    while idx < n:
        while idx < n and content[idx].isspace():
            idx += 1
        if idx >= n:
            break
        obj, idx = _DECODER.raw_decode(content, idx)
        objects.append(obj)
    if len(objects) == 1:
        return content  # already a single valid JSON object; leave bytes untouched
    if len(objects) != 2:
        raise ValueError(f"expected at most 2 concatenated objects, got {len(objects)}")
    first = objects[0]
    if any(o != first for o in objects[1:]):
        raise ValueError("concatenated objects differ; refusing to rewrite")
    return json.dumps(first, ensure_ascii=False, indent=2)


def process(run: SafeRun, directory_path: str) -> None:
    if not ensure_directory(run, directory_path):
        return
    for path in collect_json_files(directory_path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    content = fh.read()
                repaired = repair_content(content)
                if repaired != content:
                    run.write_text(path, repaired, overwrite=True)
            except Exception:
                run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "undefined"))
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="cleanjson", default_run_root=args.directory)
    process(run, args.directory)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
