#!/usr/bin/env python3
"""Validation script for Antigravity Skills and Rules.

Checks structure, YAML frontmatter, naming conventions, description guidelines,
and progressive disclosure rules for Antigravity customizations.

Usage:
    python validate_customization.py <path_to_skill_or_rule>
    python validate_customization.py --all
"""

import argparse
import os
import re
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Optional PyYAML with fallback
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


def parse_frontmatter(content: str) -> tuple[dict | None, str | None]:
    """Parse YAML frontmatter using PyYAML or basic parser fallback."""
    if not content.startswith("---"):
        return None, "No YAML frontmatter found"

    match = re.match(r"^---\r?\n(.*?)\r?\n---", content, re.DOTALL)
    if not match:
        return None, "Invalid frontmatter format (missing closing ---)"

    frontmatter_text = match.group(1)

    if HAS_YAML:
        try:
            data = yaml.safe_load(frontmatter_text)
            if not isinstance(data, dict):
                return None, "Frontmatter must be a YAML dictionary"
            return data, None
        except Exception as e:
            return None, f"Invalid YAML in frontmatter: {e}"

    # Basic fallback parser for simple key-value YAML
    data = {}
    lines = frontmatter_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        if ":" in line:
            key, val = line.split(":", 1)
            key = key.strip()
            val = val.strip()
            if val in (">", "|", ">-", "|-"):
                text_lines = []
                i += 1
                while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t")):
                    text_lines.append(lines[i].strip())
                    i += 1
                data[key] = " ".join(text_lines)
                continue
            else:
                data[key] = val.strip("\"'")
        i += 1
    return data, None


def validate_skill(skill_path: Path) -> tuple[bool, list[str], list[str]]:
    """Validate an Antigravity skill directory. Returns (valid, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    if not skill_path.exists():
        return False, [f"Path does not exist: {skill_path}"], warnings

    if not skill_path.is_dir():
        return False, [f"Skill path is not a directory: {skill_path}"], warnings

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, [f"SKILL.md missing in {skill_path}"], warnings

    try:
        content = skill_md.read_text(encoding="utf-8")
    except Exception as e:
        return False, [f"Failed to read SKILL.md: {e}"], warnings

    # Check line length for progressive disclosure (ideal < 500 lines)
    line_count = len(content.splitlines())
    if line_count > 500:
        warnings.append(
            f"SKILL.md is {line_count} lines (>500 lines). Consider moving detailed manuals into references/."
        )

    frontmatter, err = parse_frontmatter(content)
    if err:
        return False, [err], warnings

    # Check required fields
    if "name" not in frontmatter or not frontmatter["name"]:
        errors.append("Missing required 'name' field in frontmatter")
    if "description" not in frontmatter or not frontmatter["description"]:
        errors.append("Missing required 'description' field in frontmatter")

    name = str(frontmatter.get("name", "")).strip()
    if name:
        if not re.match(r"^[a-z0-9-]+$", name):
            errors.append(f"Name '{name}' must be kebab-case (lowercase letters, digits, and hyphens only)")
        if name.startswith("-") or name.endswith("-") or "--" in name:
            errors.append(f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens")
        if len(name) > 64:
            errors.append(f"Name '{name}' exceeds 64 characters ({len(name)})")

    description = str(frontmatter.get("description", "")).strip()
    if description:
        if "<" in description or ">" in description:
            errors.append("Description cannot contain unescaped angle brackets (< or >)")
        if len(description) > 1024:
            errors.append(f"Description exceeds 1024 characters ({len(description)})")
        # Check Antigravity trigger style recommendations
        desc_lower = description.lower()
        if not any(keyword in desc_lower for keyword in ("use this skill", "when", "helps", "provides", "creates", "manages")):
            warnings.append(
                "Description trigger phrasing recommendation: clearly specify 'when' to use the skill (e.g. 'Use this skill when...')"
            )
        if desc_lower.startswith("i can ") or desc_lower.startswith("i will "):
            warnings.append("Description should prefer third-person instructions over first-person ('I can...')")

    # Check allowed properties
    allowed_keys = {"name", "description", "license", "allowed-tools", "metadata", "compatibility"}
    unexpected_keys = set(frontmatter.keys()) - allowed_keys
    if unexpected_keys:
        warnings.append(f"Non-standard key(s) in frontmatter: {', '.join(sorted(unexpected_keys))}")

    return (len(errors) == 0), errors, warnings


def validate_rule(rule_path: Path) -> tuple[bool, list[str], list[str]]:
    """Validate an Antigravity rule file. Returns (valid, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    if not rule_path.exists():
        return False, [f"Rule file does not exist: {rule_path}"], warnings

    if not rule_path.is_file():
        return False, [f"Rule path is not a file: {rule_path}"], warnings

    if rule_path.suffix.lower() != ".md":
        errors.append(f"Rule file must have .md extension: {rule_path.name}")

    try:
        content = rule_path.read_text(encoding="utf-8")
    except Exception as e:
        return False, [f"Failed to read rule file: {e}"], warnings

    if not content.strip():
        errors.append(f"Rule file {rule_path.name} is empty")

    # If frontmatter exists, validate it
    if content.startswith("---"):
        frontmatter, err = parse_frontmatter(content)
        if err:
            errors.append(err)
        elif frontmatter:
            trigger = frontmatter.get("trigger")
            if trigger and trigger not in ("always_on", "model_decision"):
                warnings.append(f"Trigger '{trigger}' is non-standard. Expected 'always_on' or 'model_decision'.")

    return (len(errors) == 0), errors, warnings


def main():
    parser = argparse.ArgumentParser(description="Validate Antigravity skills and rules.")
    parser.add_argument("path", nargs="?", help="Path to a skill directory or rule .md file")
    parser.add_argument("--all", action="store_true", help="Validate all skills and rules in .agents/")
    args = parser.parse_args()

    cwd = Path.cwd()

    if args.all or not args.path:
        agents_dir = cwd / ".agents"
        if not agents_dir.is_dir():
            print(f"Error: No .agents directory found in {cwd}")
            sys.exit(1)

        skills_dir = agents_dir / "skills"
        rules_dir = agents_dir / "rules"

        all_valid = True

        print("=== Validating Skills ===")
        if skills_dir.is_dir():
            for child in sorted(skills_dir.iterdir()):
                if child.is_dir():
                    valid, errors, warnings = validate_skill(child)
                    status = "✅ PASS" if valid else "❌ FAIL"
                    print(f"{status}  Skill: {child.name}")
                    for err in errors:
                        print(f"     [ERROR] {err}")
                    for warn in warnings:
                        print(f"     [WARN]  {warn}")
                    if not valid:
                        all_valid = False
        else:
            print("  No skills/ directory found.")

        print("\n=== Validating Rules ===")
        if rules_dir.is_dir():
            rule_files = [f for f in rules_dir.glob("*.md") if f.is_file()]
            if not rule_files:
                print("  No rule files found in .agents/rules/.")
            for rf in sorted(rule_files):
                valid, errors, warnings = validate_rule(rf)
                status = "✅ PASS" if valid else "❌ FAIL"
                print(f"{status}  Rule: {rf.name}")
                for err in errors:
                    print(f"     [ERROR] {err}")
                for warn in warnings:
                    print(f"     [WARN]  {warn}")
                if not valid:
                    all_valid = False
        else:
            print("  No rules/ directory found.")

        sys.exit(0 if all_valid else 1)

    target = Path(args.path).resolve()
    if target.is_dir():
        valid, errors, warnings = validate_skill(target)
        target_type = "Skill"
    elif target.is_file():
        valid, errors, warnings = validate_rule(target)
        target_type = "Rule"
    else:
        print(f"❌ Target path does not exist: {target}")
        sys.exit(1)

    status = "✅ VALID" if valid else "❌ INVALID"
    print(f"{status} {target_type}: {target.name}")
    for err in errors:
        print(f"  [ERROR] {err}")
    for warn in warnings:
        print(f"  [WARN]  {warn}")

    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
