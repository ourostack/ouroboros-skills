# Preview runtime diagnostics

Call `desk_doctor` with `{"format":"preview"}` for a versioned, local-on-demand diagnostic snapshot. The same request works in healthy and dependency-free diagnostic modes. The ordinary empty-input doctor response remains the detailed local recovery report.

The preview response contains exactly `schema_version`, `purpose`, `collection`, `mcp_version`, `runtime_state`, `platform`, `architecture`, `node_major`, and `node_abi`. It reads package and process metadata, not feedback, task state, the search index, credentials, environment variables, or user directories. It writes no record and sends nothing to a collector.

`runtime_state` distinguishes `ready` from `diagnostic`; it does not certify full index health, feedback-store protection, every installed plugin, or successful model behavior. `mcp_version` identifies the actually loaded MCP package. Use the existing Work Suite runtime audit separately for skill composition.

A local snapshot is not an anonymity or GDPR guarantee. A person, host combination, or transport can still make a shared record identifiable. Inspect the exact record and confirm its destination before sharing it; do not silently post it or combine it with task, effort, cost, performance, or conversation data. Qualitative preview feedback has its own private storage and consent path.

An unsupported format is an error, not a fallback to a more identifying report. Before any proposed publication, require the exact snapshot schema and allowlist above. An older installation or unexpected error response may return a different shape; keep it local and explain the mismatch rather than describing it as a safe snapshot.
