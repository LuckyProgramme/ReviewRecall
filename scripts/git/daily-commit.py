#!/usr/bin/env python3
"""Stage files, commit them, and push them with one command."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


class GitCommandError(RuntimeError):
    """Raised when a Git command exits unsuccessfully."""


def run_git(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Run Git directly, without a shell."""
    result = subprocess.run(
        ["git", *args],
        text=True,
        capture_output=capture,
        check=False,
    )
    if result.returncode != 0:
        if capture:
            detail = result.stderr.strip() or result.stdout.strip()
        else:
            detail = f"git {' '.join(args)} failed"
        raise GitCommandError(detail)
    return result


def repository_root() -> Path:
    result = run_git("rev-parse", "--show-toplevel", capture=True)
    return Path(result.stdout.strip())


def parse_add_targets(add_command: str) -> list[str] | None:
    """Return None for add-all, otherwise return comma-separated paths."""
    value = add_command.strip()

    for prefix in ("git add ", "add "):
        if value.lower().startswith(prefix):
            value = value[len(prefix) :].strip()
            break

    if value.lower() in {"all", ".", "-a", "--all"}:
        return None

    paths = [path.strip().strip("\"'") for path in value.split(",") if path.strip()]
    if not paths:
        raise ValueError("The add command did not contain any files or folders.")
    return paths


def staged_files(targets: list[str] | None = None) -> list[str]:
    command = ["diff", "--cached", "--name-status"]
    if targets is not None:
        command.extend(["--", *targets])
    output = run_git(*command, capture=True).stdout
    return [line for line in output.splitlines() if line.strip()]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage files, create one commit, and push it.",
        epilog=(
            'Examples:\n'
            '  python gitpush.py all "Daily update" push\n'
            '  python gitpush.py "git add ." "Fix login bug"\n'
            '  python gitpush.py "README.md,client/src" "Update docs and UI" push'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "add_command",
        metavar="ADD",
        help='use "all"/"git add ." for everything, or comma-separated paths',
    )
    parser.add_argument("message", metavar="MESSAGE", help="commit message")
    parser.add_argument(
        "action",
        nargs="?",
        default="push",
        choices=("push",),
        help='final action (optional; defaults to "push")',
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        root = repository_root()
        os.chdir(root)
        targets = parse_add_targets(args.add_command)

        print(f"Repository: {root}")
        if targets is None:
            print("Staging all changes...")
            run_git("add", "--all")
        else:
            print(f"Staging: {', '.join(targets)}")
            run_git("add", "--", *targets)

        files = staged_files(targets)
        if not files:
            print("Nothing to commit: no files were staged.", file=sys.stderr)
            return 1

        print("\nFiles to commit:")
        print("\n".join(files))

        print(f'\nCommitting as: "{args.message}"')
        commit_command = ["commit", "-m", args.message]
        if targets is not None:
            commit_command.extend(["--", *targets])
        run_git(*commit_command)

        print("\nPushing commit...")
        run_git(args.action)
        print("Done. The commit was pushed successfully.")
        return 0
    except (FileNotFoundError, GitCommandError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
