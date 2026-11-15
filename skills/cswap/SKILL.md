---
name: cswap
description: Keep several Claude Code accounts working unattended with claude-swap (cswap) — install it, turn on automatic switching, read its account labels, re-log a lapsed account, and watch it so a dead login is caught days early. Use when setting up cswap, when an account shows "token expired" or "re-login needed", when auto-switch did not switch, or when the user asks why an account stopped working.
---

# cswap

[claude-swap](https://github.com/realiti4/claude-swap) (`cswap`) rotates Claude Code between several accounts when one nears its usage limit. The point is set-and-forget: it should switch on its own, overnight, with nobody watching. This skill keeps it that way.

## Install and turn on auto-switch

```sh
uv tool install --force "claude-swap[menubar]"   # 1.0.0 or later
cswap menubar --install-service --auto-switch    # macOS: start at login, auto-switch on
cswap menubar --service-status                   # must say running, auto-switch on
```

Auto-switch is **off by default**. Before 1.0.0 the only switch was a menu toggle, and a fresh install switched nothing. The menu bar reads that setting only at launch, so rerun `--install-service --auto-switch` after any reinstall.

Add each account once: sign in to Claude Code as that account, then `cswap add`.

## Read the account labels

| Label in `cswap list` or the menu bar | Meaning | Action |
|---|---|---|
| usage percentages | healthy | none |
| `token expired` | the short-lived access token ran out; cswap or Claude Code renews it | none; it clears on the next read (minutes) |
| `re-login in 5d …` | the login itself lapses soon | re-log before then (below) |
| `re-login needed` | the login lapsed or was revoked | re-log now (below) |

## Why logins lapse

Every Claude Code login has a fixed end date, about four weeks after the sign-in (`refreshTokenExpiresAt`; `cswap list --json` shows it as `loginExpiresAt`). Renewing the access token never moves that date; only a fresh login does. Accounts signed in on the same day lapse within a day of each other. So a dead account is usually its scheduled lapse, not a cswap bug: compare the death time with `loginExpiresAt` before debugging cswap.

`cswap add-token` registers a long-lived `claude setup-token` login instead. Check that usage still reads for it before relying on it, because auto-switch is blind to an account whose usage it cannot read.

## Re-log an account

1. Never run `/logout` between accounts. It revokes the login cswap is holding for the other slots.
2. `claude auth login --claudeai --email <account email>`. It prints an authorize URL and waits for a code on stdin. To feed the code later from an agent, run it as `tail -f code.txt | claude auth login …` and append the code to `code.txt`.
3. Open the URL in a private browser window, choose Continue with email and enter the emailed code. The sign-in page runs an invisible human check that fails in any browser an agent drives (it reports "Incorrect code entered"). A human has to type the code and click Authorize in an undriven window. An agent can still fetch the emailed code and hand it to them.
4. Paste the code shown after Authorize into the waiting command (or append it to `code.txt`).
5. `cswap add`, then `cswap list`: the account shows usage again and a new `loginExpiresAt`.

The emailed code expires after 10 minutes.

## Watch it

Run a periodic check (launchd, cron, every 10 minutes) that:

- turns auto-switch back on and restarts the menu bar if either is off;
- runs `cswap auto --once` if the active account is spent (98% or more) while another account is below 90%: auto-switch should have moved it already;
- alerts five days before any `loginExpiresAt`, and immediately on `re-login needed`, once per login;
- treats a timed-out `cswap` call as "unknown, try next time", not as a failure, because cswap is slow on a loaded machine.

## Diagnose

- Log: `~/.claude-swap-backup/claude-swap.log`. Look for `Switched from account`, `Auto-switch error`, `invalid_grant`.
- Settings: `~/.claude-swap-backup/menubar_settings.json` (`auto_switch_enabled`).
- Usage cache: `~/.claude-swap-backup/cache/usage.json` (`lastError`, `authDeadStrikes` per account).
- `cswap list --json` for machine-readable state.
