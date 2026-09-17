---
name: skill-creator
description: Create new skills and rules for Antigravity, modify and improve existing customizations, and evaluate their quality. Use this skill when users want to create, edit, or optimize a skill (multi-step workflow or runbook in .agents/skills/) or a rule (coding standard or guardrail in .agents/rules/), draft test cases, or inspect triggering accuracy.
---

# Antigravity Skill & Rule Creator

A skill for authoring, evaluating, and iteratively improving custom Antigravity capabilities.

---

## 1. Overview & Architecture

Antigravity uses a modular customization system discovered automatically in your workspace (`.agents/`).

### Customization Types

Choose the appropriate customization type based on the user's requirement:

| Type | Target Path | Behavior | Best For |
| :--- | :--- | :--- | :--- |
| **Skill** | `.agents/skills/<skill-name>/SKILL.md` | On-demand (progressive disclosure) | Multi-step procedures, runbooks, tool workflows, and executable scripts. |
| **Rule** | `.agents/rules/<rule-name>.md` or `GEMINI.md` | Continuous / scoped | Coding style conventions, API guardrails, architecture constraints, and testing standards. |

### The Authoring Loop

1. **Capture Intent**: Identify the goal, inputs, outputs, and whether a Skill or Rule is needed.
2. **Draft Content**: Write the `SKILL.md` or rule `.md` with clear instructions, examples, and scripts.
3. **Validate Structure**: Run `validate_customization.py` to check YAML frontmatter, naming, and constraints.
4. **Test & Evaluate**: Run test prompt scenarios in-session, check assertions, and compare outputs.
5. **Review with User**: Present results in Antigravity Artifacts or the local HTML review viewer.
6. **Iterate & Refine**: Update instructions based on user feedback until results are reliable.

---

## 2. Capturing Intent & Choosing Type

Start by understanding what the user wants to accomplish:

1. **Workflow vs. Policy**:
   - If the task is an **actionable procedure** (e.g. "how to deploy to staging", "how to generate migration scripts", "scrape data"): Create a **Skill**.
   - If the task is a **persistent constraint or standard** (e.g. "always use TypeScript strict mode", "never commit secrets", "follow PEP 8"): Create a **Rule**.
2. **Trigger Context**:
   - What prompts or situations should trigger this skill?
   - What are near-miss queries that should *not* trigger it?
3. **Tools & Dependencies**:
   - What CLI tools, packages, or MCP servers does the procedure depend on?
4. **Expected Outputs**:
   - What files, formats, or artifacts should be produced?

---

## 3. Authoring Skills

### Skill Directory Structure

Skills reside under `.agents/skills/<skill-name>/`:

```text
.agents/skills/<skill-name>/
├── SKILL.md          # Required: Instructions with YAML frontmatter
├── scripts/          # Optional: Executable Python/shell scripts for deterministic steps
├── references/       # Optional: Deep documentation, reference manuals, or API docs
├── assets/           # Optional: Templates, static assets, or boilerplate
└── examples/         # Optional: Sample code or golden input/output pairs
```

### Anatomy of `SKILL.md`

`SKILL.md` must start with YAML frontmatter:

```markdown
---
name: my-workflow-skill
description: >-
  Automate database migrations and verify schema parity. Use this skill when
  the user mentions running migrations, updating database schemas, or generating
  Prisma/Alembic changes.
---

# My Workflow Skill

Concise, step-by-step runbook for the agent to follow.

## When to Use
- Trigger scenarios and key context indicators.

## Workflow Steps
1. Inspect current state: `python scripts/check_status.py`
2. Generate migration: ...
3. Verify changes: ...
```

### Progressive Disclosure Rules

Antigravity injects only the `name` and `description` into the prompt initially. The full `SKILL.md` is loaded only when the skill is activated.

- **Keep `SKILL.md` concise** (< 500 lines).
- **Use `references/` for bulky material**: If an API reference or schema documentation exceeds 100 lines, place it in `references/manual.md` and instruct the model to view it only when needed.
- **Use `scripts/` for repetitive execution**: If a task involves parsing, regex transforms, or deterministic file operations, provide a Python script in `scripts/` rather than asking the LLM to perform complex text crunching inline.

### Description Writing Best Practices

The `description` field is the primary activation trigger:
- **Use third-person phrasing**: e.g., `"Use this skill when the user asks to...", "Diagnoses...", "Generates..."`. Avoid `"I can..."` or `"You should..."`.
- **State BOTH what and when**: Clearly explain what the skill does AND the specific trigger queries/keywords.
- **Set boundaries**: Include distinctions if the skill could be confused with a related task.
- **Character limit**: Keep under 1024 characters.

---

## 4. Authoring Rules

### Rule File Format

Rules reside in `.agents/rules/<rule-name>.md` or at the workspace root (`GEMINI.md`, `AGENTS.md`).

```markdown
---
description: Enforce TypeScript strict null checks and avoid type assertions
trigger: model_decision
---

# TypeScript Quality Standards

Guidelines that apply when writing or refactoring TypeScript code in this repository.

## Standards
- Never use `any` unless interacting with untyped legacy libraries.
- Prefer explicit type guards over `as` type assertions.
- Ensure all async functions handle rejected promises or bubble typed errors.
```

- **Frontmatter**:
  - `trigger: always_on` (unconditionally loaded) or `trigger: model_decision` (loaded when contextually relevant).
  - `description`: Explains what guidelines this rule provides.
- **Keep rules clear and actionable**: Use bullet points, clear code examples, and explicit good vs. bad examples.

---

## 5. Structural Validation

Always validate new or modified customizations using the built-in validator:

```powershell
# Validate all skills and rules in .agents/
python .agents/skills/skill-creator/scripts/validate_customization.py --all

# Validate a specific skill directory
python .agents/skills/skill-creator/scripts/validate_customization.py .agents/skills/<skill-name>

# Validate a specific rule file
python .agents/skills/skill-creator/scripts/validate_customization.py .agents/rules/<rule-name>.md
```

The script checks:
- Correct YAML frontmatter delimiters and parsing
- Required fields (`name`, `description`)
- Kebab-case naming (lowercase, numbers, hyphens, <= 64 chars)
- Description formatting (no unescaped `<`, `>`, length <= 1024 chars, third-person trigger style)
- Progressive disclosure guidelines (< 500 lines recommendation)

---

## 6. Testing & Evaluation

To verify that a skill or rule works reliably before concluding:

### Step 1: Draft Test Cases

Create 2–3 realistic user prompts representing typical user requests:
- **Eval 1**: Typical standard request.
- **Eval 2**: Edge case or complex request with extra parameters.
- **Eval 3**: Near-miss request (should test proper boundary behavior).

Draft verifiable expectations/assertions:
- Output file created with expected filename and format.
- Specific keys, tables, or sections present in the output.
- No placeholder text or unexecuted TODOs remaining.

### Step 2: In-Session Test Execution

1. Create an evaluation workspace: `<skill-name>-workspace/eval-<id>/`.
2. Follow the newly created skill instructions against the test prompt.
3. Save generated files to `<skill-name>-workspace/eval-<id>/outputs/`.
4. Check outputs against the drafted expectations.

### Step 3: Presenting Results to the User

Present evaluation outcomes using Antigravity Artifacts:
- Create or update a test report markdown table showing:
  - **Prompt**
  - **Expected Output**
  - **Actual Output / Verification Verdict** (PASS / FAIL)
  - **Key Notes / Evidence**

If a visual side-by-side browser review is helpful, launch the included zero-dependency eval viewer:

```powershell
python .agents/skills/skill-creator/eval-viewer/generate_review.py <skill-name>-workspace --skill-name "<skill-name>"
```

Or write a static HTML file:
```powershell
python .agents/skills/skill-creator/eval-viewer/generate_review.py <skill-name>-workspace --static <skill-name>-workspace/review.html
```

---

## 7. Iterative Refinement

1. **Listen to User Feedback**: Review any failing test cases or user comments.
2. **Explain the Reasoning ("Why")**:
   - Today's LLMs understand reasoning. Explain *why* a particular step or convention is necessary rather than relying solely on aggressive capitalization (`MUST`, `ALWAYS`).
3. **Factor Out Common Logic**:
   - If multiple test runs require the same data parsing, chart generation, or template filling, write a reusable Python helper in `scripts/` and instruct the skill to call it.
4. **Refine Trigger Sensitivity**:
   - If the skill triggers when it shouldn't, narrow the description keywords.
   - If the skill fails to trigger on legitimate requests, add common user phrasing variations to the description.
5. **Re-validate**: Run `python .agents/skills/skill-creator/scripts/validate_customization.py` after edits.
