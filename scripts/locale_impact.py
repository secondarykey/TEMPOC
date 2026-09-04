#!/usr/bin/env python3
"""Decide which modules a push actually affects, ignoring unused locale keys.

The two modules share one set of translations: `locales/` is the master and
scripts/sync_locales.py copies every file into *both* modules (see that script
for why the copies must be committed). So adding a string that only one module
displays still rewrites the other module's copy, which used to trip that
module's `paths: <module>/**` filter and release it for a key it never reads.

This script answers the narrower question the paths filter cannot: did anything
in this diff reach code the module actually runs?

    changed file outside the module            -> not this module's problem
    changed file inside, but not a locale copy -> affected
    changed locale copy                        -> affected only if one of the
                                                  changed keys is referenced by
                                                  the module's own source

"Referenced" is decided by searching the module's source for the key name as a
whole word, which is deliberately over-inclusive: it cannot tell a real lookup
from a coincidence, so it errs towards releasing. It works because neither
module declares the other's keys -- desktop/frontend/src/i18n.ts's RawMessages
lists only what the desktop itself reads, and sync_locales.py is what keeps the
extension's keys from going missing.

Usage:
    python3 scripts/locale_impact.py                       # HEAD vs origin/main, both modules
    python3 scripts/locale_impact.py --base A --head B
    python3 scripts/locale_impact.py --module chrome-extension --github-output
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "locales"
REFERENCE = "en-US.json"

# dir:     everything the module owns, as a repo-relative posix prefix
# locales: its committed copy of the master, written by sync_locales.py
# source:  extensions worth searching for key references. Docs are excluded on
#          purpose -- CLAUDE.md naming a key is not the module using it.
MODULES = {
    "chrome-extension": {
        "dir": "chrome-extension/",
        "locales": "chrome-extension/src/locales/",
        "source": {".js", ".html", ".css", ".json"},
    },
    "desktop": {
        "dir": "desktop/",
        "locales": "desktop/frontend/src/locales/",
        "source": {".ts", ".tsx", ".js", ".mjs", ".go", ".html", ".css"},
    },
}

# Build output and vendored code, not module source.
IGNORED_DIRS = {"node_modules", "dist", "bin", ".git", "build"}


def git(*args, check=True):
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        capture_output=True, check=check,
    ).stdout.decode("utf-8", "replace")


def top_level_keys():
    """The master's own key names. Nested groups (durationUnits, ago) count as
    one key: callers reference the group, not its leaves."""
    return set(json.loads((MASTER / REFERENCE).read_text(encoding="utf-8")).keys())


def used_keys(module, keys):
    """Which of `keys` the module's own source mentions by name."""
    spec = MODULES[module]
    root = ROOT / spec["dir"]
    locales = ROOT / spec["locales"]
    found = set()
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in spec["source"]:
            continue
        if IGNORED_DIRS & set(path.relative_to(root).parts):
            continue
        if locales in path.parents:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for key in keys - found:
            if re.search(r"\b" + re.escape(key) + r"\b", text):
                found.add(key)
    return found


def flatten(obj, prefix=""):
    flat = {}
    for key, value in obj.items():
        path = prefix + key
        if isinstance(value, dict):
            flat.update(flatten(value, path + "."))
        else:
            flat[path] = value
    return flat


def read_json_at(ref, path):
    out = subprocess.run(
        ["git", "-C", str(ROOT), "show", ref + ":" + path],
        capture_output=True,
    )
    if out.returncode != 0:
        return None  # added or removed somewhere in this range
    try:
        return flatten(json.loads(out.stdout.decode("utf-8")))
    except json.JSONDecodeError:
        return None


def changed_keys(base, head, paths):
    """Top-level key names whose value changed in any of `paths`. None means
    'cannot tell' -- a file appeared or vanished, so treat it as everything."""
    keys = set()
    for path in paths:
        before, after = read_json_at(base, path), read_json_at(head, path)
        if before is None or after is None:
            return None
        for key in set(before) | set(after):
            if before.get(key) != after.get(key):
                keys.add(key.split(".")[0])
    return keys


def analyse(module, base, head):
    spec = MODULES[module]
    changed = [f for f in git("diff", "--name-only", base + ".." + head).splitlines() if f]
    mine = [f for f in changed if f.startswith(spec["dir"])]
    if not mine:
        return False, "nothing under this module changed"

    non_locale = [f for f in mine if not f.startswith(spec["locales"])]
    if non_locale:
        return True, str(len(non_locale)) + " non-locale file(s) changed, e.g. " + non_locale[0]

    touched = changed_keys(base, head, mine)
    if touched is None:
        return True, "a locale file was added or removed"

    used = used_keys(module, top_level_keys())
    relevant = touched & used
    if relevant:
        return True, "locale keys this module uses changed: " + ", ".join(sorted(relevant))
    return False, "only locale keys this module never reads changed: " + (", ".join(sorted(touched)) or "none")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--base", default="origin/main", help="ref the diff starts from (default: origin/main)")
    ap.add_argument("--head", default="HEAD", help="ref the diff ends at (default: HEAD)")
    ap.add_argument("--module", choices=sorted(MODULES), help="report on one module only")
    ap.add_argument("--github-output", action="store_true",
                    help="also write affected=true|false to $GITHUB_OUTPUT (needs --module)")
    args = ap.parse_args()

    if args.github_output and not args.module:
        sys.exit("error: --github-output needs --module")

    # An unknown or empty base (a brand-new branch pushes all zeros) leaves
    # nothing to compare against. Release rather than silently skip.
    resolvable = args.base and set(args.base) != {"0"} and git(
        "rev-parse", "--verify", "-q", args.base + "^{commit}", check=False
    ).strip()
    wanted = [args.module] if args.module else sorted(MODULES)
    if not resolvable:
        print("base '" + str(args.base) + "' is not a resolvable commit -- assuming affected")
        results = {m: (True, "no usable base to diff against") for m in wanted}
    else:
        results = {m: analyse(m, args.base, args.head) for m in wanted}

    for module, (affected, why) in results.items():
        print(module + ": " + ("affected" if affected else "not affected") + " -- " + why)

    if args.github_output:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as fh:
            fh.write("affected=" + ("true" if results[args.module][0] else "false") + "\n")


if __name__ == "__main__":
    main()
