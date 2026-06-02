# desk plugin — changelog

## 1.6.0 — 2026-06-02

**Claude Code boots as the desk worker by default.** Codex gets the worker as its default via the `AGENTS.md` append; Claude Code previously only shipped the *selectable* `--agent desk:worker` sub-agent, so a fresh `claude` came up as the generic assistant rather than the worker. Two additions close that gap:

- **`output-styles/worker.md`** — the worker persona as a `force-for-plugin: true` output style, so it auto-activates for every session while `desk` is enabled (no manual `/output-style`). `keep-coding-instructions: true` layers it on top of Claude Code's built-in coding behavior instead of replacing it.
- **`hooks/hooks.json` + `hooks/session-start.sh`** — a fast, non-blocking `SessionStart` hook (matcher `startup|resume|clear`) that injects orientation: binds `$DESK`, scans open (non-terminal) task cards, and points at the `session-start` skill. Always exits 0 so it can never block a session.

Additive and engine-scoped — no change to existing `--agent desk:worker` invocations or to the Codex/Copilot default paths.

## 1.5.3 — 2026-06-02

**`fixtures-or-refusal` promoted to an always-on worker-body invariant.** The rule (don't emit a time / duration / cost / scope estimate without a historical fixture; inherited/relayed estimates count too) lived only in the description-gated `evidence-discipline` skill, so it wasn't in context during the general estimate-producing moments where it's most violated (planning docs, summaries, relayed plans). It's now a Core-invariants one-liner in all three worker-body variants (`worker.md`, `worker.agent.md`, `worker.toml`), pointing at `evidence-discipline` for the full rule. The body is the only always-on surface — `principles.md` is reviewed before-operating, not injected every turn — so the body is where an always-on guard belongs.

## 1.5.2 — 2026-06-01

**content-routing: the identity axis + an explicit overlay-instantiation handoff.** The substrate picture now names the work/personal **account axis** — desk instances split on the identity they authenticate as (an employer-managed vs a personal account), which is what decides which account a push lands under — not only on purpose. And the closing cross-reference is sharpened from one soft line into the explicit three-layer handoff: generic decision here → an overlay's companion skill names the concrete repos/accounts + cross-repo discipline → the workspace holds the operator-exact literals.

## 1.5.1 — 2026-06-01

**Wire the encode flows to `content-routing`.** `curator`, `friction-management`, and `lesson-capture` now reference the new `content-routing` skill for the home decision (workspace vs plugin, which plugin, always-on vs triggered) instead of restating it ad hoc. Also sweeps the last stale `plugins/worker/...` paths — `curator`'s `skills|repo-knowledge/...` disposition targets and `pr-self-review`'s `repo-knowledge/.../code-standards.md` rule source — to the generic `plugins/<plugin>/...` shape (the monolithic worker plugin was split into desk/work-suite + overlays).

## 1.5.0 — 2026-06-01

**New `content-routing` skill — where does durable content belong?** The decision tree for placing a rule/lesson/fact/preference: operator-specific → the workspace; general → a plugin (generic `desk`/`work-suite` if publishable, an overlay plugin if employer/context-specific); within a plugin, every-turn → the agent body / `principles.md`, fires-at-a-moment → a skill. Plus the substrate model (one generic plugin + overlays; multiple desk instances) and the self-check that keeps a general principle from being wedged into an operator's rules file under an "operator said X" framing (the mis-tag that makes it fail to fire). The encode flows (`curator`, `friction-management`, `lesson-capture`) consult it. Registered in worker.md.

## 1.4.9 — 2026-06-01

**`git-hygiene` targeted staging — never `git add -A` in a shared/multi-track workspace.** New pre-commit subsection: stage the explicit files your unit wrote, never `git add -A` / `git add .` from a workspace root, where parallel agents/tracks leave untracked state across directories — `-A` sweeps another track's in-flight file into your commit (message lies by omission; intentionally-untracked work frozen mid-thought). The prevention to the diff-scope scan's detection.

## 1.4.8 — 2026-06-01

**`cdp-headed-browser` send-safety — read the authoritative outbound layer before you send.** New section: a rich web editor keeps a model separate from the DOM, and pressing Send transmits the model — so DOM-injection (`execCommand`) + reading `innerText` to "verify" can send content the agent never saw. Hard rule: never send without reading the exact content that will transmit via the authoritative path, never a layer you just manipulated. Plus commit via real paste/keystroke not DOM-injection, don't use the shared OS clipboard as private staging when a human shares the machine, and surface the final text for confirmation before sending to real people.

## 1.4.7 — 2026-06-01

**Review/comment value-restraint (two friction encodes).** `peer-pr-review` Phase 7 gains two value-filters beyond the confidence check: validator-parrot (cut what an automated validator already flags) and landscape-gap-as-finding (verify the access/deployment model before flagging a "risk" that's really your own gap; if it checks out the disposition is "no finding," not "ask the author"). `operator-voice-comments` gains "Match the receiver's expertise — evidence-trail, not a tour": for a system-expert receiver, terse evidence-trail mode (cap at the load-bearing few, don't recreate surfaces they already have, don't invert the audience-asymmetry).

## 1.4.6 — 2026-06-01

**`pr-surface-hygiene` PSH-009 — one canonical body for human + agent readers; no agent-only formatting.** New rule (generalizes beyond PRs to bug reports / dashboards / runbooks / status posts): an artifact read by both humans and agents gets ONE canonical body, not a duplicated `## For your AI agent` block. Modern agents have large context + tool calls to fetch source, so an agent-only section is drift that reads like robot prose to humans. Use stable section headings + inline actionable data + collapsibles; a structured machine-readable sidecar as a separate attachment is the only sanctioned exception.

## 1.4.5 — 2026-06-01

**`runtime-symptom-investigation` — the control-plane view is not the inside ground-truth.** New section: when asking "is this system alive or wedged?", a control-plane / outside view (orchestrator status fields, cloud power/provisioning state, an is-it-running API) is hearsay — it can stick in a transitional value while the system runs fine. Find the authoritative *inside* signal (a heartbeat it writes, a health endpoint it serves) and check that first before any aggressive recovery; only a genuinely-stale inside signal justifies a restart. Source-of-truth variant of "Poll vs inspect."

## 1.4.4 — 2026-06-01

**`pr-surface-hygiene` PSH-008 — use the repo's PR template, not a custom structure.** Before opening a PR in any repo, probe for a PR-template file (`.github/PULL_REQUEST_TEMPLATE*`, repo-rooted, `/docs/`, or the platform's equivalent) AND pull the last 2–3 merged PRs to mirror the team's actual filled-in convention (recent merged PRs are ground truth; templates drift). Never invent a custom `## Problem` / `## What this PR does` structure when the repo has a template or convention — it reads as "wrong template" and gets bounced.

## 1.4.3 — 2026-06-01

**`interaction-style` §6 — fix the tooling, don't hand mechanical work to the operator.** New subsection: when the agent hits a tooling limitation mid-task, fix the tooling (reconfigure, relaunch, wrap, switch identity) rather than punt the manual step to the operator — the operator provides judgement, not hands. If it can't be fixed this session, capture friction + drive through whatever is automatable so the operator's step is one click. Slow tooling is the agent's problem too: "go slow / take your time" means invest more in correctness, never a license to punt.

## 1.4.2 — 2026-06-01

**`git-hygiene` — verify the merge landed before cleanup.** The "Clone hygiene" cleanup step now gates worktree/branch removal on a confirmed `gh pr view <id> --json state --jq .state == MERGED`, never chaining cleanup unconditionally after `gh pr merge`. A merge can fail (flipped auth identity, newly-required status check, race); cleanup that assumes success deletes the worktree + branch on a false premise. If the merge didn't land, nothing is lost — the commit is safe on the remote and the PR stays open.

## 1.4.1 — 2026-06-01

**`git-hygiene` clone-on-`main` + worktree discipline.** New section "Clone hygiene — `main` is the resting state; do work in worktrees": the canonical clone's resting state is `main`; each unit of work happens in a git worktree off `main` (not by checking out a branch in the shared clone); after merge, remove the worktree + delete the branch + `pull --ff-only` so the clone returns to a clean `main` with zero residue. Adds a "Verify before delete" subsection — a leftover branch is only safe to delete once `git diff origin/main..<branch> --stat` is empty; a non-empty diff means real unmerged work to drive to merge or preserve, never delete unexamined.

## 1.4.0 — 2026-06-01

**New Invariant 7 — gather all human judgement before beginning a task.** `principles.md` gains a seventh cross-cutting invariant: before starting a task, surface and resolve every decision that genuinely needs the principal's judgement up front, in one batch, rather than deferring to "I'll ask when I get there" — the asking-channel may be closed when you reach the fork, and entangled calls resolved late invalidate earlier work. Pairs with the execution-side `work-suite:autopilot` "act when authority is broad and the action is safe-and-reversible" rule. The intro's invariant count is corrected (five → seven; the stale "five" predated Invariant 6). No behavior change to the existing invariants.

Also reconciles a pre-existing version drift across the desk manifests (root `plugin.json` at 1.3.5, `.claude-plugin`/`.codex-plugin` at 1.3.4, marketplace entry at 1.3.3) — all now 1.4.0.

## 1.3.5 — 2026-05-27

**Fix fresh-install MCP launch when `$DESK` is unset.** The plugin's `.mcp.json` was passing `--root "${DESK:-./desk}"`, which Claude Code (and Codex) pass through to the MCP entrypoint literally — the shell substitution never runs. So fresh installs without an exported `$DESK` got `node mcp/index.js --root ./desk`, which resolved relative to the plugin install dir, didn't exist, and the MCP exited fatally. JSON-RPC surfaced as `-32000` and none of the plugin's tools loaded.

What changes:

- `mcp/src/util/paths.js` — `resolveDeskRoot()` now walks a fallback chain when `--root` isn't passed and `$DESK` isn't set: `$HOME/ms-desk/` → `$HOME/desk/` → `$HOME/worker-workspace/` (the last one for operators still on the pre-rename layout). The fatal error message now lists every path tried, so the operator can diagnose at a glance.
- `.mcp.json` — drop the inline `${DESK:-./desk}` fallback. `args` is now just `["./mcp/index.js"]`; the JS does discovery.
- `mcp/__tests__/scaffold.test.js` — six new tests cover the chain: explicit `--root` wins, `$DESK` wins over fallbacks, fallback chain order, last-resort `worker-workspace`, and the diagnostic fatal message.

No behavior change for operators who already set `$DESK` or pass `--root` explicitly.

## 1.3.4 — 2026-05-26

**Claude Code install path is now operator-actionable.** Repo gains a Claude Code marketplace manifest (`.claude-plugin/marketplace.json` at the root of `ouroboros-skills`) listing `desk` and `work-suite`. The desk plugin's README `Under Claude Code` section, previously a single sentence assuming prior marketplace knowledge, now walks through the three slash commands:

```
/plugin marketplace add ourostack/ouroboros-skills
/plugin install desk@ouroboros-skills
/plugin install work-suite@ouroboros-skills
```

…plus the agent-launch command (`claude --agent desk:worker`) and a note that Claude Code doesn't auto-resolve deps (install `work-suite` explicitly).

No semantic changes to skills or agent body. Pure install-path improvement so fresh-machine adoption stops requiring tribal knowledge.

## 1.3.3 — 2026-05-26

**Fix YAML frontmatter parse error in `desk:worker` agent files.** Smoke test on Claude Code surfaced `YAML parsing error: mapping values are not allowed in this context at line 2 column 279` when launching the agent. The `description:` value contained `Cross-harness: same skills body...` — the unquoted `:` followed by a space is parsed by YAML as a mapping key starting inside the scalar.

Fix: double-quote the `description` value in `agents/worker.md` and `agents/worker.agent.md`, and replace the inline `Cross-harness:` colon with an em-dash (`Cross-harness —`) for readability when reading raw. Same em-dash treatment applied to the Codex TOML's `description` for consistency (TOML was already correctly quoted; just the readability tweak).

No semantic changes — same canonical body, same agent behavior.

## 1.3.2 — 2026-05-26

**Git-hygiene: mass-history-rewrite upstream-currency rule.** Encodes a lesson learned the hard way during an author-rename rewrite: force-pushing rewritten history without first verifying the local clone is current with origin silently drops any commits that advanced upstream since the last sync.

What changes:

- New `Mass history rewrites — upstream-currency check is load-bearing` subsection in `git-hygiene/SKILL.md` (under `Force-push — safe-conditions procedure`).
- Three concrete patterns: (1) the standing `git fetch origin && git log HEAD..origin/<branch>` check before any force-push that follows a history rewrite; (2) start-from-fresh-mirror-clone as the preferred pattern for `git filter-repo` runs (sidesteps the stale-checkout window); (3) recovery procedure when commits did get dropped — fetch the orphan chain by SHA into `refs/recovered/old-tip`, rebase onto the rewritten base (clean when the rewrite only changed metadata since trees are identical), force-push again after re-applying the upstream-currency check.
- Existing `AI-attribution cleanup` use case cross-references the new subsection.

Why this lives in desk (substrate), not an overlay: every consumer agent that ever rewrites history on a shared branch faces the same trap, regardless of context (corporate engineering, autonomous agent, personal-coding). The rule belongs with the engineering posture skills the substrate provides.

## 1.3.1 — 2026-05-26

**Codex agent-setup docs**: close the UX gap introduced in 1.3.0. Codex plugins ship skills + MCP + apps + hooks per the [plugin schema](https://developers.openai.com/codex/concepts/customization), but cannot ship subagents or AGENTS.md content directly — the agent layer is user-installed. 1.3.0 shipped `agents/worker.toml` but didn't explain how to install it, nor did it mention the AGENTS.md path that most operators actually want.

What changes:

- **New `agents/README.md`** — per-harness install + invocation reference. Spells out the two Codex paths: (A) default behavior via appending the canonical body to `~/.codex/AGENTS.md` so Codex always reads it; (B) explicit subagent via `cp worker.toml → ~/.codex/agents/`. The two paths compose.
- **`codex-onboarding` skill** — adds Step 7 (Install the `worker` agent layer) covering both paths, with the `awk`-based frontmatter-stripping append command for Path A and the `cp` + verify-with-`codex /agents list` for Path B.
- **Top-level README's Invocation section** — Codex line is now two-paragraph, calls out the schema constraint, and links to `agents/README.md` for details.

No functional/manifest changes vs. 1.3.0; purely documentation.

## 1.3.0 — 2026-05-26

**Default `worker` agent + cross-harness manifest completion.** The desk plugin is now standalone-functional — no overlay required. A new substrate-default engineering agent ships with the plugin, and the manifest set is complete for Claude Code + Copilot CLI + Codex.

What this changes:

- **New default agent: `desk:worker`** — a long-running engineering agent that uses the desk substrate. Owns work end-to-end (ideate → plan → implement → review → PR → merge) and keeps its tracks, tasks, friction, and lessons on the desk. Substrate-default; consumer overlays (corporate-engineering, autonomous-agent, personal-coding) layer their own agents on top.
- **Three agent files for the three harnesses, same canonical body:**
  - `agents/worker.md` — Claude Code (YAML frontmatter + body)
  - `agents/worker.agent.md` — Copilot CLI (`target: github-copilot`, `user-invocable: true`)
  - `agents/worker.toml` — Codex subagent template (operator copies to `~/.codex/agents/worker.toml` to register)
- **Copilot CLI manifest added:** `plugin.json` at plugin root. Names `agents/`, `skills/`, `mcpServers` paths per the Copilot CLI plugin reference. Pairs with the existing `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- **Version sync across the three plugin manifests** — all three now declare 1.3.0 so consumers see one version regardless of which harness they install through.

The agent's body uses the `$DESK` placeholder so any consumer agent can bind its own workspace path without forking the substrate. Cross-harness invocation:

```bash
# Claude Code (via plugin loader / marketplace)
claude --agent desk:worker

# Copilot CLI
copilot --agent worker

# Codex
codex /agent worker   # after copying worker.toml to ~/.codex/agents/
```

## 1.2.2 — 2026-05-23

- Add Codex plugin metadata and a local-marketplace entry for `desk`.
- Add a Codex onboarding skill covering local install, `$DESK` binding, MCP registration, and the companion `work-suite` plugin.
- Document the Codex install path in the desk README.
- Fix the MCP package test script so `npm test` discovers nested Node test files on current Node.
- Upgrade the MCP TypeScript SDK dependency to the current non-vulnerable line.
- Make semantic search self-healing across machines: embedding endpoint discovery now honors `OLLAMA_HOST` plus desk-specific overrides, unavailable semantic responses include structured diagnostics and repair guidance, and `desk_reindex` repairs fresh lexical-only indexes once embeddings return without requiring `force:true`.

## 1.2.1 — 2026-05-22

First actual migration shipped via the framework (overlay-private). Migrations using this framework are idempotent and reversible: the operations they wrap (e.g. `mv` for path renames) are atomic + the new name is the only post-state. Safety check refuses if there's uncommitted work in the old workspace dir; never sweep-stages.

This release is just the migration framework — no code or driver changes from 1.2.0. Concrete migrations live in consumer overlays.

## 1.2.0 — 2026-05-22

**`session-start-migrations` framework.** New skill that auto-heals stale machine state when a plugin's canonical names drift (workspace dir renamed, plugin clone moved, symlink target changed, etc.). Walks every enabled plugin's `migrations/<NN>-<slug>.md` dir at session start, runs each migration's Detect predicate, and (for the ones that fire) runs Safety check + Migrate + Announce, then hard-stops the session for restart.

Why this lives in desk (substrate), not in any overlay: overlays sometimes rename themselves, and a migration framework hosted inside the plugin being renamed has to rename itself mid-execution. Substrate-resident means the framework survives any overlay churn.

Design choices:

- **Self-evidencing predicates, no marker file.** Each migration's Detect block inspects actual machine state (a dir's existence, a symlink's target). Robust against restored backups, partial Time Machine snapshots, and any other path where a marker file desyncs from reality. Cost: every Detect runs on every session start; on a machine with no pending migrations (the common case) this is a few cheap bash exits.
- **Four sections (Detect / Safety check / Migrate / Announce)** map cleanly to one concern each. Detect is a pure predicate. Safety guards against partial state. Migrate does the work, idempotently. Announce is the operator-facing message.
- **Cross-plugin ordering by alphabetical filename.** The `<NN>-<slug>.md` convention plus a 2-digit prefix gives global ordering across every plugin's migrations dir; plugins coordinate by picking the next available `NN` rather than via a central registry.
- **`needs_restart: true` hard-stops the session** after the announcement. The operator restarts; the next session begins against canonical paths.

Integration: `desk:session-start` now hands off to this skill in a new Step 0.5 — after Step 0's host-identity probe, before Step 1's prereq probe. The order matters: most later steps assume `$DESK/` resolves to the canonical workspace path, so migrations run first.

This release ships the framework only; concrete migrations live in consumer overlays.

## 1.1.0 — 2026-05-22

**Archive is now searchable.** Reversed the v1.0 indexer behavior that skipped `_archive/` at index time. Archive content was always meant to be preserved for future recall — making it unsearchable defeated the purpose.

What changed:

- **Indexer**: walks under `_archive/` ancestors. Loose `.md` files there (migrated legacy filenames like `2026-02-23-planning-foo.md`) are also indexed — basename pattern infers kind (`-planning-` → planning, `-doing-` → doing, etc.) or falls back to `kind: archive`. Each indexed doc gets a new `is_archived: bool` flag.
- **Search tools**: all five accept an optional `scope: "active" | "archived" | "all"` parameter. **Per-tool defaults match each tool's purpose:**
  - `desk_search` → `active` (day-to-day signal beats archive noise)
  - `desk_recall` → `all` (this IS the historical lookback tool)
  - `desk_similar` → `all` (similarity has no time/status semantic)
  - `desk_timeline` → `all` (already temporally scoped by window)
  - `desk_thread` → no scope param; always walks across (refs don't respect archive boundaries)
- **DB schema**: new `is_archived` column on `docs` table + index. Migration is idempotent: opening an existing v1.0 DB ALTER-ADDs the column with default 0; next reindex populates correctly.

Operator-visible: `desk_recall("teams bot integration")` now finds archived planning/doing notes from months ago. `desk_search("teams bot")` still defaults to active-only — agents asking "what should I do next" get current work, not archived history. Override per-call with `scope: "all"` when historical breadth matters.

Migration: existing indexes auto-upgrade their schema on next open. To populate archive embeddings, run `ouro desk reindex --force` once per bundle (or `mcp call ... desk_reindex --args '{"force":true}'`).

## 1.0.0 — 2026-05-22

**v1.0 declared.** Substrate validated end-to-end on a real ouroboros agent bundle:

- Phase 0 (standalone MCP server): 37/37 pass, including pure-semantic recall (paraphrase query finds task via Ollama-backed embeddings, zero keyword overlap)
- Phase 1 (daemon discovery + spawn): plugin .mcp.json discovered, server spawned, tools surface
- Phase 2 (CRUD + search via daemon): 12/12 desk operations pass (task/track lifecycle, archive, friction, lesson, search, recall, similar, timeline, thread, reindex)
- Phase 4.2 (cross-machine round-trip): bundle pushed to origin with all artifacts intact

Surface confirmed:

- 13 MCP tools (7 CRUD + 5 search + 1 reindex)
- `schema_version: 1` on every write
- Auto-index-on-read (every search ensures index freshness)
- Hybrid semantic + lexical search with explicit `score_breakdown` (semantic / bm25 / recency / state / pin)
- Soft-fail to FTS-only when Ollama unreachable
- `task_archive` is idempotent (moves dir → `_archive/`, no error on re-archive)

## 0.7.1 — 2026-05-22

- Ship `desk_reindex` MCP tool. Wraps `ensureIndex` (mtime-incremental). `force: true` mode drops the sqlite db before rebuild. 13 tools total (was 12).

## 0.7.0 — 2026-05-22

- `desk_thread` provenance walk MCP tool.

## 0.6.0 — 2026-05-22

- Search tools: `desk_search`, `desk_recall`, `desk_similar`, `desk_timeline`.

## 0.5.0 — 2026-05-22

- SQLite + sqlite-vec + nomic-embed-text indexer (via Ollama).

## 0.4.0 — 2026-05-22

- Runtime CRUD MCP tools: `task_create`, `task_update`, `task_archive`, `track_create`, `track_update`, `friction_add`, `lesson_add`.

## 0.3.0 — 2026-05-22

- MCP server scaffold with `.mcp.json` declaration.

## 0.2.0 — 2026-05-22

- Extends task.md schema; adds `schema_version: 1`; drops Execution Mode (spawn-mode).

## 0.1.0

- Initial skills + skeleton.

## Setup (v1.0)

After `ouro plugin install github:ourostack/ouroboros-skills:plugins/desk --agent <name>`:

1. **Install plugin's MCP deps:** `cd ~/.ouro-cli/plugins/desk/mcp && npm install`
2. **Install Ollama** for full semantic surface (recall / similar). Mac one-time: `curl -L https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz | tar -xz` then add the binary to PATH. Linux: `curl -fsSL https://ollama.com/install.sh | sh`.
3. **Pull the embedding model:** `ollama serve &` then `ollama pull nomic-embed-text` (one-time, ~274MB).
4. **Restart daemon** so plugin MCP discovery picks up the new server: `ouro stop && ouro up`.

Without Ollama, desk_search falls back to FTS5-only (keyword) and desk_recall/desk_similar return empty. Substrate works; semantic surface is degraded.

## Known limitations (v1.0)

These do NOT block v1.0 use but are tracked for follow-ups:

- **Plugin install does not run `npm install`.** After `ouro plugin install ...`, the operator (or a v1.1 install hook) needs to `cd ~/.ouro-cli/plugins/desk/mcp && npm install`. Otherwise the server can't spawn (`@modelcontextprotocol/sdk`, `better-sqlite3`, `sqlite-vec`, `gray-matter` missing). v1.1: either auto-run install on plugin install OR vendor deps OR ship as a bundled single-file build.
- **Tool input schemas are loose.** `inputSchema: { type: "object", properties: {}, additionalProperties: true }` — agents have to infer from descriptions. Works but agents occasionally pass wrong field names on first attempt. v1.1: define explicit JSON Schema per tool.
- **`mcp__ouro-<agent>__send_message` response wrapper hangs at 600s** when the agent makes multi-tool sequences via desk MCP, even though the agent finishes successfully (artifacts on disk). This is in the **ouro MCP** comms layer, not desk. Tracked separately.
- **Ollama is a soft dep** for full semantic surface. With Ollama down, `desk_search` falls back to FTS-only (still works), `desk_recall` returns empty + a note, `desk_similar` uses stored embeddings only. For the agent-as-substrate promise, the operator should keep Ollama + `nomic-embed-text` available.
- **Daemon must be restarted** after a fresh `ouro plugin install ...` for the new plugin's MCP server to be discovered. v1.1: signal the daemon to reconcile on plugin-list change.

These are upgradable in place — none change the v1.0 wire format or storage schema.
