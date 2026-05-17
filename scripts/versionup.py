"""
Compute the next release version, then update `version` and `src/manifest.json`.

Logic:
  - Read the current version from the `version` file.
  - If the git tag v<version> already exists, bump the patch component.
  - Otherwise, use the version string as-is.

Outputs `version=<new_version>` to GITHUB_OUTPUT (or stdout when run locally).
"""

import json
import os
import re
import subprocess
import sys


def get_tags() -> set[str]:
    result = subprocess.run(["git", "tag"], capture_output=True, text=True)
    raw = result.stdout.strip()
    return set(raw.split("\n")) if raw else set()


def bump_patch(version: str) -> str:
    parts = version.split(".")
    parts[2] = str(int(parts[2]) + 1)
    return ".".join(parts)


def main() -> None:
    with open("version") as f:
        current = f.read().strip()

    tags = get_tags()
    if f"v{current}" in tags or current in tags:
        new_version = bump_patch(current)
    else:
        new_version = current

    # Update version file
    with open("version", "w") as f:
        f.write(new_version + "\n")

    # Update src/manifest.json (preserve formatting via regex)
    manifest_path = os.path.join("src", "manifest.json")
    with open(manifest_path) as f:
        content = f.read()
    content = re.sub(
        r'("version"\s*:\s*)"[^"]*"',
        rf'\g<1>"{new_version}"',
        content,
    )
    with open(manifest_path, "w") as f:
        f.write(content)

    # Output for GitHub Actions or local use
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"version={new_version}\n")
    else:
        print(f"version={new_version}")


if __name__ == "__main__":
    main()
