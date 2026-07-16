"""
Compute the next Chrome extension release version, then update
`chrome-extension/version` and `chrome-extension/src/manifest.json`.

Logic:
  - Read the current version from the `version` file.
  - If a release tag for that version already exists, bump the patch component.
  - Otherwise, use the version string as-is.

Outputs `version=<new_version>` to GITHUB_OUTPUT (or stdout when run locally).
"""

import os
import re
import subprocess
from pathlib import Path

# chrome-extension/ — paths are resolved from this file, not the caller's cwd.
ROOT = Path(__file__).resolve().parents[1]

TAG_PREFIX = "extension-v"
# Releases before the repo split into modules were tagged "v<version>".
LEGACY_TAG_PREFIX = "v"


def get_tags() -> set[str]:
    result = subprocess.run(["git", "tag"], capture_output=True, text=True)
    raw = result.stdout.strip()
    return set(raw.split("\n")) if raw else set()


def bump_patch(version: str) -> str:
    parts = version.split(".")
    parts[2] = str(int(parts[2]) + 1)
    return ".".join(parts)


def is_released(version: str, tags: set[str]) -> bool:
    return (
        f"{TAG_PREFIX}{version}" in tags
        or f"{LEGACY_TAG_PREFIX}{version}" in tags
        or version in tags
    )


def main() -> None:
    version_path = ROOT / "version"
    current = version_path.read_text().strip()

    tags = get_tags()
    new_version = bump_patch(current) if is_released(current, tags) else current

    # Update version file
    version_path.write_text(new_version + "\n")

    # Update src/manifest.json (preserve formatting via regex)
    manifest_path = ROOT / "src" / "manifest.json"
    content = manifest_path.read_text()
    content = re.sub(
        r'("version"\s*:\s*)"[^"]*"',
        rf'\g<1>"{new_version}"',
        content,
    )
    manifest_path.write_text(content)

    # Output for GitHub Actions or local use
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"version={new_version}\n")
    else:
        print(f"version={new_version}")


if __name__ == "__main__":
    main()
