# Browser context broker source package

This directory is the canonical plugin-relative source for Desk's generic browser context broker. It contains the executable, production modules, lockfile, and package metadata needed to install and run the broker with Node.js 20 or newer.

An ordinary Desk plugin install does not install a bare `browser-context-broker` command on `PATH`. The capability is optional until a consuming host overlay provisions it.

The host overlay owns the runtime contract:

1. Locate this package relative to the installed Desk plugin.
2. Copy or install the complete package into an owner-private runtime location.
3. Run `npm ci --omit=dev --ignore-scripts` in that runtime package.
4. Supply the exact installed executable path to its launcher as `BROWSER_CONTEXT_BROKER_BIN`.

The overlay also supplies the private provider, declarations, state directory, and readiness-file location. The generic Desk package does not claim those host-specific resources or mutate the operator's `PATH`.
