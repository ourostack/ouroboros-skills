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
// An empty temp dir only means something once the consumer is known to have run.
// A file that dies before it loads reports `# tests 1` / `# fail 1` and creates no
// fixture at all, so residue-free is vacuously true for it. Every case below
// therefore demands positive evidence that real tests executed — at least one
// passing test — and then either an unambiguously clean outcome or, for a consumer
// declared red below, that exact declared cause.

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

// A consumer that is red for a separately owned reason stays in the lifecycle
// witness — lifecycle has to hold on the failure path too — but it is declared by
// its exact cause so this case can never absorb a different or earlier failure.
// The pack failure itself belongs to its own consumer gate, not to this one.
const DECLARED_FAILURES = new Map([
  [
    "__tests__/integration/dependency_activation_flow.test.js",
    {
      owner: "runtime pack pinned behind its lock, owned separately",
      subtest: "cold start restores the committed production snapshot without rebuild or embeddings",
      cause: /stale_snapshot_reconciled/u,
    },
  ],
])

function tapCount(stdout, key) {
  const found = stdout.match(new RegExp(`^# ${key} (\\d+)$`, "mu"))
  return found ? Number(found[1]) : undefined
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

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

      const evidence = result.stderr || result.stdout
      const passed = tapCount(result.stdout, "pass")
      const failed = tapCount(result.stdout, "fail")
      assert.ok(
        passed >= 1,
        `${relPath} never ran a passing test, so an empty temp dir proves nothing: ${evidence}`,
      )

      const declared = DECLARED_FAILURES.get(relPath)
      if (declared) {
        assert.ok(failed >= 1, `${relPath} is declared red (${declared.owner}) but reported no failure`)
        assert.match(
          result.stdout,
          new RegExp(`^not ok \\d+ - ${escapeRegExp(declared.subtest)}$`, "mu"),
          `${relPath} failed somewhere other than its declared subtest: ${evidence}`,
        )
        assert.match(
          result.stdout,
          declared.cause,
          `${relPath} failed for a cause other than the declared one: ${evidence}`,
        )
      } else {
        assert.equal(failed, 0, `${relPath} reported failures: ${evidence}`)
        assert.equal(result.status, 0, evidence)
      }

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
//
// The child writes its success marker inside the same teardown hook, after every
// existence assertion, so a helper that destroys a fixture before returning it can
// never reach the marker. Exit status alone cannot carry this: the intended failure
// and a broken helper both exit 1, and the second would otherwise ride in on the
// first. The intended cause is asserted for the same reason.
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
          `controller.signal.addEventListener("abort", () => process.stdout.write("owner-cause:abort\\n"))`,
          `test("owner case", { signal: controller.signal }, async (t) => {`,
          `  const roots = [await mkTempRoot("desk-owner-case-"), await mkTempRoot("desk-owner-case-")]`,
          `  process.stdout.write("owner-roots:" + JSON.stringify(roots) + "\\n")`,
          `  t.after(() => {`,
          `    for (const root of roots) {`,
          `      assert.equal(existsSync(root), true, "fixtures must outlive per-test teardown")`,
          `    }`,
          `    process.stdout.write("owner-teardown-ok\\n")`,
          `  })`,
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

      const evidence = result.stderr || result.stdout
      assert.match(
        result.stdout,
        /^(?:# )?owner-teardown-ok$/mu,
        `per-test teardown did not observe both fixtures still present: ${evidence}`,
      )
      if (outcome === "failure") {
        assert.match(result.stdout, /expected owner case failure/u, evidence)
      } else {
        assert.match(result.stdout, /^(?:# )?owner-cause:abort$/mu, evidence)
        assert.doesNotMatch(result.stdout, /expected owner case failure/u, evidence)
      }

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
