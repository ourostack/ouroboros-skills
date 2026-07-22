import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export const REEXEC_ATTEMPT_ENV = "DESK_MCP_REEXEC_ATTEMPT"

const probeScript = [
  "process.stdout.write(JSON.stringify({",
  "platform: process.platform,",
  "arch: process.arch,",
  "node_abi: process.versions.modules,",
  "node_version: process.version,",
  "}))",
].join("")

export function discoverNodeCandidates({
  currentExecutable = process.execPath,
  env = process.env,
  homeDir = env.HOME ?? os.homedir(),
  platform = process.platform,
} = {}) {
  const executableName = platform === "win32" ? "node.exe" : "node"
  const candidates = []
  addExecutable(candidates, currentExecutable)
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    addExecutable(candidates, path.join(directory, executableName))
  }
  const nvmVersionsRoot = path.join(homeDir, ".nvm", "versions", "node")
  if (isDirectory(nvmVersionsRoot)) {
    for (const version of readdirSync(nvmVersionsRoot).sort()) {
      addExecutable(candidates, path.join(nvmVersionsRoot, version, "bin", executableName))
    }
  }
  for (const candidate of [
    path.join(homeDir, ".volta", "bin", executableName),
    path.join(homeDir, ".asdf", "shims", executableName),
    path.join(homeDir, ".local", "share", "mise", "shims", executableName),
  ]) {
    addExecutable(candidates, candidate)
  }
  return candidates
}

export function probeNodeRuntime({
  executable,
  env = process.env,
  spawnSync = nodeSpawnSync,
} = {}) {
  const result = spawnSync(executable, [
    "--input-type=module",
    "--eval",
    probeScript,
  ], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: 2000,
  })
  if (result.error !== undefined || result.status !== 0) {
    return {
      ok: false,
      executable,
      reason: result.error?.code ?? "probe_failed",
    }
  }
  try {
    const runtime = JSON.parse(result.stdout.trim())
    if (
      typeof runtime.platform !== "string" ||
      typeof runtime.arch !== "string" ||
      typeof runtime.node_abi !== "string"
    ) {
      throw new Error("invalid probe response")
    }
    return {
      ok: true,
      executable,
      ...runtime,
    }
  } catch {
    return {
      ok: false,
      executable,
      reason: "invalid_probe_response",
    }
  }
}

export function selectCompatibleNode({
  candidates = [],
  currentTarget,
  env = process.env,
  probe = (executable) => probeNodeRuntime({ executable, env }),
  shippedTargets = [],
} = {}) {
  if (hasText(env[REEXEC_ATTEMPT_ENV])) {
    return {
      mode: "diagnostic",
      reason: "guarded_reexec_failure",
      paths_checked: [],
    }
  }
  const pathsChecked = []
  for (const executable of candidates) {
    pathsChecked.push(executable)
    const runtime = probe(executable)
    if (!runtime?.ok) {
      continue
    }
    const target = shippedTargets.find((candidate) => (
      candidate.platform === runtime.platform &&
      candidate.arch === runtime.arch &&
      String(candidate.node_abi) === String(runtime.node_abi)
    ))
    if (target !== undefined && target.id !== currentTarget?.id) {
      return {
        mode: "reexec",
        executable,
        target,
        paths_checked: pathsChecked,
      }
    }
  }
  return {
    mode: "diagnostic",
    reason: "no_compatible_node",
    paths_checked: pathsChecked,
  }
}

export function reexecWithCompatibleNode({
  argv = process.argv.slice(2),
  entrypointPath,
  env = process.env,
  executable,
  spawn = nodeSpawn,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [entrypointPath, ...argv], {
      env: {
        ...env,
        [REEXEC_ATTEMPT_ENV]: "1",
      },
      shell: false,
      stdio: "inherit",
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      resolve({ code, signal })
    })
  })
}

export const reexecuteWithCompatibleNode = reexecWithCompatibleNode

function addExecutable(candidates, candidate) {
  if (!hasText(candidate) || candidates.includes(candidate) || !isFile(candidate)) {
    return
  }
  candidates.push(candidate)
}

function isFile(candidate) {
  try {
    return existsSync(candidate) && statSync(candidate).isFile()
  // This only changes when the path disappears or becomes inaccessible between the existence check and stat.
  /* node:coverage ignore next 3 */
  } catch {
    return false
  }
}

function isDirectory(candidate) {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory()
  // This only changes when the path disappears or becomes inaccessible between the existence check and stat.
  /* node:coverage ignore next 3 */
  } catch {
    return false
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}
