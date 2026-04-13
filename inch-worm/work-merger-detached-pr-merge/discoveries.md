# Work-Merger Detached Merge Inch-Worm Discoveries

## [D-001] — Make PR-number merge robust from detached/shared worktrees

**Source**: observed-during-seed
**What**: `gh pr merge 448 --merge --delete-branch` merged the PR remotely but returned nonzero locally because the command ran from a detached checkout and then attempted local checkout cleanup where `main` was already owned by another worktree.
**Where**: `skills/work-merger/SKILL.md`, PR workflow merge and post-merge cleanup instructions
**Why it matters**: A successful remote merge should not look like a failed merge to the agent, and local cleanup should be resilient on machines with multiple active worktrees.
**Evidence**: During kept-notes PR #448 merge, the first merge command failed with `could not determine current branch`; after rerunning from a branch worktree, GitHub reported the PR was already merged while local git failed with `fatal: 'main' is already used by worktree`.
**Severity**: high-value
**Blast radius**: self-contained
**Fix shape**: Teach work-merger to merge by explicit PR/branch from any checkout, verify remote merged state after nonzero `gh pr merge`, and clean up local branch/worktree without requiring checkout to `main`.
**Verification**: Re-read `skills/work-merger/SKILL.md` and confirm it includes explicit detached checkout guidance, post-merge verification, and multi-worktree-safe cleanup.
**Status**: fixed
**Linked work**: https://github.com/ouroborosbot/ouroboros-skills/pull/18
**Notes**: Seed approved by the user after PR #448 landed.

---

## [D-002] — Register existing seo-titles skill in manifest

**Source**: observed-during-seed
**What**: `skills/seo-titles/SKILL.md` exists in the repo but `manifest.json` does not list the skill.
**Where**: `manifest.json`, `skills/seo-titles/SKILL.md`
**Why it matters**: A skill that is present but absent from the manifest may not be discoverable or installable through the normal shared-skill workflow.
**Evidence**: `rg --files` lists `skills/seo-titles/SKILL.md`; the manifest output did not include a `seo-titles` entry.
**Severity**: high-value
**Blast radius**: self-contained
**Fix shape**: Add the missing manifest entry with the skill path, description, and tags.
**Verification**: Compare `rg --files 'skills/.*/SKILL.md'` against manifest skill paths.
**Status**: fixed
**Linked work**: https://github.com/ouroborosbot/ouroboros-skills/pull/19

---

## [D-003] — Replace stale Memory wording in seo-titles examples

**Source**: observed-during-seed
**What**: The `seo-titles` skill includes an example title, `Docs — Psyche, Memory, Architecture`, that still teaches the old Memory framing.
**Where**: `skills/seo-titles/SKILL.md`
**Why it matters**: Shared skills should not reintroduce vocabulary the harness has moved away from, especially in examples agents may copy into user-facing work.
**Evidence**: `skills/seo-titles/SKILL.md` anti-pattern/rule examples include the string `Memory`.
**Severity**: nice-to-have
**Blast radius**: self-contained
**Fix shape**: Replace the example with diary/journal/notes language while preserving the SEO lesson.
**Verification**: Search `skills/seo-titles/SKILL.md` for `Memory` after the edit.
**Status**: open
**Linked work**:

---
