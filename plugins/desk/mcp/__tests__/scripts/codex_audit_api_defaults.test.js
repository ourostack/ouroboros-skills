import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { PassThrough } from "node:stream"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const audit = require("../../../../../scripts/audit-codex-plugin-cache.cjs")
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url)).replace(/[\\/]$/u, "")

function isolatedHome(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-audit-defaults-"))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  t.mock.method(os, "homedir", () => home)
  return home
}

test("the default audit reads maintained source but never provisions the isolated user home", (t) => {
  const home = isolatedHome(t)
  const report = audit.auditCodexPluginCache()
  assert.equal(report.repo_root, repoRoot)
  assert.equal(report.codex_home, path.join(home, ".codex"))
  assert.equal(report.cache_root, path.join(home, ".codex", "plugins", "cache"))
  assert.equal(report.host_marketplace.path, path.join(home, ".agents", "plugins", "marketplace.json"))
  assert.equal(report.status, "stale")
  assert.equal(report.active_session.status, "not_checked")
  assert.equal(report.host_marketplace.reason, "missing")
  assert.ok(report.plugins.every((plugin) => !plugin.installed_cache_current && plugin.installed_cache_reason === "missing"))
  assert.deepEqual(readdirSync(home), [])
})

test("audit callers retain omitted/nullish options and ignore non-tool values without coercion", (t) => {
  const home = isolatedHome(t)
  const omitted = audit.auditCodexPluginCache({ activeTools: undefined, activeToolsFiles: undefined })
  assert.equal(omitted.active_session.provided, false)
  const normalized = audit.auditCodexPluginCache({
    activeTools: [null, false, 42, undefined, {}, { name: "desk_status" }, "desk:desk_doctor"],
    activeToolsFiles: undefined,
  })
  assert.equal(normalized.active_session.provided, true)
  assert.equal(normalized.active_session.status, "fail")
  assert.deepEqual(normalized.active_session.present.sort(), ["desk_doctor", "desk_status"])
  assert.equal(normalized.active_session.missing.length, normalized.active_session.required.length - 2)
  assert.deepEqual(readdirSync(home), [])
})

test("the exported active-tool audit defaults its required inventory for absent, empty and complete snapshots", () => {
  const absent = audit.auditActiveTools(null)
  assert.equal(absent.provided, false)
  assert.equal(absent.status, "not_checked")
  assert.ok(absent.required.includes("desk_status") && absent.required.includes("desk_doctor"))
  const empty = audit.auditActiveTools(new Set())
  assert.equal(empty.status, "fail")
  assert.deepEqual(empty.missing, absent.required)
  const complete = audit.auditActiveTools(new Set(absent.required))
  assert.equal(complete.status, "pass")
  assert.deepEqual(complete.present, absent.required)
  assert.deepEqual(complete.missing, [])
})

test("the default audit runner uses ambient argv and streams without reaching a real user profile", (t) => {
  const home = isolatedHome(t)
  const output = new PassThrough()
  const errors = new PassThrough()
  let stdout = ""
  let stderr = ""
  output.on("data", (chunk) => { stdout += chunk })
  errors.on("data", (chunk) => { stderr += chunk })
  const out = t.mock.getter(process, "stdout", () => output)
  const err = t.mock.getter(process, "stderr", () => errors)
  const argv = process.argv
  let success
  let failure
  try {
    process.argv = [process.execPath, "audit.cjs"]
    success = audit.run()
    process.argv = [process.execPath, "audit.cjs", "--unknown-audit-option"]
    failure = audit.run()
  } finally {
    process.argv = argv
    out.mock.restore()
    err.mock.restore()
  }
  assert.equal(success, 0)
  assert.equal(JSON.parse(stdout).status, "stale")
  assert.equal(failure, 1)
  assert.equal(stderr, "unknown argument: --unknown-audit-option\n")
  assert.deepEqual(readdirSync(home), [])
})
