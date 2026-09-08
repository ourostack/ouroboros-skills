# Agentic Engineering V2: rebasing the inner loop

This branch is an opt-in, interactive RFC for people who already use Desk and want to try a smaller engineering workflow with current frontier models. Use it on real work, tell the agent what helped or got in the way, and choose what feedback to share. It does not replace the main-branch default.

**Candidate status:** The preview is being qualified. The first method candidate failed two requirements; a revised candidate is under evaluation. Do not read source-contract checks, installation checks, or a single successful task as a reliability claim.

## The proposal

Keep the durable workspace. Simplify how work happens inside it. Stronger models should not need a second task system, a stack of overlapping methodologies, or ceremony that substitutes for a working result.

| Part | Responsibility |
|---|---|
| The native host and frontier model | Reason, use tools, and execute the agreed work |
| Desk and Crew | Keep task state, continuity, shared knowledge, attribution, and read-across/write-own boundaries |
| Work Suite | Align new work, recognize explicit go, scale planning to risk, establish semantic completion, and finish at the agreed boundary |
| Pinned Ponytail | Prefer existing capabilities and the smallest complete implementation, without shrinking scope or proof |
| Private preview feedback | Let the participant capture, inspect, correct, and delete their own comments |

Superpowers and RoboRev were exercised rather than adopted by default. The small comparisons produced mixed results and correlated misses; they did not justify another overlapping lifecycle or an always-on review daemon. RoboRev remains an optional review candidate. Quorum is a reference, not bundled code. None of these dispositions claims a universal winner.

### What changes in a task

New work starts with substantive alignment: intent, proposed design, material tradeoffs, definition of done, and an explicit go-ahead. Read source and reproduce an existing baseline while discussing it. Do not implement a replacement algorithm, prototype, or new implementation test before go, even in scratch and even if it will be deleted.

After go, retain control through the agreed result. Resume an already-approved task without repeating its questionnaire. A local implementation, a PR, a preview branch, and a production rollout are different finish lines; broad autonomy does not expand repository authority or silently promote one finish line into another.

Keep test-first changes, failure-path checks, the repository's own coverage rules, and risk-scaled independent review. Add primary evidence that the requested result works, including an executed attempt to falsify a consequential claim with a materially different probe. Passing the examples that drove the implementation is not enough. Review invocation alone is not review evidence.

Keep the human-facing evidence in the existing task: what was agreed, what changed, the actual source and workflow version, the outcome, review findings and closure, known limits, and rollout or rollback when relevant. Do not add another progress database or a numeric self-grade.

The maintained instructions are [Work Ideator](skills/work-ideator/SKILL.md), [Work Doer](skills/work-doer/SKILL.md), and [Work Merger](skills/work-merger/SKILL.md).

## Opt in without mixing versions

The preview closure is Desk `3.2.0-alpha.1`, Work Suite `4.0.0-alpha.1`, Desk MCP `1.4.0-alpha.1`, Plain Language `0.2.0`, and Ponytail `4.9.0`. A prerelease source revision before publication is not a second released version. After publication, changes to the shipped behavior need a new preview version.

Choose one active workflow version for your work. Retaining an inactive checkout for rollback is fine; enabling V1 and V2 methods together is not. Keep your existing Desk location, Crew person binding, selected overlay, and repository permissions.

**The commands below are the standalone native Copilot CLI route.** They were exercised with CLI `1.0.84-1` on an ARM Mac. If a managed host or overlay already owns your plugin installation, use that host's supported source-selection mechanism instead. Do not layer these native registrations over a managed installation, replace its worker with the standalone worker, or assume that this guide qualifies an untested host route.

The supplied offline runtime packs target ARM macOS with Node 22 and x64 Windows with Node 24. Use the matching Node version on the CLI's `PATH`; native Windows qualification is still pending. A different Node/architecture combination is not qualified by those packs.

Before changing the marketplace, record `copilot plugin marketplace list`, `copilot plugin list`, your current source revision, and any existing workspace/person binding. The replacement command removes every plugin installed from this marketplace. If your enabled set includes Crew or another companion, preserve that set and re-enable it too; the four commands below show the standalone closure, not permission to drop an overlay.

```bash
git clone --branch preview/agentic-engineering-v2 --single-branch https://github.com/ourostack/ouroboros-skills.git "$HOME/agentic-engineering-v2"
git -C "$HOME/agentic-engineering-v2" rev-parse HEAD

# Only when ouroboros-skills is already registered:
copilot plugin marketplace remove ouroboros-skills --force

copilot plugin marketplace add "$HOME/agentic-engineering-v2"
copilot plugin install desk@ouroboros-skills
copilot plugin install work-suite@ouroboros-skills
copilot plugin install plain-language@ouroboros-skills
copilot plugin install ponytail-upstream@ouroboros-skills
copilot plugin list
```

A local marketplace loads its checkout live. Do not update that checkout during an in-flight task. After selecting or updating a version, start a fresh CLI session so instructions and MCP code move together. A standalone installation launches with `copilot --agent desk:worker`; an existing overlay keeps its existing launch and binding.

Before starting work, inspect the actual skill sources from that project's working directory:

```bash
copilot skill list --json
```

Require the enabled Work Suite skills to resolve under the selected preview's `plugins/work-suite/skills/`, and its Desk workflow and `preview-feedback` skills under `plugins/desk/skills/`. Include `autopilot`, `work-ideator`, `work-planner`, `work-doer`, and `work-merger` in that check. Repository, ancestor-directory, or personal copies can shadow plugin skills while the plugin list still reports the preview versions. Stop when a different source owns those names; select one coherent installation through the owning host rather than deleting or bypassing repository-owned guidance. Repeat this preflight when the working directory or installed source changes.

The [Work Suite runtime audit](scripts/audit-work-suite-runtime.cjs) can compare an explicitly selected installed root with canonical bytes and check menu-name presence. Menu names alone do not prove which source won precedence, so they do not replace the path check above. Native live-marketplace roots do not contain the installer's `_registry.json`; inspect the byte-match results and retain that explicit warning rather than treating `--strict-installed` as a native-installation verdict.

Use the plugin list for installed version metadata, `desk_status` for the resolved workspace/person and detailed startup state, and `desk_doctor` with `{"format":"preview"}` for the MCP version and minimal runtime state. The minimal diagnostic does not identify the whole plugin stack or guarantee complete index readiness, and it is not a behavior assessment. No new provider API key or review service is part of this preview; use the models your host already makes available.

For isolated installation experiments, changing `HOME` alone is not sufficient when `COPILOT_HOME` is inherited. Explicitly select the disposable `COPILOT_HOME` and XDG directories as well, and check the actual settings destination before registering plugins. Also place the experimental working directory outside ancestor trees containing another installation's skills or instructions. Changing profile variables does not stop inherited directory discovery.

## Give feedback through the agent

Say, for example:

> Capture this as private preview feedback: "The agent asked for go at the right point, but repeated the same design choice three times."

The agent uses [Preview Feedback](skills/preview-feedback/SKILL.md) and the `desk_feedback` tool. It records the installed Desk version and your words, not an inferred opinion or a performance score. If it proposes a summary rather than preserving your text, it must show you that summary and get your confirmation first.

You can then say "show me my preview feedback", "correct this entry to ...", or "delete this entry". Listing supports pagination; correction uses the revision you actually read so it cannot silently overwrite a concurrent change.

Capture is not consent to share. Before sending or publishing identifiable feedback, the agent shows the exact excerpt and destination and waits for your confirmation. A publication in Git belongs in your own desk and remains attributed to you. Withdrawing something already published in Git means a tombstone, not erasing its history.

### The privacy boundary

The store is local, separate from your Git workspace, search index, embeddings, and shared snapshots. It has no collector, network operation, export action, or cross-device sync. It uses operating-system access controls rather than encryption and refuses storage when it cannot establish its protection. See the [storage contract](plugins/desk/mcp/docs/private-feedback.md) for platform details and limits.

This does not make your conversation private from the host or model provider. Text you type, or ask the agent to read back, remains part of that conversation and follows its retention rules. Local deletion removes the live SQLite row and clears its freed pages; it cannot erase conversation history, OS backups, or copies already shared. Agents and administrators with access to your operating-system account are not isolated from you by this store. No claim of anonymity, employee-performance measurement, or regulatory compliance is made.

The optional [minimal diagnostic](plugins/desk/docs/preview-diagnostics.md) is a separate, on-demand package/process snapshot. It reads no feedback or task data and sends nothing on its own.

## Roll back without moving your desk

Keep the existing workspace and private-state directory. Do not delete either to uninstall the preview.

The exercised rollback is the main-branch baseline at `c5a210f91ee59584f5cbcf126966498c17ebccc2`: Desk `3.1.2`, Work Suite `3.0.0`, and MCP `1.3.4`, with the same Plain Language and Ponytail versions. Prepare a separate inactive checkout:

```bash
git clone --no-checkout https://github.com/ourostack/ouroboros-skills.git "$HOME/agentic-engineering-v1"
git -C "$HOME/agentic-engineering-v1" checkout --detach c5a210f91ee59584f5cbcf126966498c17ebccc2
copilot plugin marketplace remove ouroboros-skills --force
copilot plugin marketplace add "$HOME/agentic-engineering-v1"
copilot plugin install desk@ouroboros-skills
copilot plugin install work-suite@ouroboros-skills
copilot plugin install plain-language@ouroboros-skills
copilot plugin install ponytail-upstream@ouroboros-skills
copilot plugin list
```

Restore any other previously enabled companion and repeat the skill-source preflight from the same working directory, this time requiring the selected V1 paths. Check again for preview paths after a later reinstall. Then start a fresh session with the same workspace/person binding. V1 does not expose the private-feedback tool, but rollback does not remove its store. Reinstalling the preview against the same resolved workspace and state location makes those entries available again. Native Mac runs have demonstrated two rollback/reinstall cycles with a preserved workspace sentinel and unchanged private-store bytes during V1, including skill-source checks in both directions; other host routes require their own evidence.

## What qualifies the proposal

The [permanent engineering kernel](evals/engineering-v2-kernel.json) covers new-work alignment, approved local delivery, and primary-source status. It binds results to complete source and contract fingerprints. Structural validation does not run a model or establish behavior.

The first alpha failed despite green-looking intermediate evidence: one subject implemented and deleted scratch prototypes before go, and another passed its authored tests and review while losing required input characters. The revised method addresses those observed failures without a fixture-specific hint. Controlled single-prompt method slices, default skill discovery, native installation, and participant experience remain separate evidence categories. The published fixture genericizes one descriptive ASCII example; historical runs keep their original source and contract identities rather than being relabeled as runs of the publication variant.

This branch is the place to challenge the proposal, not proof that the challenge is over. Promotion to main remains a separate owner decision after existing V1 users have a genuine opportunity to give feedback.
