---
name: content-routing
description: >-
  Decide where durable content belongs: the product repository, an operator's
  workspace, a generic plugin, or a context overlay. Invoke before encoding
  product behavior, interfaces, installation contracts, defaults,
  compatibility promises, release rules, a friction disposition, a captured
  lesson, an operator preference, a repo-specific gotcha, or a new skill's
  layer. Within a plugin, also decides always-on body/principles vs a triggered
  skill and whether to split a generic engine from a context skin. Do NOT
  invoke for file placement inside a workspace (that's `directory-structure`)
  or for human-facing voice.
---

# Content routing — where does this belong?

Durable content fails when it lands in the wrong home. A general principle wedged into an operator's personal rules file blurs into always-on background and never fires at the moment it applies; an operator-specific preference shipped into a shared plugin imposes one person's taste on everyone who uses it. This skill is the decision tree for getting the home right the first time — the encode-flow skills (`curator`, `friction-management`, `lesson-capture`) consult it whenever they choose a destination.

## The substrate, in one picture

- A **workspace** is one operator's desk: their state (tracks, tasks, friction, planning) **and** their operator-specific rules (voice, output preferences, name resolutions, their particular risk tolerance). It is per-operator and per-context — and there can be **many desk instances**: a work desk, a personal desk, an autonomous agent's own desk, each a separate workspace repo consuming the same plugins. These instances split along an **identity axis** as much as a purpose one: a work desk authenticates as an *employer-managed* account, a personal desk as a *personal* account. That identity is what decides which account a given push lands under — the generic seed an overlay later instantiates with concrete account names.
- A **product repository** owns the product being built. Its source, documentation, and executable tests define the product's behavior, interfaces, installation contracts, defaults, compatibility promises, and release rules. Those contracts do not become workspace or plugin content merely because an agent discovered or discussed them there.
- The **plugins** are the shared code every desk consumes:
  - a **generic substrate plugin** (`desk`) plus the **pinned engineering provider** (`superpowers`) — vendor-neutral. Repo-authored integration belongs in Desk; pristine upstream payload changes require the maintained provenance/update path, not an in-place fork.
  - **overlay plugins** that layer employer- or context-specific behavior on top of the generic substrate — these hold content that's *general to that context* but can't ship in the public generic plugins.

So content lives in exactly one of four homes: the product repository, a workspace, a generic plugin, or an overlay plugin.

## The routing decision

1. **Product-defining?** — behavior, interfaces, installation contracts, defaults, compatibility promises, and release rules for the product being built. → Put the contract in the **product repository's source, documentation, and executable tests**. A workspace can retain task state or an attributed perspective. A plugin can retain a reusable agent capability. Neither should become the product's source of truth.
2. **Specific to THIS operator / context?** — a voice preference, a personal name resolution, an emotional reaction, their particular risk tolerance. → It stays in the **workspace**. If a general kernel sits underneath the instance, leave a ≤3-line instance + a pointer to the general home, and route the kernel per step 3.
3. **General — would a *different* operator, or a *different* agent, benefit?** → the **body** goes to a **plugin**; the workspace keeps only the instance + pointer.
   - **Generic, no employer/context-specific content** → the **public generic Desk integration**. Do not edit the pinned provider to encode local rules. Strip employer/context-specific terms before publication; an internal tool, repository or account name is not a generic example.
   - **General to a context but employer/context-specific** (names an internal tool, account model, or repo that can't go public) → the matching **overlay plugin**.
   - **Within the chosen plugin**, pick the surface by *when it must apply*:
     - **Every turn / unconditionally** → the agent **body** (`agents/<name>.md`) or **`principles.md`**.
     - **At one moment** — a specific operation, a decision point, a surface the agent touches → a **skill** (description-gated; fires when its trigger matches).

## The self-check — run before writing into a workspace or plugin

First ask: *"Does this define the product being built?"* If yes, route it to the product repository before considering who raised it or which agent needs it.

Otherwise ask: *"Is the rule BODY universal enough that an operator who isn't this one — or a different agent entirely — would also benefit?"*

If yes, the body belongs in a plugin (route per the decision above) and the rules file keeps only the instance + pointer. **Do not wedge a general-principle body in under an "operator said X" framing.** That semantic mis-tag turns the agent's application gate into *"is this an operator-X context?"* instead of the rule's real trigger — and the rule silently fails to fire when it should. "Obviously generic on first surfacing" is enough to extract; you don't have to wait for a second instance.

## Placing a whole skill: engine, skin, and the canonical library

A skill is a *capability*, not just a rule, so it routes the same way (whose? general? which plugin? which surface?) with two additions that decide its layer at author time.

**The engine/skin test.** Ask the self-check in its sharper form: *would a worker in a different context, a different employer or a different team, want this capability unchanged?*

- **All of it** yes: it is a generic **engine** and belongs in the generic layer.
- **Only part** yes: **split it.** The generic engine goes down (the generic plugin, or the canonical library below); the thin context-specific **skin** stays up in the overlay and *composes* the engine. Do not place a half-generic skill whole in the overlay: that traps the engine one layer too high, where a different context has to rebuild it instead of inheriting it.

**The canonical library + plugin bundles.** A generic capability does **not** need its own plugin. The substrate keeps standalone skills in a **canonical library** (installed individually); a **plugin is a curated bundle** that ships *copies* of the canonical skills it wants its consumers to inherit by default. So:

- a wholly generic engine: author it once in the **canonical library**; any plugin that wants it auto-available **bundles a copy** (opt-in for everyone else). The canonical copy is source-of-truth; the bundle copy must not drift from it.
- a **new plugin**: stand one up only when a *coherent set* of capability wants to be inherited as one dependency by a whole class of consumers, never for a lone builder (which is just a library skill).

**The gate, at author time.** Before a new skill lands in the nearest or most-specific plugin by default, run the test. Wholly generic goes to the canonical library; generic engine plus a context skin gets split; wholly context-specific goes to the context plugin. The default home is the *lowest* layer the capability is honest at, not the *closest* one to where you happen to be working.

## Pointer shape — what stays in the workspace after extraction

> ### Short rule title (DATE)
>
> See `plugins/<plugin>/.../SKILL.md` (or `principles.md` / `agents/<name>.md`) "Section name" (added/migrated DATE in `<org>/<repo>#N`). Instance: *"verbatim quote"* (DATE) — one-sentence context.

## Cross-references

- `directory-structure` — where files go *within* a workspace. This skill is the layer above it: workspace-vs-plugin, and which plugin.
- `curator` / `friction-management` / `lesson-capture` — the encode flows that consult this routing when choosing a home for an encoded entry.
- This skill is the **generic** map. The product repository carries the product contract. An **overlay** can ship a companion skill (e.g. an `<overlay>-content-routing`) that names concrete repos and accounts plus the cross-repo discipline. The **workspace** can hold operator-exact literals such as paths and account names. So: generic decision here → product contract in its repository → context map in the overlay → operator instance in the workspace.
