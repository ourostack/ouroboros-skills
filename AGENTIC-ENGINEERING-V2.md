# Agentic Engineering V2 technical alpha

This is an opt-in technical alpha for existing Desk users, not the main-branch default or a qualified V1 replacement. It selects pinned Superpowers as the engineering method while retaining Desk/Crew state, authority and approved delivery boundaries. Public implementation evidence is separate from private participant feedback.

**Candidate status:** Current source/package tests do not establish alpha runtime admission. The [historical outcome ledger](evals/engineering-v2-results.md) retains the earlier Work Suite-based preview's method failures, bounded Mac/Windows observations and measurement limits. Those source identities and result tables remain unchanged; they are not evidence that this Superpowers composition passed.

## The proposal

Keep the durable workspace. Simplify how work happens inside it. Stronger models should not need a second task system, a stack of overlapping methodologies, or ceremony that substitutes for a working result.

| Part | Responsibility |
|---|---|
| The native host and frontier model | Reason, use tools, and execute the agreed work |
| Desk and Crew | Keep task state, continuity, shared knowledge, attribution, and read-across/write-own boundaries |
| Pinned Superpowers | Own discovery, planning, implementation and verification through `desk:superpowers-integration`; consume existing approval and canonical Desk records |
| Independent review | `desk:independent-review` owns finding disposition and re-review; RoboRev is a first-class reviewer through an admitted host integration, with one implementation owner for fixes |
| Pinned Ponytail | Prefer existing capabilities and the smallest complete implementation, without shrinking scope or proof |
| Private preview feedback | Let the participant capture, inspect, correct, and delete their own comments |

The provider pins `obra/superpowers` at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (6.3.0, MIT), with selected-file provenance in `upstream-sources.lock.json`. The authored Copilot hook adapter is separate from pristine upstream hooks. Historical comparisons remain historical; adopting this opt-in composition is not a new measured reliability result or authority to run an always-on review daemon.

### What changes in a task

Read the recorded intent, design agreement, scope, definition of done and go before acting. Preserve an existing approval; use Superpowers brainstorming when agreement is missing, not to repeat an approved questionnaire. Scope, repository authority, delegation limits and intentional alpha/PR-only endpoints remain binding.

After go, retain control through the agreed result. Resume an already-approved task without repeating its questionnaire. A local implementation, a PR, a preview branch, and a production rollout are different finish lines; broad autonomy does not expand repository authority or silently promote one finish line into another.

Keep test-first changes, failure-path checks, the repository's own coverage rules, and risk-scaled independent review. Add primary evidence that the requested result works, including an executed attempt to falsify a consequential claim with a materially different probe. Passing the examples that drove the implementation is not enough. Review invocation alone is not review evidence.

Keep the human-facing evidence in the existing task: what was agreed, what changed, the actual source and workflow version, the outcome, review findings and closure, known limits, and rollout or rollback when relevant. Do not add another progress database or a numeric self-grade.

The maintained bindings are [Superpowers integration](plugins/desk/skills/superpowers-integration/SKILL.md), [independent review](plugins/desk/skills/independent-review/SKILL.md) and the pinned [provider](plugins/superpowers/README.md). Legacy capability names have explicit successor owners and runtime limits in the integration contract, not a second enabled lifecycle.

## Opt in without mixing versions

The current source candidate is Desk `3.2.0-alpha.3`, Superpowers `6.3.0`, MCP `1.4.0-alpha.3`, Plain Language `0.2.0` and Ponytail `4.9.0`; shared workspaces also consume Crew `0.2.0`. Generic source references use `@v2-alpha`, resolved to an exact commit and content fingerprint for admission. Versions, generated activation and native artifacts must agree. A version label alone is not loaded-artifact identity.

Choose one active workflow version for your work. Retaining an inactive checkout for rollback is fine; enabling V1 and V2 methods together is not. Keep your existing Desk location, Crew person binding, selected overlay, and repository permissions.

**Use the owning host's explicit opt-in composition.** Do not change a live default profile, replace an existing overlay with the standalone worker or infer transitive native loading from packaging metadata. The admitted Desk root must be the same artifact supplied to native skill loading and the MCP process. Do not guess a sibling cache root or bypass a host's source authority.

The supplied offline runtime packs target ARM macOS with Node 22 and x64 Windows with Node 24. Use the matching Node version on the CLI's `PATH`. The [native Windows CI](https://github.com/ourostack/ouroboros-skills/actions/runs/34266621708) exercises actual NTFS protection, feedback CRUD/reopen and offline source-mirror attribution on that Windows target; it does not qualify a full Windows CLI installation, skill-discovery or rollback flow. A different Node/architecture combination is not qualified by those packs.

Keep the existing workspace/person binding, source inventory and overlay chain. An inactive checkout may be retained for rollback. Read-only inventory commands can help establish the selected source:

```bash
git -C "$ALPHA_SOURCE" rev-parse HEAD
git -C "$ALPHA_SOURCE" status --short
copilot plugin marketplace list
copilot plugin list
```

Do not mutate the admitted source during an in-flight task. A fresh session must consume the chosen instructions and MCP together. Keep the existing overlay's launch and binding. Standalone `desk:worker` is not a substitute for a consumer-owned worker.

Before starting work, inspect the actual skill sources from that project's working directory:

```bash
copilot skill list --json
```

Require Superpowers skills to resolve under the admitted source's `plugins/superpowers/skills/`, with `desk:superpowers-integration`, `desk:independent-review` and Desk state skills under that same source's `plugins/desk/skills/`. Verify actual source paths and content, not just menu names. An enabled Work Suite lifecycle is a conflict; an inactive legacy checkout is not. Preserve operator preferences and interpret retired names through the compatibility map rather than rewriting their text. Ancestor or personal skill shadowing must be resolved through the owning host, not bypassed by deleting guidance.

The legacy Work Suite audit and old preview receipts are not Superpowers admission checks. Freeze current source hashes, selected provider lock, native launch inputs, loaded skills and actual backend identity. Offline fixtures, bootstrap transport and full method-following behavior are distinct evidence classes; do not promote one into another.

The retained [method-slice kernel](evals/engineering-v2-kernel.json) and [investigation-boundary suite](evals/investigation-boundaries.json) carry current seals for their declared source files. Those seals change when shared Desk owners change; historical receipts and result tables do not. Their legacy source maps are not a complete Superpowers evaluation map. Structural validation does not run an agent, judge evidence or qualify this composition.

Use the plugin list for version metadata, `desk_status` for workspace/person and startup state, and `desk_doctor` with `{"format":"preview"}` for the MCP version and minimal runtime state. These do not identify the entire loaded stack or prove behavior. The host owns RoboRev launch and backend authentication; missing reviewer capability must be reported, not silently replaced or called successful.

For isolated installation experiments, changing `HOME` alone is not sufficient when `COPILOT_HOME` is inherited. Explicitly select the disposable `COPILOT_HOME` and XDG directories as well, and check the actual settings destination before registering plugins. Also place the experimental working directory outside ancestor trees containing another installation's skills or instructions. Changing profile variables does not stop inherited directory discovery.

## Give feedback through the agent

Say, for example:

> Capture this as private preview feedback: "The agent asked for go at the right point, but repeated the same design choice three times."

The agent uses [Preview Feedback](skills/preview-feedback/SKILL.md) and the `desk_feedback` tool. It records the installed Desk version and your words, not an inferred opinion or a performance score. If it proposes a summary rather than preserving your text, it must show you that summary and get your confirmation first.

You can then say "show me my preview feedback", "correct this entry to ...", or "delete this entry". Listing supports pagination; correction uses the revision you actually read so it cannot silently overwrite a concurrent change.

Two fixed native Mac scenarios exercised this surface on alpha.2: ordinary discussion with feedback capability available made no capture attempt, and explicitly authorized capture, inspection, same-record correction and deletion completed with an empty final store. The discussion case also attempted an unrelated read that the fixed tool policy denied. These are bounded functional observations, not a general privacy reliability estimate.

Capture is not consent to share. Before sending or publishing identifiable feedback, the agent shows the exact excerpt and destination and waits for your confirmation. A publication in Git belongs in your own desk and remains attributed to you. Withdrawing something already published in Git means a tombstone, not erasing its history.

### The privacy boundary

The store is local, separate from your Git workspace, search index, embeddings, and shared snapshots. It has no collector, network operation, export action, or cross-device sync. It uses operating-system access controls rather than encryption and refuses storage when it cannot establish its protection. See the [storage contract](plugins/desk/mcp/docs/private-feedback.md) for platform details and limits.

This does not make your conversation private from the host or model provider. Text you type, or ask the agent to read back, remains part of that conversation and follows its retention rules. Local deletion removes the live SQLite row and clears its freed pages; it cannot erase conversation history, OS backups, or copies already shared. Agents and administrators with access to your operating-system account are not isolated from you by this store. No claim of anonymity, employee-performance measurement, or regulatory compliance is made.

The optional [minimal diagnostic](plugins/desk/docs/preview-diagnostics.md) is a separate, on-demand package/process snapshot. It reads no feedback or task data and sends nothing on its own.

## Roll back without moving your desk

Keep the existing workspace and private-state directory. Do not delete either to uninstall the preview.

The earlier Work Suite-based preview exercised rollback to `c5a210f91ee59584f5cbcf126966498c17ebccc2`: Desk `3.1.2`, Work Suite `3.0.0` and MCP `1.3.4`, with the same Plain Language and Ponytail versions. The commands below are that historical reference, not proof that the new Superpowers host composition can roll back. Current alpha adoption and rollback require the owning host's separate qualification and authorization.

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

The [experiment design and historical arm definitions](evals/engineering-v2-experiments.md) publish the original coding task, rubric, source pins and invocation modes. They distinguish what was executed from what a new run of the published fixture would test.

The first alpha failed despite green-looking intermediate evidence: one subject implemented and deleted scratch prototypes before go, and another passed its authored tests and review while losing required input characters. The second round preserved alignment in its recorded subjects, but GPT delivery still lost combining marks after consuming the method, obtaining fresh review and executing its challenge. Opus delivered a correct result without demonstrating delivery-method consumption, fresh review or strict test-first execution. Three judges also made malformed report attempts before their accepted reports. The [complete outcome ledger](evals/engineering-v2-results.md) separates these results rather than treating driver passes as proof of every floor.

Before another method comparison, close the measurement gaps: map each claimed floor to observable evidence, distinguish configured method from actual consumption, and make the judge's report rule agree with the adapter's admission rule. Another reminder or unchanged-candidate rerun is not the next step. Independent acceptance authorship is a hypothesis to investigate, not an established fix.

Controlled single-prompt method slices, native installation, actual skill discovery and participant experience remain separate evidence categories. The published fixture genericizes one descriptive ASCII example; historical runs keep their original source and contract identities. No historical receipt is relabeled as a coding-method run of this publication variant.

This branch is the place to challenge the proposal, not proof that the challenge is over. Promotion to main remains a separate owner decision after existing V1 users have a genuine opportunity to give feedback.
