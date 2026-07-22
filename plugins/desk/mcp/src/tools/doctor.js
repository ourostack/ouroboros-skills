export function doctorRuntime({ statusContext = {} } = {}) {
  const runtime = statusContext.runtime ?? {}
  return {
    status: "ok",
    mode: "healthy",
    reason: "ready",
    summary: "Desk MCP runtime dependencies are ready.",
    runtime: {
      state: "ready",
      current_target: runtime.current_target ?? runtime.target,
      shipped_targets: runtime.shipped_targets ?? [],
      paths_checked: runtime.paths_checked ?? [],
      runtime_cache_path: runtime.runtime_cache_path ?? runtime.runtime_cache_dir,
      support_matrix_path: runtime.support_matrix_path,
    },
    remediation: [],
  }
}
