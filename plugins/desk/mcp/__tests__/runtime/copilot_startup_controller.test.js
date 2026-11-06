import { strict as assert } from "node:assert"
import { createRequire } from "node:module"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const require = createRequire(import.meta.url)
const controllerPath = path.join(repoRoot, "scripts", "desk-copilot-startup-controller.cjs")

const CANONICAL_REPOSITORY = "ourostack/ouroboros-skills"
const STATUS_CONTEXT = "Desk Copilot startup"
const RUN_URL = "https://github.com/ourostack/ouroboros-skills/actions/runs/314159"
const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const SHA_C = "c".repeat(40)

function loadControllerModule() {
  return require(controllerPath)
}

function pullRequestEvent({
  baseRepository = CANONICAL_REPOSITORY,
  baseSha = SHA_B,
  changedFiles = 1,
  headRepository = CANONICAL_REPOSITORY,
  headSha = SHA_A,
  repository = CANONICAL_REPOSITORY,
} = {}) {
  return {
    repository: { full_name: repository },
    pull_request: {
      base: {
        repo: { full_name: baseRepository },
        sha: baseSha,
      },
      changed_files: changedFiles,
      head: {
        repo: headRepository === null ? null : { full_name: headRepository },
        sha: headSha,
      },
      number: 17,
    },
  }
}

function pushEvent({
  after = SHA_C,
  ref = "refs/heads/main",
  repository = CANONICAL_REPOSITORY,
} = {}) {
  return {
    after,
    ref,
    repository: { full_name: repository },
  }
}

function changedFile(filename, updates = {}) {
  return {
    filename,
    status: "modified",
    ...updates,
  }
}

function page(data, nextPage = null) {
  return {
    data,
    headers: nextPage === null
      ? {}
      : {
          link: `<https://api.github.com/repos/${CANONICAL_REPOSITORY}/pulls/17/files?per_page=100&page=${nextPage}>; rel="next"`,
        },
  }
}

function paginatedFiles(files) {
  const pages = []
  for (let index = 0; index < files.length; index += 100) {
    const pageNumber = pages.length + 1
    const nextPage = index + 100 < files.length ? pageNumber + 1 : null
    pages.push(page(files.slice(index, index + 100), nextPage))
  }
  return pages
}

function fakeGitHub({
  currentPullRequest = {
    changed_files: 1,
    head: { sha: SHA_A },
  },
  filePages = [page([changedFile("plugins/desk/README.md")])],
  reject = null,
} = {}) {
  const calls = []
  const requestJson = async (request) => {
    calls.push(structuredClone(request))
    if (reject && reject(request, calls.length)) {
      throw new Error("fixture GitHub API failure")
    }
    if (request.method === "POST" && request.path.startsWith(`/repos/${CANONICAL_REPOSITORY}/statuses/`)) {
      return { data: { id: calls.length }, headers: {} }
    }
    if (request.method === "GET" && request.path === `/repos/${CANONICAL_REPOSITORY}/pulls/17`) {
      return { data: currentPullRequest, headers: {} }
    }
    if (request.method === "GET" && request.path.startsWith(`/repos/${CANONICAL_REPOSITORY}/pulls/17/files?`)) {
      const pageNumber = Number(new URL(`https://api.github.test${request.path}`).searchParams.get("page"))
      return filePages[pageNumber - 1] ?? page([], null)
    }
    throw new Error(`unexpected fixture request: ${request.method} ${request.path}`)
  }
  return { calls, requestJson }
}

async function classifyPullRequest(controller, {
  api = fakeGitHub(),
  event = pullRequestEvent(),
} = {}) {
  const result = await controller.classifyEvent({
    event,
    eventName: "pull_request_target",
    repository: CANONICAL_REPOSITORY,
    requestJson: api.requestJson,
    targetUrl: RUN_URL,
  })
  return { api, result }
}

test("Unit 2a exports the controller policy, finalizer, and injectable CLI seams", () => {
  const controller = loadControllerModule()

  assert.equal(controller.CANONICAL_REPOSITORY, CANONICAL_REPOSITORY)
  assert.equal(controller.STATUS_CONTEXT, STATUS_CONTEXT)
  assert.equal(typeof controller.buildActionsRunTargetUrl, "function")
  assert.equal(typeof controller.classifyEvent, "function")
  assert.equal(typeof controller.finalizeStatus, "function")
  assert.equal(typeof controller.isStartupSensitivePath, "function")
  assert.equal(typeof controller.mapFinalStatus, "function")
  assert.equal(typeof controller.runCli, "function")
  assert.equal(typeof controller.startCli, "function")
})

test("Unit 2a startCli executes only as main and preserves success and failure outcomes", async () => {
  const controller = loadControllerModule()
  const argv = ["classify"]
  const runCalls = []
  const exitCodes = []
  const stderr = []
  const run = async (receivedArgv) => {
    runCalls.push(receivedArgv)
    return 0
  }

  assert.equal(await controller.startCli({
    argv,
    isMain: false,
    run,
    setExitCode: (code) => exitCodes.push(code),
  }), null)
  assert.deepEqual(runCalls, [])
  assert.deepEqual(exitCodes, [])

  assert.equal(await controller.startCli({
    argv,
    isMain: true,
    run,
    setExitCode: (code) => exitCodes.push(code),
  }), 0)
  assert.deepEqual(runCalls, [argv])
  assert.deepEqual(exitCodes, [0])

  assert.equal(await controller.startCli({
    argv: ["finalize"],
    isMain: true,
    async run() {
      throw new Error("fixture controller failure")
    },
    setExitCode: (code) => exitCodes.push(code),
    writeStderr: (text) => stderr.push(text),
  }), 1)
  assert.deepEqual(exitCodes, [0, 1])
  assert.deepEqual(stderr, ["desk-copilot-startup-controller: fixture controller failure\n"])
})

test("Unit 2a constructs the exact Actions run target URL", () => {
  const controller = loadControllerModule()

  assert.equal(
    controller.buildActionsRunTargetUrl({
      repository: CANONICAL_REPOSITORY,
      runId: "314159",
      serverUrl: "https://github.com",
    }),
    RUN_URL,
  )
})

test("Unit 2a classifies every frozen startup-sensitive path and excludes Work Suite", () => {
  const controller = loadControllerModule()
  const sensitivePaths = [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "plugins/desk/README.md",
    "plugins/desk/mcp/index.js",
    "scripts/desk-copilot-startup-smoke.cjs",
    "scripts/desk-copilot-startup-controller.cjs",
    ".github/workflows/desk-copilot-startup.yml",
    ".github/workflows/validate-skills.yml",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnpmfile.cjs",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    ".node-version",
    ".nvmrc",
    ".tool-versions",
  ]
  const unrelatedPaths = [
    "plugins/work-suite/skills/work-doer/SKILL.md",
    ".github/workflows/desk-mcp-tests.yml",
    ".github/workflows/unrelated.yml",
    "docs/package.json",
    "scripts/desk-copilot-startup-smoke.md",
    ".claude-plugin-adjacent/plugin.json",
    "README.md",
  ]

  for (const filename of sensitivePaths) {
    assert.equal(controller.isStartupSensitivePath(filename), true, filename)
  }
  for (const filename of unrelatedPaths) {
    assert.equal(controller.isStartupSensitivePath(filename), false, filename)
  }
})

test("Unit 2a posts pending before reading a trusted sensitive pull request and requests smoke", async () => {
  const controller = loadControllerModule()
  const { api, result } = await classifyPullRequest(controller)

  assert.deepEqual(result, {
    candidate_sha: SHA_A,
    controller_sha: SHA_B,
    disposition: "smoke",
    reason: "startup_sensitive_change",
  })
  assert.deepEqual(api.calls.map(({ method, path: requestPath }) => [method, requestPath]), [
    ["POST", `/repos/${CANONICAL_REPOSITORY}/statuses/${SHA_A}`],
    ["GET", `/repos/${CANONICAL_REPOSITORY}/pulls/17`],
    ["GET", `/repos/${CANONICAL_REPOSITORY}/pulls/17/files?per_page=100&page=1`],
  ])
  assert.deepEqual(api.calls[0].body, {
    context: STATUS_CONTEXT,
    description: "Desk Copilot startup is evaluating this commit",
    state: "pending",
    target_url: RUN_URL,
  })
})

test("Unit 2a skips a provably unrelated pull request without a model disposition", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub({
    filePages: [page([changedFile("README.md")])],
  })
  const { result } = await classifyPullRequest(controller, { api })

  assert.deepEqual(result, {
    candidate_sha: SHA_A,
    controller_sha: SHA_B,
    disposition: "skip",
    reason: "unrelated_change",
  })
})

test("Unit 2a classifies rename-only startup-sensitive changes from previous_filename", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub({
    filePages: [page([
      changedFile("docs/retired-smoke.md", {
        previous_filename: "scripts/desk-copilot-startup-smoke.cjs",
        status: "renamed",
      }),
    ])],
  })
  const { result } = await classifyPullRequest(controller, { api })

  assert.equal(result.disposition, "smoke")
  assert.equal(result.reason, "startup_sensitive_change")
})

test("Unit 2a treats hostile and Unicode filenames as structured data rather than commands", async () => {
  const controller = loadControllerModule()
  const filenames = [
    "docs/$(touch should-not-run).md",
    "docs/name\nwith-newline.md",
    "docs/雪 and spaces.md",
    "docs/quote'\"`$HOME.md",
  ]
  const api = fakeGitHub({
    currentPullRequest: {
      changed_files: filenames.length,
      head: { sha: SHA_A },
    },
    filePages: [page(filenames.map((filename) => changedFile(filename)))],
  })
  const { result } = await classifyPullRequest(controller, { api })

  assert.equal(result.disposition, "skip")
  assert.equal(result.reason, "unrelated_change")
  assert.deepEqual(
    api.calls.slice(1).map(({ path: requestPath }) => requestPath),
    [
      `/repos/${CANONICAL_REPOSITORY}/pulls/17`,
      `/repos/${CANONICAL_REPOSITORY}/pulls/17/files?per_page=100&page=1`,
    ],
  )
})

test("Unit 2a consumes every changed-file page and requires exact fetched count", async () => {
  const controller = loadControllerModule()
  const files = Array.from({ length: 101 }, (_, index) => changedFile(`docs/file-${index}.md`))
  const api = fakeGitHub({
    currentPullRequest: {
      changed_files: files.length,
      head: { sha: SHA_A },
    },
    filePages: paginatedFiles(files),
  })
  const { result } = await classifyPullRequest(controller, { api })

  assert.equal(result.disposition, "skip")
  assert.deepEqual(
    api.calls.filter(({ path: requestPath }) => requestPath.includes("/files?")).map(({ path: requestPath }) => requestPath),
    [
      `/repos/${CANONICAL_REPOSITORY}/pulls/17/files?per_page=100&page=1`,
      `/repos/${CANONICAL_REPOSITORY}/pulls/17/files?per_page=100&page=2`,
    ],
  )
})

test("Unit 2a accepts a complete 2,999-file pull request below the API boundary", async () => {
  const controller = loadControllerModule()
  const files = Array.from({ length: 2_999 }, (_, index) => changedFile(`docs/file-${index}.md`))
  const api = fakeGitHub({
    currentPullRequest: {
      changed_files: files.length,
      head: { sha: SHA_A },
    },
    filePages: paginatedFiles(files),
  })
  const { result } = await classifyPullRequest(controller, { api })

  assert.equal(result.disposition, "skip")
  assert.equal(result.reason, "unrelated_change")
  assert.equal(api.calls.filter(({ path: requestPath }) => requestPath.includes("/files?")).length, 30)
})

test("Unit 2a fails closed on head drift, count mismatch, pagination, cap, and malformed records", async (t) => {
  const controller = loadControllerModule()
  const cases = [
    {
      name: "head drift",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 1,
          head: { sha: SHA_C },
        },
      }),
      reason: "pull_request_head_changed",
    },
    {
      name: "count mismatch",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 2,
          head: { sha: SHA_A },
        },
        filePages: [page([changedFile("README.md")])],
      }),
      reason: "changed_file_count_mismatch",
    },
    {
      name: "unconsumed pagination",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 1,
          head: { sha: SHA_A },
        },
        filePages: [page([changedFile("README.md")], 2)],
      }),
      reason: "changed_file_pagination_incomplete",
    },
    {
      name: "API cap",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 3_000,
          head: { sha: SHA_A },
        },
        filePages: [],
      }),
      reason: "changed_file_limit_reached",
    },
    {
      name: "above API cap",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 3_001,
          head: { sha: SHA_A },
        },
        filePages: [],
      }),
      reason: "changed_file_limit_reached",
    },
    {
      name: "malformed record",
      api: fakeGitHub({
        filePages: [page([{ status: "modified" }])],
      }),
      reason: "changed_file_record_invalid",
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async () => {
      const { result } = await classifyPullRequest(controller, { api: fixtureCase.api })
      assert.equal(result.disposition, "smoke")
      assert.equal(result.reason, fixtureCase.reason)
    })
  }
})

test("Unit 2a refuses untrusted sensitive or unknown changes and still skips proven unrelated changes", async (t) => {
  const controller = loadControllerModule()
  const forkEvent = pullRequestEvent({
    headRepository: "fork-owner/ouroboros-skills",
  })
  const cases = [
    {
      disposition: "refuse",
      name: "fork sensitive",
      api: fakeGitHub(),
      reason: "startup_sensitive_change",
    },
    {
      disposition: "refuse",
      name: "fork unknown",
      api: fakeGitHub({
        currentPullRequest: {
          changed_files: 1,
          head: { sha: SHA_C },
        },
      }),
      reason: "pull_request_head_changed",
    },
    {
      disposition: "skip",
      name: "fork unrelated",
      api: fakeGitHub({
        filePages: [page([changedFile("README.md")])],
      }),
      reason: "unrelated_change",
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async () => {
      const { result } = await classifyPullRequest(controller, {
        api: fixtureCase.api,
        event: forkEvent,
      })
      assert.equal(result.disposition, fixtureCase.disposition)
      assert.equal(result.reason, fixtureCase.reason)
    })
  }
})

test("Unit 2a treats an absent head repository as untrusted", async () => {
  const controller = loadControllerModule()
  const { result } = await classifyPullRequest(controller, {
    event: pullRequestEvent({ headRepository: null }),
  })

  assert.equal(result.disposition, "refuse")
  assert.equal(result.reason, "startup_sensitive_change")
})

test("Unit 2a rejects noncanonical event or base repository identities before API access", async (t) => {
  const controller = loadControllerModule()
  const cases = [
    pullRequestEvent({ repository: "lookalike/ouroboros-skills" }),
    pullRequestEvent({ baseRepository: "lookalike/ouroboros-skills" }),
  ]

  for (const event of cases) {
    await t.test(event.repository.full_name, async () => {
      const api = fakeGitHub()
      await assert.rejects(
        classifyPullRequest(controller, { api, event }),
        /canonical repository identity/,
      )
      assert.deepEqual(api.calls, [])
    })
  }
})

test("Unit 2a propagates GitHub API failure after posting pending", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub({
    reject: (_request, callNumber) => callNumber === 2,
  })

  await assert.rejects(
    classifyPullRequest(controller, { api }),
    /fixture GitHub API failure/,
  )
  assert.equal(api.calls.length, 2)
  assert.equal(api.calls[0].body.state, "pending")
})

test("Unit 2a selects the pushed SHA and requests smoke without pull-request file classification", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub()
  const result = await controller.classifyEvent({
    event: pushEvent(),
    eventName: "push",
    repository: CANONICAL_REPOSITORY,
    requestJson: api.requestJson,
    targetUrl: RUN_URL,
  })

  assert.deepEqual(result, {
    candidate_sha: SHA_C,
    controller_sha: SHA_C,
    disposition: "smoke",
    reason: "push_to_main",
  })
  assert.deepEqual(api.calls.map(({ method, path: requestPath }) => [method, requestPath]), [
    ["POST", `/repos/${CANONICAL_REPOSITORY}/statuses/${SHA_C}`],
  ])
  assert.equal(api.calls[0].body.state, "pending")
})

test("Unit 2a rejects unsupported events and non-main pushes", async (t) => {
  const controller = loadControllerModule()
  const cases = [
    {
      event: pushEvent(),
      eventName: "workflow_dispatch",
      message: /unsupported event/,
    },
    {
      event: pushEvent({ ref: "refs/heads/feature" }),
      eventName: "push",
      message: /main branch/,
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.eventName, async () => {
      const api = fakeGitHub()
      await assert.rejects(
        controller.classifyEvent({
          event: fixtureCase.event,
          eventName: fixtureCase.eventName,
          repository: CANONICAL_REPOSITORY,
          requestJson: api.requestJson,
          targetUrl: RUN_URL,
        }),
        fixtureCase.message,
      )
      assert.deepEqual(api.calls, [])
    })
  }
})

test("Unit 2a maps every successful terminal disposition exactly", () => {
  const controller = loadControllerModule()
  const cases = [
    {
      controlledOutcome: "",
      disposition: "skip",
      expected: {
        description: "Desk Copilot startup was not required",
        state: "success",
      },
      smokeResult: "skipped",
    },
    {
      controlledOutcome: "",
      disposition: "refuse",
      expected: {
        description: "Startup-sensitive fork changes are not trusted",
        state: "failure",
      },
      smokeResult: "skipped",
    },
    {
      controlledOutcome: "success",
      disposition: "smoke",
      expected: {
        description: "Desk Copilot startup passed",
        state: "success",
      },
      smokeResult: "success",
    },
    {
      controlledOutcome: "failure",
      disposition: "smoke",
      expected: {
        description: "Desk Copilot startup failed",
        state: "failure",
      },
      smokeResult: "failure",
    },
  ]

  for (const fixtureCase of cases) {
    assert.deepEqual(controller.mapFinalStatus({
      classifierResult: "success",
      ...fixtureCase,
    }), fixtureCase.expected)
  }
})

test("Unit 2a maps classifier, disposition, smoke, and marker inconsistencies to error", () => {
  const controller = loadControllerModule()
  const cases = [
    { classifierResult: "failure", controlledOutcome: "", disposition: "skip", smokeResult: "skipped" },
    { classifierResult: "cancelled", controlledOutcome: "", disposition: "skip", smokeResult: "skipped" },
    { classifierResult: "skipped", controlledOutcome: "", disposition: "skip", smokeResult: "skipped" },
    { classifierResult: "success", controlledOutcome: "", disposition: "unexpected", smokeResult: "skipped" },
    { classifierResult: "success", controlledOutcome: "", disposition: "smoke", smokeResult: "success" },
    { classifierResult: "success", controlledOutcome: "success", disposition: "smoke", smokeResult: "failure" },
    { classifierResult: "success", controlledOutcome: "failure", disposition: "smoke", smokeResult: "success" },
    { classifierResult: "success", controlledOutcome: "failure", disposition: "smoke", smokeResult: "cancelled" },
    { classifierResult: "success", controlledOutcome: "failure", disposition: "smoke", smokeResult: "skipped" },
    { classifierResult: "success", controlledOutcome: "success", disposition: "skip", smokeResult: "skipped" },
    { classifierResult: "success", controlledOutcome: "", disposition: "refuse", smokeResult: "success" },
  ]

  for (const fixtureCase of cases) {
    assert.deepEqual(controller.mapFinalStatus(fixtureCase), {
      description: "Desk Copilot startup could not complete",
      state: "error",
    })
  }
})

test("Unit 2a finalization posts the exact terminal context on the candidate SHA", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub()
  const result = await controller.finalizeStatus({
    candidateSha: SHA_A,
    classifierResult: "success",
    controlledOutcome: "success",
    disposition: "smoke",
    repository: CANONICAL_REPOSITORY,
    requestJson: api.requestJson,
    smokeResult: "success",
    targetUrl: RUN_URL,
  })

  assert.deepEqual(result, {
    description: "Desk Copilot startup passed",
    state: "success",
  })
  assert.deepEqual(api.calls, [{
    body: {
      context: STATUS_CONTEXT,
      description: "Desk Copilot startup passed",
      state: "success",
      target_url: RUN_URL,
    },
    method: "POST",
    path: `/repos/${CANONICAL_REPOSITORY}/statuses/${SHA_A}`,
  }])
})

test("Unit 2a finalization propagates status publication failure", async () => {
  const controller = loadControllerModule()
  const api = fakeGitHub({
    reject: () => true,
  })

  await assert.rejects(
    controller.finalizeStatus({
      candidateSha: SHA_A,
      classifierResult: "success",
      controlledOutcome: "",
      disposition: "skip",
      repository: CANONICAL_REPOSITORY,
      requestJson: api.requestJson,
      smokeResult: "skipped",
      targetUrl: RUN_URL,
    }),
    /fixture GitHub API failure/,
  )
})
