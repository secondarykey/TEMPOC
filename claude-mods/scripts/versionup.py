"""
Compute the next Claude Code mods release version, then update
`claude-mods/version` and every plugin's `.claude-plugin/plugin.json`.

Logic:
  - Read the current version from the `version` file.
  - If a release tag for that version already exists, bump the patch component.
  - Otherwise, use the version string as-is.

`version` is the source of truth; each plugin.json carries a copy because Claude
Code reads the plugin's version from there, and users receive a change only when
that value changes. Every plugin of the module takes the same version.

Outputs `version=<new_version>` to GITHUB_OUTPUT (or stdout when run locally).
"""

import os
import re
import subprocess
from pathlib import Path

# claude-mods/ — paths are resolved from this file, not the caller's cwd.
ROOT = Path(__file__).resolve().parents[1]

TAG_PREFIX = "mods-v"
# One per plugin directory (usage-bar, hello, ...).
PLUGIN_MANIFESTS = sorted(ROOT.glob("*/.claude-plugin/plugin.json"))


def get_tags() -> set[str]:
    result = subprocess.run(["git", "tag"], capture_output=True, text=True)
    raw = result.stdout.strip()
    return set(raw.split("\n")) if raw else set()


def bump_patch(version: str) -> str:
    parts = version.split(".")
    parts[2] = str(int(parts[2]) + 1)
    return ".".join(parts)


def main() -> None:
    version_path = ROOT / "version"
    current = version_path.read_text().strip()

    tags = get_tags()
    new_version = bump_patch(current) if f"{TAG_PREFIX}{current}" in tags else current

    # Update version file. newline="" writes "\n" as is, so a run on Windows
    # does not turn the files' line endings into CRLF.
    version_path.write_text(new_version + "\n", newline="")

    # Update each plugin.json (preserve formatting via regex)
    for manifest in PLUGIN_MANIFESTS:
        with open(manifest, encoding="utf-8", newline="") as f:
            content = f.read()
        content = re.sub(
            r'("version"\s*:\s*)"[^"]*"',
            rf'\g<1>"{new_version}"',
            content,
            count=1,
        )
        manifest.write_text(content, encoding="utf-8", newline="")

    # Output for GitHub Actions or local use
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"version={new_version}\n")
    else:
        print(f"version={new_version}")


if __name__ == "__main__":
    main()
