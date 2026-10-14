"""Convert JSON test files to Markdown. Validates fully before writing.

Existing .md files are only overwritten when --overwrite is passed; with
--apply an overwrite goes through run.write_text, which backs up first.
Dry-run by default.
"""
import json
import os
import traceback

from processor.safety import SafeRun, add_safety_arguments, run_from_args

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REQUIRED_KEYS = ("mode", "option", "unit", "cls", "test", "answer",
                 "point", "discuss")

MODE_REPLACEMENTS = {
    "C": "A1",
    "A3/A4": "A3",
    "单选题": "A1",
}


def render_markdown(data: dict) -> str:
    missing = [k for k in REQUIRED_KEYS if k not in data]
    if missing:
        raise KeyError(f"missing keys: {missing}")
    mode = str(data["mode"]).replace("型题", "")
    mode = MODE_REPLACEMENTS.get(mode, mode)
    if not isinstance(data["option"], list):
        raise TypeError("'option' must be a list")
    option = "".join(f"{i}\n" for i in data["option"])
    unit = str(data["unit"]).replace(" ", "-").replace("\xa0", "-")
    answer = str(data["answer"]).replace("答案：", "")
    return f"""---
class: {data["cls"]}
mode: {mode}
tags:
  - 医考帮
  - 习题
  - {unit}
---

# Q
{data["test"]}
{option}# A
{answer}
# D
```ad-note
title:课本出处
collapse:false
{data["point"]}
```

```ad-summary
title:解析
collapse:false
{data["discuss"]}
```

"""


def process(run: SafeRun, folder_path: str, output_folder: str,
            overwrite: bool) -> None:
    for filename in sorted(os.listdir(folder_path)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(folder_path, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                raise ValueError("top-level JSON is not an object")
            md = render_markdown(data)
            md_path = os.path.join(
                output_folder, f"{os.path.splitext(filename)[0]}.md")
            if os.path.exists(md_path) and not overwrite:
                continue
            run.write_text(md_path, md, overwrite=overwrite)
        except Exception:
            run.error(f"failed processing {path}\n{traceback.format_exc()}")


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "tests_json_vault"))
    parser.add_argument("output", nargs="?",
                        default=os.path.join(PROJECT_ROOT, "md"))
    parser.add_argument("--overwrite", action="store_true",
                        help="overwrite existing .md files (backed up when --apply)")
    add_safety_arguments(parser)
    args = parser.parse_args(argv)
    run = run_from_args(args, name="tomd", default_run_root=args.output)
    process(run, args.source, args.output, args.overwrite)
    run.summary()
    return 1 if run.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
