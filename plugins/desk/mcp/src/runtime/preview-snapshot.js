import { packageMetadata } from "../package-metadata.js"

export function diagnosticFormat(input) {
  const format = input?.format
  if (format !== undefined && format !== "full" && format !== "preview") {
    throw new TypeError("unsupported diagnostic format; use full or preview")
  }
  return format ?? "full"
}

export function previewRuntimeSnapshot(runtimeState) {
  return {
    schema_version: 1,
    purpose: "preview-runtime-diagnostics",
    collection: "local-on-demand",
    mcp_version: packageMetadata.version,
    runtime_state: runtimeState,
    platform: process.platform,
    architecture: process.arch,
    node_major: Number(process.versions.node.split(".")[0]),
    node_abi: process.versions.modules,
  }
}
