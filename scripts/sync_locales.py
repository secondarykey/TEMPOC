#!/usr/bin/env python3
"""Sync the shared locale JSON files from the repo-root master into both modules.

    locales/                        master — the only place translations are edited
    desktop/frontend/src/locales/   committed copy (desktop imports these)
    chrome-extension/src/locales/   committed copy (options page fetches these)

The copies must be committed because neither module can reach outside its own
directory at run/package time (the extension zip contains only src/, and the
desktop frontend imports from its own source tree).

Usage:
    python3 scripts/sync_locales.py           validate master, then rewrite the copies
    python3 scripts/sync_locales.py --check   validate master, fail if any copy differs (CI)

Validation (both modes): every master file must have exactly the same key
structure as en-US.json, and parameterised messages must use the same {token}
placeholders. This replaces the desktop's tsc key check for the extension,
which has no build step.
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "locales"
TARGETS = [
    ROOT / "desktop" / "frontend" / "src" / "locales",
    ROOT / "chrome-extension" / "src" / "locales",
]
REFERENCE = "en-US.json"


def flatten(obj, prefix=""):
    flat = {}
    for key, value in obj.items():
        path = prefix + key
        if isinstance(value, dict):
            flat.update(flatten(value, path + "."))
        else:
            flat[path] = value
    return flat


def placeholders(value):
    return set(re.findall(r"\{(\w+)\}", value)) if isinstance(value, str) else set()


def validate(files):
    errors = []
    ref = flatten(json.loads((MASTER / REFERENCE).read_text(encoding="utf-8")))
    for file in files:
        if file.name == REFERENCE:
            continue
        try:
            cur = flatten(json.loads(file.read_text(encoding="utf-8")))
        except json.JSONDecodeError as e:
            errors.append(f"{file.name}: invalid JSON: {e}")
            continue
        for key in sorted(ref.keys() - cur.keys()):
            errors.append(f"{file.name}: missing key '{key}'")
        for key in sorted(cur.keys() - ref.keys()):
            errors.append(f"{file.name}: extra key '{key}' (not in {REFERENCE})")
        for key in sorted(ref.keys() & cur.keys()):
            if placeholders(ref[key]) != placeholders(cur[key]):
                errors.append(
                    f"{file.name}: '{key}' placeholders {sorted(placeholders(cur[key]))} "
                    f"!= {REFERENCE} {sorted(placeholders(ref[key]))}"
                )
    return errors


def main():
    check = "--check" in sys.argv[1:]

    files = sorted(MASTER.glob("*.json"))
    if not (MASTER / REFERENCE).is_file():
        sys.exit(f"error: {MASTER / REFERENCE} not found")

    errors = validate(files)
    if errors:
        print("master validation failed:")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)

    diffs = []
    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for file in files:
            dest = target / file.name
            if not dest.is_file() or dest.read_bytes() != file.read_bytes():
                diffs.append(dest)
                if not check:
                    shutil.copyfile(file, dest)
        master_names = {f.name for f in files}
        for stale in sorted(target.glob("*.json")):
            if stale.name not in master_names:
                diffs.append(stale)
                if not check:
                    stale.unlink()

    rel = [str(p.relative_to(ROOT)) for p in diffs]
    if check:
        if diffs:
            print("locale copies are out of sync with locales/ — run: python3 scripts/sync_locales.py")
            for p in rel:
                print(f"  {p}")
            sys.exit(1)
        print(f"ok: {len(files)} locales in sync across {len(TARGETS)} targets")
    else:
        for p in rel:
            print(f"synced {p}")
        print(f"done: {len(files)} locales, {len(diffs)} file(s) updated")


if __name__ == "__main__":
    main()
