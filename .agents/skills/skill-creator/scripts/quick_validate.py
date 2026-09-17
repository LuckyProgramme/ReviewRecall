import sys
from pathlib import Path

# Add script directory to sys.path for direct script invocation
script_dir = Path(__file__).resolve().parent
if str(script_dir) not in sys.path:
    sys.path.insert(0, str(script_dir))
if str(script_dir.parent) not in sys.path:
    sys.path.insert(0, str(script_dir.parent))

try:
    from validate_customization import validate_skill as vc_validate_skill
except ImportError:
    from scripts.validate_customization import validate_skill as vc_validate_skill

def validate_skill(skill_path):
    """Basic validation wrapper returning (bool, message)."""
    valid, errors, warnings = vc_validate_skill(Path(skill_path))
    if not valid:
        return False, "; ".join(errors)
    if warnings:
        return True, f"Skill is valid (warnings: {'; '.join(warnings)})"
    return True, "Skill is valid!"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)
    
    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)