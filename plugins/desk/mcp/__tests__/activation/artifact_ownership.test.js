import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const fixturesRoot = path.join(mcpRoot, "__tests__", "fixtures", "activation", "ownership")
const ledgerPath = ".codex/desk-activation-ledger.json"

async function loadArtifactLedger() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "activation", "artifact-ledger.js")))
}

function fixture(fileName) {
  return readFileSync(path.join(fixturesRoot, fileName), "utf8")
}

function withTempHost(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "desk-activation-ownership-"))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function readHostFile(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8")
}

function writeHostFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf8")
}

function sha256(content) {
  return `sha256-${createHash("sha256").update(content).digest("hex")}`
}

function defaultArtifacts() {
  return [
    {
      owner: "desk-activation",
      kind: "owned-host-config",
      path: ".codex/config.toml",
      content: fixture("generated-config-v1.toml"),
    },
    {
      owner: "desk-activation",
      kind: "owned-codex-instructions",
      path: "AGENTS.md",
      content: fixture("generated-instructions-v1.md"),
    },
  ]
}

function artifactRequest(root, overrides = {}) {
  return {
    hostRoot: root,
    ledgerPath,
    activation: {
      id: "desk",
      version: "1.7.3",
      host: "codex",
      mode: "global-personal",
      owner: "desk-activation",
      generatedBy: "codex-adapter",
      ...overrides.activation,
    },
    neverDelete: ["desk-root-data"],
    now: "2026-06-14T18:30:00.000Z",
    artifacts: overrides.artifacts ?? defaultArtifacts(),
  }
}

test("activation artifact ownership writes generated files and a ledger", async () => {
  const { applyActivationArtifacts, readActivationLedger } = await loadArtifactLedger()

  withTempHost((root) => {
    const result = applyActivationArtifacts(artifactRequest(root))
    const ledger = readActivationLedger({ hostRoot: root, ledgerPath })

    assert.equal(readHostFile(root, ".codex/config.toml"), fixture("generated-config-v1.toml"))
    assert.equal(readHostFile(root, "AGENTS.md"), fixture("generated-instructions-v1.md"))
    assert.deepEqual(result.ledger, ledger)
    assert.equal(ledger.schema_version, 1)
    assert.equal(ledger.owner, "desk-activation")
    assert.equal(ledger.activation.id, "desk")
    assert.equal(ledger.activation.version, "1.7.3")
    assert.equal(ledger.activation.host, "codex")
    assert.equal(ledger.activation.mode, "global-personal")
    assert.deepEqual(ledger.never_delete, ["desk-root-data"])
    assert.deepEqual(
      ledger.artifacts.map((artifact) => ({
        owner: artifact.owner,
        kind: artifact.kind,
        path: artifact.path,
        content_sha256: artifact.content_sha256,
        updated_at: artifact.updated_at,
      })),
      [
        {
          owner: "desk-activation",
          kind: "owned-host-config",
          path: ".codex/config.toml",
          content_sha256: sha256(fixture("generated-config-v1.toml")),
          updated_at: "2026-06-14T18:30:00.000Z",
        },
        {
          owner: "desk-activation",
          kind: "owned-codex-instructions",
          path: "AGENTS.md",
          content_sha256: sha256(fixture("generated-instructions-v1.md")),
          updated_at: "2026-06-14T18:30:00.000Z",
        },
      ],
    )
  })
})

test("activation artifact ownership replaces generated artifacts during upgrades", async () => {
  const { applyActivationArtifacts, readActivationLedger } = await loadArtifactLedger()

  withTempHost((root) => {
    applyActivationArtifacts(artifactRequest(root))
    applyActivationArtifacts(artifactRequest(root, {
      activation: { version: "1.7.4" },
      artifacts: [
        {
          owner: "desk-activation",
          kind: "owned-host-config",
          path: ".codex/config.toml",
          content: fixture("generated-config-v2.toml"),
        },
        {
          owner: "desk-activation",
          kind: "owned-codex-instructions",
          path: "AGENTS.md",
          content: fixture("generated-instructions-v2.md"),
        },
      ],
    }))

    const ledger = readActivationLedger({ hostRoot: root, ledgerPath })
    assert.equal(readHostFile(root, ".codex/config.toml"), fixture("generated-config-v2.toml"))
    assert.equal(readHostFile(root, "AGENTS.md"), fixture("generated-instructions-v2.md"))
    assert.equal(readHostFile(root, ".codex/config.toml").match(/# BEGIN desk activation/g).length, 1)
    assert.equal(ledger.activation.version, "1.7.4")
    assert.equal(ledger.artifacts.filter((artifact) => artifact.path === ".codex/config.toml").length, 1)
    assert.equal(ledger.artifacts.filter((artifact) => artifact.path === "AGENTS.md").length, 1)
    assert.equal(
      ledger.artifacts.find((artifact) => artifact.path === ".codex/config.toml").content_sha256,
      sha256(fixture("generated-config-v2.toml")),
    )
    assert.equal(
      ledger.artifacts.find((artifact) => artifact.path === "AGENTS.md").content_sha256,
      sha256(fixture("generated-instructions-v2.md")),
    )
  })
})

test("deactivation removes owned activation blocks while preserving user-authored config", async () => {
  const { applyActivationArtifacts, deactivateActivationArtifacts } = await loadArtifactLedger()

  withTempHost((root) => {
    applyActivationArtifacts(artifactRequest(root))
    const result = deactivateActivationArtifacts({
      hostRoot: root,
      ledgerPath,
      neverDelete: ["desk-root-data"],
      now: "2026-06-14T18:45:00.000Z",
    })

    assert.equal(readHostFile(root, ".codex/config.toml"), fixture("deactivated-config.toml"))
    assert.equal(readHostFile(root, "AGENTS.md"), fixture("deactivated-instructions.md"))
    assert.equal(existsSync(path.join(root, ledgerPath)), false)
    assert.deepEqual(
      result.removed.map((artifact) => ({ path: artifact.path, kind: artifact.kind })),
      [
        { path: ".codex/config.toml", kind: "owned-host-config" },
        { path: "AGENTS.md", kind: "owned-codex-instructions" },
        { path: ledgerPath, kind: "activation-ledger" },
      ],
    )
  })
})

test("deactivation uses ledger never-delete boundaries for desk data", async () => {
  const {
    applyActivationArtifacts,
    deactivateActivationArtifacts,
    readActivationLedger,
  } = await loadArtifactLedger()

  for (const callerNeverDelete of [undefined, []]) {
    withTempHost((root) => {
      applyActivationArtifacts(artifactRequest(root))
      const deskDataPath = ".desk/.state/desk-index.sqlite"
      writeHostFile(root, deskDataPath, "pretend sqlite bytes")
      const ledger = readActivationLedger({ hostRoot: root, ledgerPath })
      ledger.artifacts.push({
        owner: "desk-activation",
        kind: "desk-root-data",
        path: deskDataPath,
        content_sha256: sha256("pretend sqlite bytes"),
        updated_at: "2026-06-14T18:30:00.000Z",
      })
      writeHostFile(root, ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)

      const request = { hostRoot: root, ledgerPath }
      if (callerNeverDelete !== undefined) {
        request.neverDelete = callerNeverDelete
      }
      const result = deactivateActivationArtifacts(request)

      assert.equal(readHostFile(root, deskDataPath), "pretend sqlite bytes")
      assert.deepEqual(result.skipped, [
        {
          path: deskDataPath,
          kind: "desk-root-data",
          reason: "never-delete",
        },
      ])
      assert.equal(existsSync(path.join(root, ledgerPath)), false)
    })
  }
})

test("deactivation reports a missing ledger as an idempotent no-op", async () => {
  const { deactivateActivationArtifacts, readActivationLedger } = await loadArtifactLedger()

  withTempHost((root) => {
    assert.throws(
      () => readActivationLedger({ hostRoot: root, ledgerPath }),
      /activation ledger missing: \.codex\/desk-activation-ledger\.json/u,
    )

    const result = deactivateActivationArtifacts({ hostRoot: root, ledgerPath })

    assert.deepEqual(result, {
      removed: [],
      skipped: [
        {
          path: ledgerPath,
          kind: "activation-ledger",
          reason: "missing-ledger",
        },
      ],
    })
  })
})

test("deactivation rejects corrupt ownership ledgers with an actionable diagnostic", async () => {
  const { deactivateActivationArtifacts } = await loadArtifactLedger()

  withTempHost((root) => {
    writeHostFile(root, ledgerPath, "{ not json")

    assert.throws(
      () => deactivateActivationArtifacts({ hostRoot: root, ledgerPath }),
      /activation ledger corrupt: \.codex\/desk-activation-ledger\.json/u,
    )
    assert.equal(readHostFile(root, ledgerPath), "{ not json")
  })
})

test("deactivation preserves user-edited generated artifacts and keeps the ledger", async () => {
  const { applyActivationArtifacts, deactivateActivationArtifacts } = await loadArtifactLedger()

  withTempHost((root) => {
    applyActivationArtifacts(artifactRequest(root))
    const editedConfig = `${fixture("generated-config-v1.toml")}
# user edit outside the generated block
`
    writeHostFile(root, ".codex/config.toml", editedConfig)

    const result = deactivateActivationArtifacts({ hostRoot: root, ledgerPath })

    assert.deepEqual(result, {
      removed: [],
      skipped: [
        {
          path: ".codex/config.toml",
          kind: "owned-host-config",
          reason: "content-changed",
        },
      ],
    })
    assert.equal(readHostFile(root, ".codex/config.toml"), editedConfig)
    assert.equal(readHostFile(root, "AGENTS.md"), fixture("generated-instructions-v1.md"))
    assert.equal(existsSync(path.join(root, ledgerPath)), true)
  })
})

test("deactivation is idempotent after a successful deactivate", async () => {
  const { applyActivationArtifacts, deactivateActivationArtifacts } = await loadArtifactLedger()

  withTempHost((root) => {
    applyActivationArtifacts(artifactRequest(root))
    deactivateActivationArtifacts({ hostRoot: root, ledgerPath })

    const repeated = deactivateActivationArtifacts({ hostRoot: root, ledgerPath })

    assert.deepEqual(repeated, {
      removed: [],
      skipped: [
        {
          path: ledgerPath,
          kind: "activation-ledger",
          reason: "missing-ledger",
        },
      ],
    })
  })
})

test("activation rolls back partial writes when an artifact cannot be written", async () => {
  const { applyActivationArtifacts } = await loadArtifactLedger()

  withTempHost((root) => {
    const originalConfig = "# existing config\n"
    writeHostFile(root, ".codex/config.toml", originalConfig)
    mkdirSync(path.join(root, "AGENTS.md"))

    assert.throws(
      () => applyActivationArtifacts(artifactRequest(root)),
      /activation apply failed; rolled back generated artifacts/u,
    )

    assert.equal(readHostFile(root, ".codex/config.toml"), originalConfig)
    assert.equal(existsSync(path.join(root, ledgerPath)), false)
    assert.equal(existsSync(path.join(root, "AGENTS.md")), true)
  })
})
