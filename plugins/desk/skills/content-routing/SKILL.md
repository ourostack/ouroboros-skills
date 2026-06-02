---
name: content-routing
description: Decide where a durable rule, lesson, fact, or preference belongs — the operator's workspace vs a plugin, which plugin (generic vs overlay), and within a plugin an always-on body/principles vs a triggered skill. Invoke whenever the agent is about to encode something durable and must choose its home: a friction disposition (curator), a captured lesson (lesson-capture), a new operator preference or rule, a repo-specific gotcha. Do NOT invoke for where files go *inside* a workspace (that's `directory-structure`), or for what to say to a human (that's a voice/comms concern).
---

# Content routing — where does this belong?

Durable content fails when it lands in the wrong home. A general principle wedged into an operator's personal rules file blurs into always-on background and never fires at the moment it applies; an operator-specific preference shipped into a shared plugin imposes one person's taste on everyone who uses it. This skill is the decision tree for getting the home right the first time — the encode-flow skills (`curator`, `friction-management`, `lesson-capture`) consult it whenever they choose a destination.

## The substrate, in one picture

- A **workspace** is one operator's desk: their state (tracks, tasks, friction, planning) **and** their operator-specific rules (voice, output preferences, name resolutions, their particular risk tolerance). It is per-operator and per-context — and there can be **many desk instances**: a work desk, a personal desk, an autonomous agent's own desk, each a separate workspace repo consuming the same plugins. These instances split along an **identity axis** as much as a purpose one: a work desk authenticates as an *employer-managed* account, a personal desk as a *personal* account. That identity is what decides which account a given push lands under — the generic seed an overlay later instantiates with concrete account names.
- The **plugins** are the shared code every desk consumes:
  - a **generic substrate plugin** (`desk`) plus the **doing-loop plugin** (`work-suite`) — vendor-neutral, no employer- or context-specific content, safe to publish;
  - **overlay plugins** that layer employer- or context-specific behavior on top of the generic substrate — these hold content that's *general to that context* but can't ship in the public generic plugins.

So content lives in exactly one of: a workspace (operator-specific), a generic plugin (general + publishable), or an overlay plugin (general-to-a-context + not publishable).

## The routing decision

1. **Specific to THIS operator / context?** — a voice preference, a personal name resolution, an emotional reaction, their particular risk tolerance. → It stays in the **workspace**. If a general kernel sits underneath the instance, leave a ≤3-line instance + a pointer to the general home, and route the kernel per step 2.
2. **General — would a *different* operator, or a *different* agent, benefit?** → the **body** goes to a **plugin**; the workspace keeps only the instance + pointer.
   - **Generic, no employer/context-specific content** → the **public generic plugin** (`desk` / `work-suite`). Strip every employer/context-specific term before it ships — the public-OSS hygiene gate (grep for the forbidden terms; an example product name is fine, an internal tool/repo/account name is not).
   - **General to a context but employer/context-specific** (names an internal tool, account model, or repo that can't go public) → the matching **overlay plugin**.
   - **Within the chosen plugin**, pick the surface by *when it must apply*:
     - **Every turn / unconditionally** → the agent **body** (`agents/<name>.md`) or **`principles.md`**.
     - **At one moment** — a specific operation, a decision point, a surface the agent touches → a **skill** (description-gated; fires when its trigger matches).

## The self-check — run before writing into an operator's rules file

> *"Is the rule BODY universal enough that an operator who isn't this one — or a different agent entirely — would also benefit?"*

If yes, the body belongs in a plugin (route per the decision above) and the rules file keeps only the instance + pointer. **Do not wedge a general-principle body in under an "operator said X" framing.** That semantic mis-tag turns the agent's application gate into *"is this an operator-X context?"* instead of the rule's real trigger — and the rule silently fails to fire when it should. "Obviously generic on first surfacing" is enough to extract; you don't have to wait for a second instance.

## Pointer shape — what stays in the workspace after extraction

> ### Short rule title (DATE)
>
> See `plugins/<plugin>/.../SKILL.md` (or `principles.md` / `agents/<name>.md`) "Section name" (added/migrated DATE in `<org>/<repo>#N`). Instance: *"verbatim quote"* (DATE) — one-sentence context.

## Cross-references

- `directory-structure` — where files go *within* a workspace. This skill is the layer above it: workspace-vs-plugin, and which plugin.
- `curator` / `friction-management` / `lesson-capture` — the encode flows that consult this routing when choosing a home for an encoded entry.
- This skill is the **generic** map; its concrete instantiation lives in two layers below it. An **overlay** can ship a companion skill (e.g. an `<overlay>-content-routing`) that names the *concrete* repos and accounts plus the cross-repo content discipline — which identity pushes where, what gets stripped before a public push, per-repo version conventions. And the **workspace** can hold a landscape doc with the operator-exact literals (actual URLs, paths, account names). So: generic decision here → context map in the overlay → literals in the workspace.
