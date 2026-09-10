# Superpowers provider

This package contains the selected, unmodified source payload from [obra/superpowers](https://github.com/obra/superpowers) version 6.3.0, commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`. The MIT license and source notices remain intact. `upstream-sources.lock.json` records every selected source path and SHA-256; the upstream tree is `21219529a4e224bcb27baf8816b039c8bf7c6673`.

The root `plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, this README, and `hooks/copilot-hooks.json` are Ourostack-authored packaging, not upstream files. Copilot uses the explicit `PLUGIN_ROOT` adapter with a bounded timeout. The pristine upstream hooks remain locked for provenance and Claude packaging. Codex declares no hooks capability and uses Desk's generated-instructions bootstrap.

In the opt-in Desk alpha, invoke `desk:superpowers-integration` before using these skills. That contract binds plans, progress, authority, and the terminal endpoint to Desk; it does not change the upstream payload. A successful hook transport probe is not proof of engineering-method consumption, background inheritance, or complete host qualification.
