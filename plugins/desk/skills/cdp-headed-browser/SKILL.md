---
name: cdp-headed-browser
description: Invoke when worker needs Playwright to drive a Microsoft web UI behind Entra Conditional Access (ECS portal, eng.ms admin surfaces, MyHR, internal SharePoint, any aka.ms link that 530003s on a fresh profile), OR when the operator wants multiple agents to share one auth'd browser, OR when a Playwright MCP session fails with Entra "Device state — Unregistered" (error 530003). Covers the CDP-attach architecture (long-running headed Edge + Playwright MCP attaches via `--cdp-endpoint`), the launch ritual, the macOS Edge first-launch trap, the no-`bringToFront()` rule, and reusable `connectOverCDP` patterns. Do NOT invoke for browser tasks against non-Microsoft sites where a throwaway isolated Chromium suffices, for headless scraping that doesn't need auth, or when the operator's current Playwright MCP is already working — the architecture switch has a relaunch cost and shouldn't be paid speculatively.
---

# cdp-headed-browser

This skill inherits all invariants in `../../principles.md`. Read them first if they are not already in context.

The default Playwright MCP shape (throwaway isolated Chromium per session) breaks against Microsoft-internal web surfaces because:

1. **Entra Conditional Access checks device identity** — a fresh `--user-data-dir` is an unregistered device. SSO returns error 530003 ("Set up your device to get access") before auth even gets to FIDO.
2. **Sessions can't share state** — every isolated launch starts from scratch; even if you somehow auth once, the next agent invocation re-FIDOs.
3. **Headless mode silently swallows interactive auth prompts** — Windows Hello / hardware-key prompts can't be completed; the script just hangs at "Please wait."

The fix is a different architecture: one **long-running headed browser** outside any worker session, with **Playwright MCP attaching to it via CDP**. Each worker session opens its own tab; auth state lives in the shared browser profile; multiple agents can drive concurrently without profile-lock conflicts.

This skill covers how to set that up, the gotchas worker has actually hit, and the patterns worker uses to drive a CDP-attached browser without trampling the operator.

## When to set this up vs. when to leave it alone

Setting it up costs a relaunch ritual and a one-time Edge profile bootstrap. Pay that cost when:

- The operator's task needs an authenticated Microsoft web UI (ECS portal, Lockbox approval pages, AdminUX, eng.ms admin surfaces, internal SharePoint forms).
- Multiple agents need to drive Playwright concurrently against the same surface.
- A previous attempt with the default isolated Chromium hit error 530003 or got stuck at a FIDO prompt.

Don't pay it for one-off scraping against external sites where the isolated Chromium works fine.

## The 3-constraint architecture

| Constraint | Default isolated MCP | CDP-attach to headed Edge |
|---|---|---|
| Any number of agents | Each spawns own Chromium. No state shared. | All MCP sessions attach to one Edge, each opens its own tab. |
| Headed for human interaction + oversight | Headless by default; FIDO un-completable. | Edge is a real window; operator can intervene. |
| Maintain session context (auth) | Fresh profile each session; auth lost. | Profile is persistent in `~/.playwright-agent-edge`. |

## agency.toml

Workspace `agency.toml` `[mcps.servers.playwright]` block for CDP-attach:

```toml
[mcps.servers.playwright]
type = "stdio"
command = "npx"
args = [
  "-y",
  "@playwright/mcp@latest",
  "--cdp-endpoint", "http://localhost:9222",
]
```

No `--browser`, no `--isolated`, no `--user-data-dir`, no `--headless`. The browser running at `:9222` dictates the rest.

After editing `agency.toml`, the operator must relaunch worker for the MCP to re-read its config.

## Browser launch — Edge on managed macOS

On a Microsoft-managed Mac, **Edge** is the right browser because it has native Platform SSO support — talks to the Company Portal extension at the OS level to grab device identity. A fresh `--user-data-dir` inherits Entra device registration automatically. Chrome can do this too but requires the Microsoft Single Sign On extension to be installed in the profile (which managed-Mac MDM policy typically pushes, but verifying that adds setup steps). Default to Edge unless the operator has a reason otherwise.

Launch command:

```bash
nohup "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.playwright-agent-edge" \
  > /tmp/agent-edge.log 2>&1 &
disown
```

Then verify CDP is listening:

```bash
curl -s http://localhost:9222/json/version | jq '.Browser'
```

Expected: `"Edg/<version>"`.

## macOS Edge first-launch trap

On the very first launch with a new `--user-data-dir`, macOS Edge prioritizes its first-run UX (Mac Welcome page, Copilot pitch, default-browser ask, sync setup) over any URL passed as a positional argument. The URL gets dropped on the floor.

Workaround: launch without a URL, wait for CDP to come up, then open the actual target URL via CDP HTTP API:

```bash
curl -s -X PUT "http://localhost:9222/json/new?https://ecs.skype.com/..."
```

After the profile is established (the first run is over), subsequent launches honor a URL arg normally. The trap only bites once per `--user-data-dir`.

## Platform SSO behavior

On a managed Mac with Platform SSO active, the first time the agent-Edge profile sees a `*.microsoft.com` SSO surface:

1. SSO loads, recognizes Platform SSO is available, shows a **multi-account picker** with every identity the OS has cached (operator's `@microsoft.com`, test-tenant admins, etc.).
2. Operator picks the right account.
3. SSO completes via PRT — usually no FIDO prompt, because the PRT establishes device identity automatically.
4. Auth state lands in the profile's cookies.

After the first sign-in, subsequent navigations from any tab/agent reuse the cached cookies. Refresh tokens last days to weeks before re-prompting.

If the account picker doesn't appear (just a plain email-then-FIDO flow), Platform SSO isn't reaching this profile — usually means MDM policy didn't push the SSO config to the user-data-dir. The fallback is one FIDO completion which then caches the same way.

## The no-`bringToFront()` rule

When driving the CDP-attached headed browser from worker, **never call `page.bringToFront()`**. The call yanks the Edge app to the macOS foreground every time it runs, stealing OS focus away from whatever the operator is doing in their other windows.

This is invisible under the prior `--isolated` headless mode (no window = nothing to raise) but extremely visible under CDP-attached headed Edge. Operators have called it out by name as a focus-grabbing trap.

Playwright's CDP-synthesized click/fill events don't require the window to be in foreground. The page can be backgrounded for the entire automation while still responding to all CDP commands.

If a specific action genuinely needs the page visible (a Save-As dialog, an OS-level permission prompt — rare), surface that to the operator instead of grabbing focus silently.

## CDP HTTP API — what you can do without Playwright

The browser's CDP server exposes a small HTTP surface (default `:9222`) that's useful for cheap operations without spinning up the Playwright library:

```bash
# List all tabs (filter to type=page to skip background_page extensions)
curl -s http://localhost:9222/json | jq -r '.[] | select(.type=="page") | "\(.id)\t\(.title)\t\(.url)"'

# Browser metadata
curl -s http://localhost:9222/json/version

# Open a new tab to a URL (works around the first-launch trap above)
curl -s -X PUT "http://localhost:9222/json/new?<URL>"

# Activate (focus) an existing tab
curl -X PUT "http://localhost:9222/json/activate/<tab-id>"

# Close a tab
curl -X PUT "http://localhost:9222/json/close/<tab-id>"
```

For anything that requires *interaction* (clicks, fills, navigation tracking), use Playwright's `chromium.connectOverCDP()` — see template below.

## Playwright `connectOverCDP` template

When worker needs to drive the attached browser from a Node script (e.g. when the Playwright MCP isn't loaded yet but Edge is already running):

```js
import { chromium } from 'playwright';
// (path to playwright will vary — typically ~/.npm/_npx/<hash>/node_modules/playwright/index.mjs
// after any prior `npx @playwright/mcp@latest` has populated the cache)

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];                  // default persistent context
const page = ctx.pages().find(p => p.url().includes('<target>')) || ctx.pages()[0];

// NO page.bringToFront() — see rule above.

await page.locator('[aria-label="<label>"]').click();
// ...

await browser.close({ reason: 'detach' });          // disconnects MCP from browser;
                                                    // browser keeps running.
```

Important: `browser.close({ reason: 'detach' })` on a CDP-connected browser only disconnects Playwright. The Edge process keeps running for the next agent. To actually terminate Edge, use `pkill` (see Cleanup).

## Cleanup

When the operator says "close the browser" or worker is done with a one-off CDP-attached session:

```bash
pkill -f "user-data-dir=.*playwright-agent-edge"
# Verify:
pgrep -lf playwright-agent-edge || echo "(cleared)"
curl -s --max-time 2 http://localhost:9222/json/version || echo "(CDP gone)"
```

Edge spawns helper processes (renderer, GPU, utility) that may need a second pass — repeat the `pkill` if any survive. The `--user-data-dir` itself stays on disk; auth state in it persists for the next launch.

## Failure modes

- **CDP not listening (`curl ... | head -c 50` returns empty / connection refused)** — Edge isn't running, or running without `--remote-debugging-port`, or another process is holding the port. Verify with `lsof -i :9222`.
- **Error 530003 even with Edge on managed Mac** — Platform SSO didn't reach this profile. Fallback to MDM-distributed Microsoft SSO extension install in the profile, or accept the one-time FIDO and rely on cached cookies.
- **First navigation lands at `edge://mac-welcome` regardless of URL arg** — first-launch trap; use `/json/new?url=` workaround.
- **Operator's focus keeps getting stolen** — `bringToFront()` is somewhere in the script. Strip it.
- **Playwright `connectOverCDP` returns 0 contexts** — Edge crashed or restarted without the CDP flag. Re-launch.
- **`browser.close()` without `{ reason: 'detach' }`** — may try to actually terminate the browser, killing other agents' tabs. Always pass `{ reason: 'detach' }` from worker code.

## Cross-references

- **`agency.toml` schema** — see `worker:add-workspace-mcp` for the `[mcps.servers.<alias>]` shape and the agency-spawner gotchas around `type = "npx"` vs `type = "stdio"`.
- **ECS portal driving** specifically — see `worker:ecs-portal-driving` which builds on this skill.
- **Workspace operator's `~/.playwright-agent-edge` directory** is sacred state. Don't delete it; it holds auth.
