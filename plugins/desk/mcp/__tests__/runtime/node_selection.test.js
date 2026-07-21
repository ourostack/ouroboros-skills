import { test } from "node:test"
import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")

async function loadNodeSelection() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "node-selection.js")))
}

function writeExecutable(file) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, "#!/bin/sh\nexit 0\n", { encoding: "utf8", mode: 0o755 })
  return file
}

test("Node discovery is bounded to the current executable, PATH, and standard version-manager locations", async () => {
  const { discoverNodeCandidates } = await loadNodeSelection()
  const root = mkdtempSync(path.join(tmpdir(), "desk-node-discovery-"))
  const homeDir = path.join(root, "home")
  try {
    const currentExecutable = writeExecutable(path.join(root, "current", "node"))
    const pathNodeA = writeExecutable(path.join(root, "path-a", "node"))
    const pathNodeB = writeExecutable(path.join(root, "path-b", "node"))
    const nvmNode20 = writeExecutable(path.join(homeDir, ".nvm", "versions", "node", "v20.19.5", "bin", "node"))
    const nvmNode22 = writeExecutable(path.join(homeDir, ".nvm", "versions", "node", "v22.23.1", "bin", "node"))
    const voltaNode = writeExecutable(path.join(homeDir, ".volta", "bin", "node"))
    const asdfNode = writeExecutable(path.join(homeDir, ".asdf", "shims", "node"))
    const miseNode = writeExecutable(path.join(homeDir, ".local", "share", "mise", "shims", "node"))
    writeExecutable(path.join(homeDir, "Downloads", "unbounded-node-search-must-ignore", "node"))

    assert.deepEqual(
      discoverNodeCandidates({
        currentExecutable,
        env: {
          PATH: [
            path.dirname(pathNodeA),
            path.dirname(pathNodeB),
            path.dirname(pathNodeA),
            path.join(root, "missing"),
          ].join(path.delimiter),
        },
        homeDir,
        platform: "darwin",
      }),
      [
        currentExecutable,
        pathNodeA,
        pathNodeB,
        nvmNode20,
        nvmNode22,
        voltaNode,
        asdfNode,
        miseNode,
      ],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Node probes execute candidates directly and selection requires an exact shipped target", async () => {
  const {
    probeNodeRuntime,
    selectCompatibleNode,
  } = await loadNodeSelection()
  const spawnCalls = []
  const probe = (executable) => probeNodeRuntime({
    executable,
    spawnSync: (command, args, options) => {
      spawnCalls.push({ command, args, options })
      return command.endsWith("node-22")
        ? {
            status: 0,
            stdout: JSON.stringify({
              platform: "darwin",
              arch: "arm64",
              node_abi: "127",
              node_version: "v22.23.1",
            }),
            stderr: "",
          }
        : {
            status: 0,
            stdout: JSON.stringify({
              platform: "darwin",
              arch: "arm64",
              node_abi: "115",
              node_version: "v20.19.5",
            }),
            stderr: "",
          }
    },
  })
  const result = selectCompatibleNode({
    candidates: ["/fixture/node-20", "/fixture/node-22"],
    currentTarget: {
      id: "darwin-arm64-node-108",
      platform: "darwin",
      arch: "arm64",
      node_abi: "108",
    },
    env: {},
    probe,
    shippedTargets: [
      {
        id: "darwin-arm64-node-127",
        platform: "darwin",
        arch: "arm64",
        node_abi: "127",
      },
    ],
  })

  assert.equal(result.mode, "reexec")
  assert.equal(result.executable, "/fixture/node-22")
  assert.equal(result.target.id, "darwin-arm64-node-127")
  assert.deepEqual(result.paths_checked, ["/fixture/node-20", "/fixture/node-22"])
  assert.deepEqual(spawnCalls.map((call) => call.command), ["/fixture/node-20", "/fixture/node-22"])
  for (const call of spawnCalls) {
    assert.equal(call.options.shell, false)
    assert.equal(call.options.encoding, "utf8")
    assert.deepEqual(call.args.slice(0, 2), ["--input-type=module", "--eval"])
    assert.match(call.args[2], /process\.versions\.modules/u)
  }
})

test("Node selection falls back diagnostically on no match and never probes after the re-exec guard", async () => {
  const {
    REEXEC_ATTEMPT_ENV,
    selectCompatibleNode,
  } = await loadNodeSelection()
  const currentTarget = {
    id: "darwin-arm64-node-115",
    platform: "darwin",
    arch: "arm64",
    node_abi: "115",
  }
  const shippedTargets = [
    {
      id: "darwin-arm64-node-127",
      platform: "darwin",
      arch: "arm64",
      node_abi: "127",
    },
  ]
  const noMatch = selectCompatibleNode({
    candidates: ["/fixture/node-20"],
    currentTarget,
    env: {},
    probe: () => ({
      ok: true,
      executable: "/fixture/node-20",
      platform: "darwin",
      arch: "arm64",
      node_abi: "115",
      node_version: "v20.19.5",
    }),
    shippedTargets,
  })
  assert.equal(noMatch.mode, "diagnostic")
  assert.equal(noMatch.reason, "no_compatible_node")
  assert.deepEqual(noMatch.paths_checked, ["/fixture/node-20"])

  let probes = 0
  const guarded = selectCompatibleNode({
    candidates: ["/fixture/node-22"],
    currentTarget,
    env: {
      [REEXEC_ATTEMPT_ENV]: "1",
    },
    probe: () => {
      probes += 1
      return {
        ok: true,
        executable: "/fixture/node-22",
        platform: "darwin",
        arch: "arm64",
        node_abi: "127",
        node_version: "v22.23.1",
      }
    },
    shippedTargets,
  })
  assert.equal(guarded.mode, "diagnostic")
  assert.equal(guarded.reason, "guarded_reexec_failure")
  assert.deepEqual(guarded.paths_checked, [])
  assert.equal(probes, 0)
})

test("compatible-Node re-exec forwards stdio once with the guard sentinel", async () => {
  const {
    REEXEC_ATTEMPT_ENV,
    reexecWithCompatibleNode,
  } = await loadNodeSelection()
  const calls = []
  const resultPromise = reexecWithCompatibleNode({
    argv: ["--root", "/desk", "--person", "ari"],
    entrypointPath: "/plugin/mcp/index.js",
    env: {
      HOME: "/Users/unit",
    },
    executable: "/fixture/node-22",
    spawn: (command, args, options) => {
      calls.push({ command, args, options })
      const child = new EventEmitter()
      process.nextTick(() => child.emit("close", 0, null))
      return child
    },
  })
  const result = await resultPromise
  assert.deepEqual(result, {
    code: 0,
    signal: null,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, "/fixture/node-22")
  assert.deepEqual(calls[0].args, [
    "/plugin/mcp/index.js",
    "--root",
    "/desk",
    "--person",
    "ari",
  ])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.stdio, "inherit")
  assert.equal(calls[0].options.env.HOME, "/Users/unit")
  assert.equal(calls[0].options.env[REEXEC_ATTEMPT_ENV], "1")
})
