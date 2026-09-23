---
name: cdp-headed-browser
description: Invoke when the agent needs Playwright to drive a web UI behind an interactive authentication flow that a throwaway isolated browser cannot complete, when several agents need one persistent authenticated context without sharing tabs, or when the operator's existing Playwright MCP cannot reuse the required browser state. Covers claims-based context acquisition, lease-isolated CDP proxying, background-safe target creation, exact lease release, and broker status and recovery. Do NOT invoke for browser tasks where an isolated browser works, for unauthenticated scraping, or when the current Playwright MCP is already healthy.
---

# cdp-headed-browser

This skill inherits all invariants in `../../principles.md`. Read them first if they are not already in context.

> **Overlay users:** consumer overlays provide browser-specific context declarations, launch behavior, and process attestation. This skill stays generic.

A persistent headed browser is useful when authentication depends on durable browser state or human interaction. Direct attachment to an arbitrary debugging endpoint is not safe, however: a port proves transport availability, not the intended profile, identity, posture, or ownership.

Use the claims-based `browser-context-broker`. It matches the requested declaration conjunctively, freshly attests the process and endpoint, provisions only the requested context when needed, and exposes a lease proxy that shows only lease-owned targets.

## When to use it

Use a brokered headed context when:

- The surface requires interactive authentication that cannot complete in a throwaway browser.
- Several agents need the same persistent authenticated context while keeping their targets isolated.
- A provider-backed persistent profile is required for the task.

Keep the default isolated browser when it works. Broker setup has a persistent-context and provider cost that unauthenticated tasks do not need.

## Required runtime inputs

The consuming overlay supplies:

- A user-private broker configuration containing aliases and context declarations.
- An external provider command implementing discovery, launch, health, and attestation.
- A user-private state directory.
- A launcher that requests the intended alias or claim set.

Aliases are convenience only. The broker expands them to claims and applies the same exact, conjunctive comparison. Missing evidence, zero matches, and ambiguous matches fail closed.

## Normal launcher flow

The installed launcher performs this sequence:

1. Run `browser-context-broker acquire` with the exact alias or JSON claim request.
2. Start `browser-context-broker proxy` for the returned lease and wait for its readiness file.
3. Start Playwright MCP with `--cdp-endpoint` set to the lease proxy endpoint from that file.
4. Run `browser-context-broker release` for the exact lease when Playwright MCP exits.

Example contract:

```bash
browser-context-broker acquire \
  --config "$BROWSER_CONTEXT_CONFIG" \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --alias "$BROWSER_CONTEXT_ALIAS" \
  --json

browser-context-broker proxy \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --lease "$LEASE_ID" \
  --json-ready "$PROXY_READY_FILE"

npx -y @playwright/mcp@latest --cdp-endpoint "$LEASE_PROXY_ENDPOINT"

browser-context-broker release \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --lease "$LEASE_ID" \
  --json
```

Treat `proxyToken` from `acquire` as lease-scoped connection material. Do not place it in logs, status reports, task records, or shared configuration.

## Lease isolation

Every acquisition creates a distinct lease and an initial background target. The lease proxy:

- Filters target discovery and target events to lease-owned targets.
- Owns targets returned by `Target.createTarget`.
- Inherits popup descendants whose opener is lease-owned.
- Rejects attaching to, activating, or closing an unowned target.
- Rejects commands addressed to an unowned target session.
- Forwards non-target commands without exposing another lease's pages.

Never search a persistent browser's global page list for a convenient existing tab. Work only through the lease proxy; all pages visible there are owned targets for that lease.

## Focus preservation

The headed browser is background infrastructure, not a remote-control surface. Never call `page.bringToFront()` or `Target.activateTarget` during unattended automation. The lease proxy rejects those activation commands.

When a new page is required, create it in the background:

```js
const cdp = await browser.newBrowserCDPSession();
const { targetId } = await cdp.send("Target.createTarget", {
  url: targetUrl,
  background: true,
});
```

The proxy records the returned target for the current lease. Popup targets inherit ownership only when their opener is already owned.

Playwright's synthesized click and fill events do not require foreground activation. If an action genuinely requires an operating-system dialog or visible human interaction, surface that requirement instead of grabbing focus.

## Direct `connectOverCDP` use

When a short Node script must connect directly, use only the lease proxy endpoint produced by `proxy`:

```js
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP(process.env.LEASE_PROXY_ENDPOINT);
const context = browser.contexts()[0];
const page = context.pages()[0];

// Interact only with pages visible through this lease proxy.

await browser.close({ reason: "lease client detached" });
```

For an attached client, `browser.close()` detaches that client; it does not terminate the persistent provider-owned browser. The launcher still releases the lease separately so owned targets are closed and registry state is removed.

## Status and recovery

Use broker diagnostics rather than inspecting ports or process-name patterns:

```bash
browser-context-broker status \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --json

browser-context-broker doctor \
  --config "$BROWSER_CONTEXT_CONFIG" \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --json
```

`status` reports non-secret context observations, claims, endpoints, owners, and leases. `doctor` identifies expired leases and actionable reconciliation problems without exposing provider environment, credentials, cookies, or tokens.

Recovery is requested-context-only:

- A stale observation is discarded only after fresh provider attestation fails.
- An absent requested context is provisioned without selecting or modifying another live context.
- Endpoint collisions allocate another dynamic endpoint.
- A crashed requested context is repaired on the next acquisition.
- An unrelated context is never stopped, relaunched, or substituted.

## Cleanup

Normal completion uses `release` for the exact lease. It closes only targets recorded to that lease, removes only that lease record, and leaves the persistent browser alive.

For an expired lease identified by `doctor`, use exact cleanup:

```bash
browser-context-broker cleanup \
  --state-dir "$BROWSER_CONTEXT_STATE" \
  --lease "$STALE_LEASE_ID" \
  --json
```

Do not terminate browsers by executable name, profile-name pattern, or guessed process identifier. Context termination, when genuinely required, belongs to the attesting provider and must operate only on a process identity it proves it owns.

## Failure modes

- **`NO_CONTEXT_MATCH`** — no declaration contains all requested evidence. Fix the request or provider configuration; do not broaden matching.
- **`AMBIGUOUS_CONTEXT_MATCH`** — several declarations match. Make their claims distinct; do not choose by ordering.
- **`LAUNCH_ATTESTATION_FAILED`** — the provider launched something that did not prove the declared executable, profile, owner, endpoint correlation, or configured visible claims.
- **`ENDPOINT_COLLISION`** — dynamic allocation could not find a usable endpoint within the configured attempts.
- **`LEASE_NOT_FOUND`** — the lease was released, expired and cleaned, or the wrong state directory was supplied.
- **`STALE_LEASE` from `doctor`** — run `cleanup` for that exact lease after confirming it is no longer active.
- **Disconnected context** — reacquire the same requested context. Never attach to a different live browser as a fallback.

## Cross-references

- **Workspace MCP configuration:** use `desk:add-workspace-mcp` for the runtime's stdio server shape.
- **Provider-specific launch and attestation:** follow the consuming overlay's browser-provider skill.
- **Persistent profiles:** provider-owned profile roots are durable authentication state. Never delete or repurpose them as cleanup.
