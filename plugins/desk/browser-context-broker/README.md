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
is removed from the pending-request map and closes the socket so lease release
or cleanup can record that target as failed, unwind its operation lock, and be
retried rather than hanging indefinitely.

## Provider IPC

The broker sends one JSON request on stdin and expects one JSON result on stdout. A provider that cannot complete an operation exits nonzero. To preserve an actionable provider diagnostic, it may write exactly one error envelope to stdout:

```json
{"code":"ENDPOINT_COLLISION","message":"Selected endpoint was claimed before launch","details":{"attempt":1}}
```

The envelope contains only `code`, non-empty `message`, and optional object-valued `details`. The broker preserves the approved provider codes `ENDPOINT_COLLISION` and `UNSUPPORTED_CONTEXT_RECOVERY`, including their details. Unknown codes, malformed JSON, invalid field types, and extra fields are reported as `PROVIDER_EXITED`; provider stdout is not copied into that fallback diagnostic.
