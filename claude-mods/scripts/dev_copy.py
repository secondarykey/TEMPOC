"""Copy a mod into a folder Claude Code loads it from, under another name.

A copy loaded under the plugin's own name (hot reload, `--plugin-dir`) takes
the installed plugin's place in that session. Under another name the two load
side by side, each with its own state, store, settings pane and command, so the
installed version stays in view (for instance to watch an update arrive) while
the copy is being worked on.

    python3 claude-mods/scripts/dev_copy.py <folder> [--plugin usage-bar] [--name usage-bar-dev]

writes `<folder>/<name>/`, replacing what was there. `<folder>` is the session's
hot-reload folder (`~/.claude/dev-mods/<session id>`) or any folder to pass to
`claude --plugin-dir <folder>/<name>`. Run it again after each edit.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Every place the plugin's name is an identifier rather than prose: the
# manifest, the state contract, the module's atoms, its command and its pane.
RENAMES = {
    ".claude-plugin/plugin.json": [r'("name":\s*")(?P<n>{plugin})(")'],
    "types/index.d.ts": [r"(\s')(?P<n>{plugin})(': \{{)"],
    "hooks/register.tsx": [
        r"(plugin: ')(?P<n>{plugin})(')",
        r"(name: ')(?P<n>{plugin})(', description)",
        r"(\{{ command: ')(?P<n>{plugin})(' \}})",
        r"(const SETTINGS_PANE = ')(?P<n>[^']+)(')",
    ],
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--plugin", default="usage-bar")
    parser.add_argument("--name")
    args = parser.parse_args()
    name = args.name or f"{args.plugin}-dev"

    source = ROOT / args.plugin
    if not (source / ".claude-plugin" / "plugin.json").is_file():
        print(f"not a plugin: {source}", file=sys.stderr)
        return 1
    target = args.folder.expanduser() / name
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)

    for rel, patterns in RENAMES.items():
        path = target / rel
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            regex = re.compile(pattern.format(plugin=re.escape(args.plugin)))
            text, count = regex.subn(
                lambda m: m.group(1) + (name if m.group("n") == args.plugin else f"{m.group('n')}-{name}") + m.group(3),
                text,
            )
            if count == 0:
                print(f"{rel}: nothing matched {regex.pattern}", file=sys.stderr)
                return 1
        path.write_text(text, encoding="utf-8", newline="\n")

    print(f"{target}  ({args.plugin} as {name}, command /{name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
