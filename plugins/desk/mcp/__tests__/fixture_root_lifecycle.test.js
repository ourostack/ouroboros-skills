import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

// Fixture roots created under the OS temp dir must not outlive the test file that
// created them. Each case below runs one real test file in its own empty temp dir
// and asserts the directory is empty afterwards, so a missing teardown shows up as
// residue on disk rather than as an absent `rm` call in the source.
//
// Two unregistered sentinel directories are planted first — one sharing the file's
// own fixture prefix, one unrelated. Both must survive, which is what separates
// exact-root ownership from a prefix sweep.
//
// Exit status is deliberately not asserted. This witness covers fixture lifecycle
// only; whether a suite passes is that suite's own concern, and one file below is
// currently red for a separately owned reason (a runtime pack pinned behind its
// lock). Lifecycle must hold on the failure path too, which is exactly what that
// file demonstrates here.

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const FIXTURE_OWNERS = [
  ["__tests__/indexer/index.test.js", "desk-idx-"],
  ["__tests__/indexer/vector_rebuild.test.js", "desk-vector-rebuild-"],
  ["__tests__/indexer/exclusions.test.js", "desk-exclusions-"],
  ["__tests__/indexer/discover.test.js", "desk-discover-"],
  ["__tests__/indexer/person_discover.test.js", "desk-person-discover-"],
  ["__tests__/indexer/shared_landscape_discover.test.js", "desk-shared-discover-"],
  ["__tests__/tools/thread.test.js", "desk-thread-test-"],
  ["__tests__/tools/person_write_prefix.test.js", "desk-write-outside-"],
  ["__tests__/db/init.test.js", "desk-init-"],
  ["__tests__/util/path_containment.test.js", "desk-containment-"],
  ["__tests__/artifacts/redaction_cleanup.test.js", "desk-redaction-cleanup-plugin-"],
  ["__tests__/artifacts/publication_policy.test.js", "desk-publication-policy-desk-"],
  ["__tests__/integration/dependency_activation_flow.test.js", "desk-dependency-flow-snapshot-"],
  ["__tests__/indexer/vector_packs.test.js", "desk-vector-pack-"],
  ["__tests__/snapshots/manifest.test.js", "desk-snapshot-manifest-"],
  ["__tests__/snapshots/restore.test.js", "desk-snapshot-restore-plugin-"],
  ["__tests__/snapshots/fallback_reconcile.test.js", "desk-snapshot-fallback-desk-"],
]

function runInPrivateTemp(args, sandbox, timeout) {
  const env = { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, args, {
    cwd: mcpRoot,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  })
}

function plantSentinel(sandbox, prefix) {
  const dir = mkdtempSync(path.join(sandbox, prefix))
  writeFileSync(path.join(dir, "keep.txt"), "sentinel", "utf8")
  return dir
}

for (const [relPath, prefix] of FIXTURE_OWNERS) {
  test(`${relPath} leaves no fixture residue in its temp dir`, () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), "desk-fixture-lifecycle-"))
    try {
      const sameKind = plantSentinel(sandbox, prefix)
      const unrelated = plantSentinel(sandbox, "unrelated-keep-")
      const result = runInPrivateTemp(["--test", relPath], sandbox, 300000)

      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.signal, null, result.stderr)
      assert.match(result.stdout, /^# tests \d+/mu, result.stderr || result.stdout)

      const kept = new Set([sameKind, unrelated].map((dir) => path.basename(dir)))
      const residue = readdirSync(sandbox).filter((entry) => !kept.has(entry))
      assert.deepEqual(residue, [], `fixture roots survived the test file: ${residue.join(", ")}`)

      for (const sentinel of [sameKind, unrelated]) {
        assert.equal(readFileSync(path.join(sentinel, "keep.txt"), "utf8"), "sentinel")
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
}

// The shared owner keeps fixtures readable for the duration of the test file, then
// removes exactly what it handed out — on the failure and abort paths as well.
for (const outcome of ["failure", "abort"]) {
  test(`mkTempRoot removes its own roots after ${outcome} and keeps them until teardown`, () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), "desk-fixture-lifecycle-"))
    try {
      const sameKind = plantSentinel(sandbox, "desk-owner-case-")
      const script = path.join(sandbox, "owner-case.mjs")
      writeFileSync(
        script,
        [
          `import { test } from "node:test"`,
          `import { strict as assert } from "node:assert"`,
          `import { existsSync } from "node:fs"`,
          `import { mkTempRoot } from ${JSON.stringify(new URL("_temp_roots.js", import.meta.url).href)}`,
          `const controller = new AbortController()`,
          `test("owner case", { signal: controller.signal }, async (t) => {`,
          `  const roots = [await mkTempRoot("desk-owner-case-"), await mkTempRoot("desk-owner-case-")]`,
          `  process.stdout.write("owner-roots:" + JSON.stringify(roots) + "\\n")`,
          `  t.after(() => roots.forEach((root) => assert.equal(existsSync(root), true, "fixtures must outlive per-test teardown")))`,
          `  if (${JSON.stringify(outcome)} === "failure") throw new Error("expected owner case failure")`,
          `  controller.abort()`,
          `  await new Promise(() => {})`,
          `})`,
          ``,
        ].join("\n"),
        "utf8",
      )

      const result = runInPrivateTemp(["--test", script], sandbox, 30000)
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.signal, null, result.stderr)
      assert.equal(result.status, 1, result.stderr || result.stdout)

      const reported = result.stdout.match(/owner-roots:(\[[^\n]+\])/u)
      assert.ok(reported, result.stderr || result.stdout)
      const roots = JSON.parse(reported[1])
      assert.equal(roots.length, 2)
      for (const root of roots) {
        assert.equal(existsSync(root), false, `fixture survived a completed ${outcome}: ${root}`)
      }
      assert.equal(readFileSync(path.join(sameKind, "keep.txt"), "utf8"), "sentinel")
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
}
