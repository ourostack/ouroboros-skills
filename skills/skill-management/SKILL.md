---
name: skill-management
description: Browse, install, update, and contribute skills from the ouroboros-skills shared repository. This is the bootstrap skill that teaches agents how to manage their skill library.
---

This skill teaches agents how to discover, install, track, update, and contribute skills from the shared `ouroboros-skills` repository. It is the bootstrap skill -- once an agent has this skill installed, it can self-serve all other skills.

## Concepts

**Skills repo**: `github.com/ouroborosbot/ouroboros-skills` -- a public repo containing shared skill definitions as `SKILL.md` files.

**Manifest**: `manifest.json` at the repo root -- a machine-readable index of all available skills with names, paths, descriptions, and tags.

**Registry**: `_registry.json` -- a local file in the agent's skills directory that tracks which skills are installed, where they came from, and when they were last updated.

**Skills directory**: The local directory where the agent stores installed skills. Location depends on the runtime (see below).

### Runtime Directory Layouts

| Layout | Skills directory | Example installed skill path |
|---------|-----------------|------------------------------|
| Host-managed skills root | `<host-home>/skills/` | `<host-home>/skills/work-planner/SKILL.md` |
| Agent-managed skills root | `~/.agents/skills/` | `~/.agents/skills/work-planner/SKILL.md` |
| Ouroboros bundle | `~/AgentBundles/<agent>.ouro/skills/` | `~/AgentBundles/myagent.ouro/skills/work-planner/SKILL.md` |

Detect which runtime you are in:
1. Prefer the skills root exposed by the current host app.
2. If `~/.agents/skills/` exists, use it as an agent-managed skills root.
3. If the user specifies an Ouroboros bundle path, use that.
4. If multiple roots are active, manage each root separately.
5. If ambiguous, ask the user.

The `_registry.json` file always lives at the root of each skills directory.

---

## 1. Browse: Discover Available Skills

Query the manifest to see what skills are available.

### Steps

1. Fetch the manifest:
   ```
   https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/manifest.json
   ```
2. Parse the JSON. The schema is:
   ```json
   {
     "skills": [
       {
         "name": "skill-name",
         "path": "skills/skill-name/SKILL.md",
         "description": "One-line description of what the skill does.",
         "tags": ["tag1", "tag2"]
       }
     ]
   }
   ```
3. Present the list to the user or filter by tags/keywords as needed.
4. To read a skill's full content before installing, fetch:
   ```
   https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/skills/<skill-name>/SKILL.md
   ```

---

## 2. Install: Add a Skill Locally

Fetch a skill from the repo and install it into the local skills directory.

### Steps

1. Determine the skills directory for the current runtime (see table above).
2. Create the skill subdirectory if it does not exist:
   ```
   mkdir -p <skills-dir>/<skill-name>/
   ```
3. Fetch the SKILL.md content:
   ```
   https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/skills/<skill-name>/SKILL.md
   ```
4. Write the content to `<skills-dir>/<skill-name>/SKILL.md`.
5. Get the latest commit SHA for the skill file:
   ```bash
   # Use the GitHub API to get the latest commit touching this file
   curl -s "https://api.github.com/repos/ouroborosbot/ouroboros-skills/commits?path=skills/<skill-name>/SKILL.md&per_page=1" | jq -r '.[0].sha'
   ```
6. Update `_registry.json` (see Track Provenance below).

### Verification

After install, confirm:
- `<skills-dir>/<skill-name>/SKILL.md` exists and is non-empty.
- `_registry.json` has an entry for the skill.

---

## 3. Track Provenance: Maintain _registry.json

The `_registry.json` file lives at the skills directory root and tracks all installed skills.

### Bootstrap or Repair a Missing Registry

If `_registry.json` is missing but the skills directory already contains installed skills, do not treat that as "no skills installed" and do not silently skip freshness checks. Bootstrap the registry first.

Steps:

1. Determine every active skills directory for the runtime. Some host apps expose split roots, such as an agent-managed root plus an app-managed root; each root gets its own `_registry.json`.
2. Fetch the shared manifest:
   ```
   https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/manifest.json
   ```
3. For each local skill directory containing `SKILL.md`:
   - If the skill name appears in the manifest, fetch the upstream `SKILL.md` and latest commit SHA for that skill path.
   - If the local `SKILL.md` is byte-for-byte identical to upstream, add a normal shared-skill registry entry with `source`, `commit`, `installed`, and `selfAuthored: false`.
   - If the local `SKILL.md` differs from upstream, preserve the local file and add a local/self-authored registry entry with `source: "local"`, `commit: ""`, `installed`, and `selfAuthored: true`. Report that it is a local adaptation instead of overwriting it.
   - If the skill name is not in the manifest, add the same local/self-authored registry entry.
4. Write `_registry.json` as formatted JSON at the root of that skills directory.
5. Validate by parsing the written JSON and reporting:
   - shared skills now tracked against upstream
   - local/self-authored skills intentionally excluded from upstream freshness updates
   - any manifest skills missing locally that the user may want to install

Freshness checks must fail closed when `_registry.json` is missing. Print the exact skills directory and tell the agent to run this bootstrap/repair flow before comparing commits. A missing registry is repairable state, not a reason to proceed with ad-hoc freshness guesses.

### Schema

```json
{
  "<skill-name>": {
    "source": "https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/skills/<skill-name>/SKILL.md",
    "commit": "<sha of the commit that last touched this skill file>",
    "installed": "<ISO 8601 datetime of when the skill was installed or last updated>",
    "selfAuthored": false
  }
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | The raw GitHub URL the skill was fetched from. |
| `commit` | string | The SHA of the latest commit that touched the skill file at time of install/update. |
| `installed` | string | ISO 8601 timestamp (e.g., `2026-03-18T13:30:00Z`) of when the skill was installed or last updated. |
| `selfAuthored` | boolean | `true` if the skill was written locally by the agent/user (not fetched from the repo). `false` for skills installed from the shared repo. |

### Rules

- When installing a new skill, add an entry.
- When updating a skill, update `commit` and `installed`.
- When a user creates a local skill (not from the repo), set `selfAuthored: true` and `source` to `"local"`.
- Never delete entries -- even if a skill is uninstalled, keep the record for audit trail. Add an `"uninstalled": "<ISO date>"` field instead.
- If `_registry.json` does not exist, create it as an empty object `{}` before adding the first entry.

---

## 4. Update: Check for and Apply Skill Updates

Compare locally installed skills against the latest versions in the repo.

### Steps

1. Read `_registry.json` from the skills directory.
2. Fetch the manifest:
   ```
   https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/manifest.json
   ```
3. For each skill in `_registry.json` where `selfAuthored` is `false`:
   a. Get the latest commit SHA for the skill file from the GitHub API:
      ```bash
      curl -s "https://api.github.com/repos/ouroborosbot/ouroboros-skills/commits?path=skills/<skill-name>/SKILL.md&per_page=1" | jq -r '.[0].sha'
      ```
   b. Compare against the `commit` field in `_registry.json`.
   c. If they differ, the skill has been updated upstream.
4. Report which skills are stale.
5. For each stale skill, offer to update:
   - Fetch the new SKILL.md content.
   - Overwrite the local file.
   - Update `commit` and `installed` in `_registry.json`.

### Freshness Check (Quick)

For a fast staleness check without full update:
1. Read `_registry.json`.
2. For each non-self-authored skill, compare the local `commit` SHA against the latest from the API.
3. Report: "X skills up to date, Y skills have updates available."

---

## 5. Contribute: Add a New Skill to the Repo

Guide the agent through contributing a new skill to the shared repo.

### Steps

1. **Fork**: Fork `ouroborosbot/ouroboros-skills` to the contributor's GitHub account.
2. **Clone**: Clone the fork locally.
3. **Create branch**: Create a feature branch (e.g., `feat/add-<skill-name>`).
4. **Create skill directory**: `skills/<skill-name>/`
5. **Write SKILL.md**: The file must include:
   - YAML frontmatter with `name` and `description` fields.
   - Clear workflow instructions that another agent can follow.
   - No hardcoded paths or user-specific configuration.
6. **Update manifest.json**: Add an entry for the new skill:
   ```json
   {
     "name": "<skill-name>",
     "path": "skills/<skill-name>/SKILL.md",
     "description": "<description from frontmatter>",
     "tags": ["<relevant>", "<tags>"]
   }
   ```
7. **Commit and push**: Commit all changes and push to the fork.
8. **Open PR**: Open a pull request against `ouroborosbot/ouroboros-skills` main branch.
   - Title: `feat: add <skill-name> skill`
   - Body: Describe what the skill does and when agents should use it.

### SKILL.md Requirements

Every skill file must:
- Have YAML frontmatter with at least `name` and `description`.
- Be self-contained -- an agent should be able to follow the skill using only the SKILL.md content.
- Not reference external files that are not part of the skill directory.
- Use clear, imperative instructions (the audience is an AI agent, not a human developer).

---

## 6. Improve: Propose Changes to Existing Skills

Guide the agent through proposing improvements to skills already in the repo.

### Steps

1. **Fork** (if not already forked): Fork `ouroborosbot/ouroboros-skills`.
2. **Clone/update**: Clone or pull the latest from the fork.
3. **Create branch**: Create a feature branch (e.g., `improve/<skill-name>-<brief-description>`).
4. **Make changes**: Edit the skill's `SKILL.md` file.
   - Preserve the existing YAML frontmatter `name` field.
   - Update `description` if the scope of the skill changed.
   - Keep the skill self-contained.
5. **Update manifest.json** if the description or tags changed.
6. **Commit and push**: Commit with a clear message explaining what was improved and why.
7. **Open PR**: Open a pull request against `ouroborosbot/ouroboros-skills` main branch.
   - Title: `improve(<skill-name>): <brief description of change>`
   - Body: Explain what was changed, why, and how it improves the skill.

### When to Improve vs. Contribute

- **Improve**: The skill exists but could be better (clearer instructions, missing edge cases, better structure).
- **Contribute**: The skill does not exist yet and covers a new capability.
