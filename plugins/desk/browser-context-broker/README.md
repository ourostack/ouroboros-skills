# Browser context broker source package

This directory is the canonical plugin-relative source for Desk's generic browser context broker. It contains the executable, production modules, lockfile, and package metadata needed to install and run the broker with Node.js 20 or newer.

An ordinary Desk plugin install does not install a bare `browser-context-broker` command on `PATH`. The capability is optional until a consuming host overlay provisions it.

The host overlay owns the runtime contract:

1. Locate this package relative to the installed Desk plugin.
2. Copy or install the complete package into an owner-private runtime location.
3. Run `npm ci --omit=dev --ignore-scripts` in that runtime package.
4. Supply the exact installed executable path to its launcher as `BROWSER_CONTEXT_BROKER_BIN`.

The overlay also supplies the private provider, declarations, state directory, and readiness-file location. The generic Desk package does not claim those host-specific resources or mutate the operator's `PATH`.

## CDP transport bounds

The internal `CdpClient` bounds every remote wait: HTTP discovery defaults to
5 seconds, WebSocket connection to 5 seconds, and command responses to 10
seconds. Callers and tests may override `discoveryTimeoutMs`,
`connectTimeoutMs`, and `commandTimeoutMs` when connecting. A timed-out command
is removed from the pending-request map and closes the socket.

Mutating target commands reconcile indeterminate results before ownership changes. Target creation records the caller's original URL plus a unique inert `data:` marker URL in the lease, creates the browser target only at that marker, establishes target-ID ownership from the response or bounded `Target.getTargets` reconciliation, and only then uses bounded `Target.attachToTarget` plus `Page.navigate` to reach the original URL unchanged. Fragments and client-side router state are never modified, redirecting applications cannot erase ownership before it is recorded, proxy callers still receive the created target ID, and the initial lease target finishes at `about:blank`.

After a create timeout or error, one exact marker match becomes owned and continues through navigation; multiple matches fail closed while retaining every candidate target plus the diagnostic. Zero matches remain indeterminate because execution may still have happened: the lease preserves the queryable marker and exact cause for later release or stale cleanup instead of deleting ownership evidence. If reconciliation itself cannot complete within the configured transport bounds, the same pending evidence remains. A navigation failure also leaves the marker target durably owned with an exact diagnostic so cleanup can close it by target ID.

Target close timeout or error also reconnects and queries the target list. An
absent target is reconciled as successfully closed, including target-not-found
on an exact retry. A still-present or unqueryable target remains durably owned
with its close/reconciliation diagnostic; explicit release remains failed and
retryable rather than deleting the lease.

Browser-global commands are restricted independently of flattened target
session ownership. `Browser.getVersion` is the only allowed `Browser.*`
method; `Browser.close` and every other browser-global mutation are rejected
whether sent at the root or through an owned target session.

Owned target sessions also have an explicit profile-storage boundary.
`Network.getAllCookies`, `Network.getCookies`, cookie set/delete/clear methods,
browser-cache clearing, cookie-control and device-bound-session methods are
rejected before upstream dispatch. The proxy rejects all data access and
mutation in the `Storage`, `DOMStorage`, `IndexedDB`, `CacheStorage`,
`Database`, `FileSystem`, `ServiceWorker`, `BackgroundService`, and `Autofill`
domains. The narrow exceptions are frame-to-storage-key lookup
(`Storage.getStorageKeyForFrame` and `Storage.getStorageKey`) and event
subscription toggles (`DOMStorage.enable`/`disable` and
`IndexedDB.enable`/`disable`).

Ordinary frame-local Playwright commands remain available for owned sessions,
including `Runtime.*`, `Page.*`, and non-profile-wide `Network.*` commands such
as `Network.enable`. This method boundary prevents CDP-level profile
enumeration or mutation; code executing in an owned frame can still interact
with that frame's loaded origin under normal browser origin rules.

## Provider IPC

The broker sends one JSON request on stdin and expects one JSON result on stdout. A provider that cannot complete an operation exits nonzero. To preserve an actionable provider diagnostic, it may write exactly one error envelope to stdout:

```json
{"code":"ENDPOINT_COLLISION","message":"Selected endpoint was claimed before launch","details":{"attempt":1}}
```

The envelope contains only `code`, non-empty `message`, and optional object-valued `details`. The broker preserves the approved provider codes `ENDPOINT_COLLISION` and `UNSUPPORTED_CONTEXT_RECOVERY`, including their details. Unknown codes, malformed JSON, invalid field types, and extra fields are reported as `PROVIDER_EXITED`; provider stdout is not copied into that fallback diagnostic.
