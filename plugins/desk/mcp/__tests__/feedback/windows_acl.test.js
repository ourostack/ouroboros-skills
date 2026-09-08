// Windows ACL primitive for the private feedback store.
//
// Two layers of proof live here:
//
//  1. Adapter proof (runs everywhere). The helper's argument handling, its
//     command construction, and its refusal to accept a success-shaped result
//     that was not actually verified. Some of these drive a real child process
//     through a stand-in provider executable, so the spawn/stdin/stdout/exit
//     path is genuinely exercised on POSIX hosts rather than stubbed.
//  2. Native proof (Windows only, skipped elsewhere). Real NTFS ACLs on real
//     directories and files. Nothing below claims a stand-in provider proves
//     anything about NTFS — only the win32 test does that.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

import {
  assertWindowsAclAvailable,
  protectWindowsPaths,
} from "../../src/feedback/windows-acl.js"

const PROVIDER_SEGMENTS = ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"]
const isWindows = process.platform === "win32"
const posixProvider = { skip: isWindows ? "stand-in executable uses a POSIX shebang; native Windows transport is tested separately" : false }

async function mkBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-winacl-"))
}

/**
 * A stand-in provider executable at the exact location the helper resolves.
 * It is NOT PowerShell and proves nothing about NTFS — it exists so the real
 * spawn/stdin/stdout/exit-code path can be exercised on POSIX hosts.
 */
async function mkProvider(base, body) {
  const dir = path.join(base, ...PROVIDER_SEGMENTS.slice(0, -1))
  await fs.mkdir(dir, { recursive: true })
  const providerPath = path.join(dir, PROVIDER_SEGMENTS.at(-1))
  await fs.writeFile(providerPath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 })
  return providerPath
}

const ECHO_PROVIDER = `
let raw = ""
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  const request = JSON.parse(raw)
  const results = request.paths.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    owner_sid: "S-1-5-21-1111111111-2222222222-3333333333-1001",
    owner_reassigned: false,
    protected: true,
    rule_count: 1,
  }))
  process.stdout.write(JSON.stringify({ status: "ok", results }))
})
`

const DIR_ENTRY = { path: "C:\\Users\\participant\\state\\feedback", kind: "directory", created: true }
const FILE_ENTRY = { path: "C:\\Users\\participant\\state\\feedback\\feedback.sqlite", kind: "file", created: true }

function runnerReturning(response, { code = 0, stderr = "" } = {}) {
  const calls = []
  const runner = async (invocation) => {
    calls.push(invocation)
    return { code, stdout: typeof response === "string" ? response : JSON.stringify(response), stderr }
  }
  runner.calls = calls
  return runner
}

test("assertWindowsAclAvailable resolves the fixed provider under SystemRoot", async () => {
  const base = await mkBase()
  try {
    const providerPath = await mkProvider(base, ECHO_PROVIDER)
    assert.equal(assertWindowsAclAvailable({ env: { SystemRoot: base } }), providerPath)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("assertWindowsAclAvailable fails when SystemRoot is absent or blank", () => {
  for (const env of [{}, { SystemRoot: "" }, { SystemRoot: "   " }]) {
    assert.throws(() => assertWindowsAclAvailable({ env }), /SystemRoot/u)
  }
})

test("assertWindowsAclAvailable rejects a relative provider root", () => {
  assert.throws(() => assertWindowsAclAvailable({ env: { SystemRoot: "relative-provider" } }), /absolute/u)
})

test("assertWindowsAclAvailable fails when the provider is missing or not a regular file", async () => {
  const base = await mkBase()
  try {
    assert.throws(() => assertWindowsAclAvailable({ env: { SystemRoot: base } }), /not available/u)
    await fs.mkdir(path.join(base, ...PROVIDER_SEGMENTS), { recursive: true })
    assert.throws(
      () => assertWindowsAclAvailable({ env: { SystemRoot: base } }),
      /not a regular file/u,
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("assertWindowsAclAvailable defaults to the ambient environment", () => {
  if (isWindows) {
    assert.match(assertWindowsAclAvailable(), /powershell\.exe$/iu)
    return
  }
  assert.throws(() => assertWindowsAclAvailable(), /SystemRoot|not available/u)
})

test("protectWindowsPaths rejects a malformed batch before touching the provider", async () => {
  const runner = runnerReturning({ status: "ok", results: [] })
  const env = { SystemRoot: "unused" }
  const cases = [
    [null, /array/u],
    [[], /at least one path/u],
    [[null], /object/u],
    [[{ ...DIR_ENTRY, extra: 1 }], /unknown field/u],
    [[{ kind: "directory", created: true }], /path/u],
    [[{ ...DIR_ENTRY, path: "" }], /path/u],
    [[{ ...DIR_ENTRY, path: "relative\\dir" }], /absolute/u],
    [[{ ...DIR_ENTRY, path: "C:\\bad\0name" }], /path/u],
    [[{ ...DIR_ENTRY, kind: "symlink" }], /kind/u],
    [[{ ...DIR_ENTRY, created: "yes" }], /created/u],
    [Array.from({ length: 65 }, () => DIR_ENTRY), /too many/u],
  ]
  for (const [paths, expected] of cases) {
    await assert.rejects(() => protectWindowsPaths(paths, { env, runner }), expected)
  }
  assert.equal(runner.calls.length, 0, "a malformed batch must never reach the provider")
})

test("protectWindowsPaths invokes one fixed, non-interpolating provider command", async () => {
  const base = await mkBase()
  try {
    const providerPath = await mkProvider(base, ECHO_PROVIDER)
    const runner = runnerReturning({
      status: "ok",
      results: [DIR_ENTRY, FILE_ENTRY].map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        owner_sid: "S-1-5-21-9-9-9-1001",
        owner_reassigned: entry.kind === "directory",
        protected: true,
        rule_count: 1,
      })),
    })

    const result = await protectWindowsPaths([DIR_ENTRY, FILE_ENTRY], {
      env: { SystemRoot: base },
      runner,
    })

    assert.equal(runner.calls.length, 1, "one provider process per batch")
    const [call] = runner.calls
    assert.equal(call.executable, providerPath)
    assert.deepEqual(result, [
      {
        path: DIR_ENTRY.path,
        kind: "directory",
        owner_sid: "S-1-5-21-9-9-9-1001",
        owner_reassigned: true,
      },
      {
        path: FILE_ENTRY.path,
        kind: "file",
        owner_sid: "S-1-5-21-9-9-9-1001",
        owner_reassigned: false,
      },
    ])

    assert.ok(call.args.includes("-NoProfile"))
    assert.ok(call.args.includes("-NonInteractive"))
    assert.ok(call.args.includes("-EncodedCommand"))
    for (const forbidden of ["-ExecutionPolicy", "Bypass", "-Command", "RunAs"]) {
      assert.ok(!call.args.includes(forbidden), `${forbidden} must not appear in the argv`)
    }

    const encoded = call.args[call.args.indexOf("-EncodedCommand") + 1]
    const script = Buffer.from(encoded, "base64").toString("utf16le")
    // Protect the DACL and do NOT copy inherited rules, then prove the result
    // was actually applied rather than trusting Set-Acl.
    assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/u)
    assert.match(script, /if \(-not \$applied\.AreAccessRulesProtected\)/u)
    assert.match(script, /ReparsePoint/u)
    assert.match(script, /FileSystemRights\]::FullControl/u)
    assert.match(script, /\[Console\]::InputEncoding = \$utf8/u)
    assert.match(script, /\[Console\]::OutputEncoding = \$utf8/u)
    assert.ok(!/-ExecutionPolicy|Start-Process|runas/iu.test(script))
    for (const entry of [DIR_ENTRY, FILE_ENTRY]) {
      assert.ok(
        !script.includes(entry.path),
        "paths must travel as JSON data, never interpolated into the program",
      )
    }
    assert.deepEqual(JSON.parse(call.payload), { paths: [DIR_ENTRY, FILE_ENTRY] })
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("protectWindowsPaths refuses every result the provider did not actually verify", async () => {
  const base = await mkBase()
  await mkProvider(base, ECHO_PROVIDER)
  const env = { SystemRoot: base }
  const ok = {
    path: DIR_ENTRY.path,
    kind: "directory",
    owner_sid: "S-1-5-21-9-9-9-1001",
    owner_reassigned: false,
    protected: true,
    rule_count: 1,
  }
  const cases = [
    [{ status: "ok", results: [] }, /reported 0 of 1/u],
    [{ status: "ok", results: [ok, ok] }, /reported 2 of 1/u],
    [{ status: "ok", results: [{ ...ok, path: "C:\\elsewhere" }] }, /different path/u],
    [{ status: "ok", results: [{ ...ok, kind: "file" }] }, /different kind/u],
    [{ status: "ok", results: [{ ...ok, protected: false }] }, /protected/u],
    [{ status: "ok", results: [{ ...ok, rule_count: 2 }] }, /exactly one/u],
    [{ status: "ok", results: [{ ...ok, owner_sid: "administrators" }] }, /owner SID/u],
    [{ status: "ok", results: [{ ...ok, owner_reassigned: "no" }] }, /owner_reassigned/u],
    [{ status: "ok", results: [null] }, /no result for/u],
    [{ status: "ok", results: "nope" }, /results/u],
    [{ status: "weird", results: [ok] }, /unreadable|status/u],
    ["not json at all", /unreadable/u],
    ["", /unreadable/u],
  ]
  for (const [response, expected] of cases) {
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env, runner: runnerReturning(response) }),
      expected,
      `expected refusal for ${JSON.stringify(response)}`,
    )
  }
  await fs.rm(base, { recursive: true, force: true })
})

test("protectWindowsPaths surfaces a provider failure instead of succeeding quietly", async () => {
  const base = await mkBase()
  await mkProvider(base, ECHO_PROVIDER)
  const env = { SystemRoot: base }
  await assert.rejects(
    () =>
      protectWindowsPaths([DIR_ENTRY], {
        env,
        runner: runnerReturning({ status: "error", message: "reparse point refused" }, { code: 1 }),
      }),
    /reparse point refused/u,
  )
  await assert.rejects(
    () =>
      protectWindowsPaths([DIR_ENTRY], {
        env,
        runner: runnerReturning("", { code: 5, stderr: "Get-Acl : access denied" }),
      }),
    /exited with code 5[\s\S]*access denied/u,
  )
  await assert.rejects(
    () => protectWindowsPaths([DIR_ENTRY], { env, runner: runnerReturning("", { code: 9 }) }),
    /exited with code 9: no diagnostic output/u,
    "a silent provider failure must still be an explicit failure",
  )
  await assert.rejects(
    () =>
      protectWindowsPaths([DIR_ENTRY], {
        env,
        runner: async () => {
          throw new Error("spawn ENOENT")
        },
      }),
    /spawn ENOENT/u,
  )
  await fs.rm(base, { recursive: true, force: true })
})

test("protectWindowsPaths drives a real child process over stdin by default", posixProvider, async () => {
  const base = await mkBase()
  try {
    await mkProvider(base, ECHO_PROVIDER)
    const result = await protectWindowsPaths([DIR_ENTRY, FILE_ENTRY], {
      env: { SystemRoot: base },
    })
    assert.equal(result.length, 2)
    assert.equal(result[0].path, DIR_ENTRY.path)
    assert.equal(result[1].kind, "file")
    assert.match(result[0].owner_sid, /^S-1-5-21-/u)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("the provider isolates Windows PowerShell module discovery from its parent", posixProvider, async () => {
  const base = await mkBase()
  const keys = ["PSModulePath", "PSMODULEPATH"]
  const previous = keys.map((key) => process.env[key])
  try {
    for (const key of keys) process.env[key] = "incompatible-parent-modules"
    const modules = path.join(base, ...PROVIDER_SEGMENTS.slice(0, -1), "Modules")
    await mkProvider(base, `
const keys = Object.keys(process.env).filter(key => key.toLowerCase() === "psmodulepath");
if (keys.length !== 1 || keys[0] !== "PSModulePath" || process.env.PSModulePath !== ${JSON.stringify(modules)}) {
  process.stdin.resume();
  process.stdout.write(JSON.stringify({status:"error",message:"module discovery was inherited"}));
  process.exitCode = 1;
} else {
  ${ECHO_PROVIDER}
}
`)
    const result = await protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: base } })
    assert.equal(result[0].path, DIR_ENTRY.path)
    assert.ok(keys.every((key) => process.env[key] === "incompatible-parent-modules"), "the parent's environment must remain unchanged")
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]
    })
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("the default runner bounds how long it waits and how much it reads", posixProvider, async () => {
  const base = await mkBase()
  try {
    await mkProvider(base, `setTimeout(() => {}, 60000)`)
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: base }, timeoutMs: 250 }),
      /timed out/u,
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }

  const noisy = await mkBase()
  try {
    await mkProvider(
      noisy,
      `process.stdin.resume(); process.stdout.write("x".repeat(4096))`,
    )
    await assert.rejects(
      () =>
        protectWindowsPaths([DIR_ENTRY], {
          env: { SystemRoot: noisy },
          maxOutputBytes: 2048,
        }),
      /too much output/u,
    )
  } finally {
    await fs.rm(noisy, { recursive: true, force: true })
  }
})

test("the default runner keeps provider diagnostics and refuses an unrunnable provider", posixProvider, async () => {
  const noisy = await mkBase()
  try {
    await mkProvider(
      noisy,
      `let raw = ""
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  process.stderr.write("WARNING: Set-Acl fell back")
  process.stdout.write(JSON.stringify({ status: "ok", results: [] }))
  process.exit(3)
})`,
    )
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: noisy } }),
      /exited with code 3[\s\S]*Set-Acl fell back/u,
      "stderr must reach the caller so a provider failure is diagnosable",
    )
  } finally {
    await fs.rm(noisy, { recursive: true, force: true })
  }

  const unrunnable = await mkBase()
  try {
    const providerPath = await mkProvider(unrunnable, ECHO_PROVIDER)
    await fs.chmod(providerPath, 0o644)
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: unrunnable } }),
      /EACCES|EPIPE|spawn/u,
      "a provider that cannot be executed must fail, not resolve",
    )
  } finally {
    await fs.rm(unrunnable, { recursive: true, force: true })
  }
})

test("the default runner reports a non-zero provider exit", posixProvider, async () => {
  const base = await mkBase()
  try {
    await mkProvider(
      base,
      `process.stdin.resume()
process.stdout.write(JSON.stringify({ status: "error", message: "owner is not the current user" }))
process.exit(1)`,
    )
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: base } }),
      /owner is not the current user/u,
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("the default runner measures its output budget in UTF-8 bytes", posixProvider, async () => {
  const base = await mkBase()
  try {
    await mkProvider(base, `process.stdin.resume(); process.stdout.write("\\u00e9".repeat(800))`)
    await assert.rejects(
      () => protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: base }, maxOutputBytes: 1000 }),
      /too much output/u,
    )
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

function findPowerShellParser() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"])
    if (probe.status === 0) return candidate
  }
  return null
}

async function encodedProgram() {
  const base = await mkBase()
  try {
    await mkProvider(base, ECHO_PROVIDER)
    const runner = runnerReturning({
      status: "ok",
      results: [
        {
          path: DIR_ENTRY.path,
          kind: "directory",
          owner_sid: "S-1-5-21-9-9-9-1001",
          owner_reassigned: false,
          protected: true,
          rule_count: 1,
        },
      ],
    })
    await protectWindowsPaths([DIR_ENTRY], { env: { SystemRoot: base }, runner })
    const { args } = runner.calls[0]
    return Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le")
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

// A real PowerShell parser check. It proves the embedded program is syntactically
// valid PowerShell — nothing more. It does NOT execute it and says nothing about
// NTFS behaviour; only the win32 test below does that.
const powerShellParser = findPowerShellParser()
test(
  "the embedded ACL program is syntactically valid PowerShell",
  { skip: powerShellParser ? false : "no PowerShell parser on this host" },
  async () => {
    const script = await encodedProgram()
    const parsed = spawnSync(
      powerShellParser,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$errors = $null;" +
          "[void][System.Management.Automation.Language.Parser]::ParseInput(" +
          "[Console]::In.ReadToEnd(), [ref]$null, [ref]$errors);" +
          "if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }",
      ],
      { input: script, encoding: "utf8" },
    )
    assert.equal(parsed.status, 0, `PowerShell reported a parse error:\n${parsed.stdout}`)
  },
)

function nativeProbe(program, input) {
  const prefix = "$ErrorActionPreference='Stop';" +
    "$env:PSModulePath=Join-Path $PSHOME 'Modules';" +
    "[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false);" +
    "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);" +
    "$request=[Console]::In.ReadToEnd()|ConvertFrom-Json;"
  return JSON.parse(execFileSync(
    assertWindowsAclAvailable(),
    ["-NoProfile", "-NonInteractive", "-Command", prefix + program],
    { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, timeout: 20000 },
  ))
}

test("native: Windows ACL protection refuses junctions without changing their targets", {
  skip: isWindows ? false : "requires a native Windows host",
}, async () => {
  const base = await mkBase()
  try {
    const target = path.join(base, "target")
    const junction = path.join(base, "junction")
    await fs.mkdir(target)
    await fs.symlink(target, junction, "junction")
    const readSddl = "ConvertTo-Json -Compress -InputObject (Get-Acl -LiteralPath $request.path).Sddl"
    const before = nativeProbe(readSddl, { path: target })
    await assert.rejects(
      () => protectWindowsPaths([{ path: junction, kind: "directory", created: false }]),
      /reparse point/u,
    )
    assert.equal(nativeProbe(readSddl, { path: target }), before)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test("native: Windows ACL protection distinguishes an existing foreign owner from new default group ownership", {
  skip: isWindows ? false : "requires a native Windows host",
}, async () => {
  const base = await mkBase()
  try {
    const target = path.join(base, "new-directory")
    await fs.mkdir(target)
    const assigned = nativeProbe(
      "$a=Get-Acl -LiteralPath $request.path;" +
        "$a.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')));" +
        "Set-Acl -LiteralPath $request.path -AclObject $a;" +
        "$a=Get-Acl -LiteralPath $request.path;" +
        "ConvertTo-Json -Compress -InputObject ([pscustomobject]@{" +
        "owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;sddl=$a.Sddl})",
      { path: target },
    )
    assert.equal(assigned.owner, "S-1-5-32-544")
    await assert.rejects(
      () => protectWindowsPaths([{ path: target, kind: "directory", created: false }]),
      /owned by another user/u,
    )
    assert.equal(nativeProbe(
      "ConvertTo-Json -Compress -InputObject (Get-Acl -LiteralPath $request.path).Sddl",
      { path: target },
    ), assigned.sddl)
    const result = await protectWindowsPaths([{ path: target, kind: "directory", created: true }])
    assert.equal(result[0].owner_reassigned, true)
    assert.notEqual(result[0].owner_sid, assigned.owner)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

// --- Native proof: real NTFS ACLs. Skipped off Windows; nothing above substitutes for it.
test(
  "native: protectWindowsPaths applies and verifies an owner-only NTFS DACL",
  { skip: isWindows ? false : "requires a native Windows host" },
  async () => {
    const base = await mkBase()
    try {
      const dir = path.join(base, "feedback-\u03b4-\u53cd\u9988-'quoted'")
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, "feedback.sqlite")
      await fs.writeFile(file, "")

      const result = await protectWindowsPaths([
        { path: dir, kind: "directory", created: true },
        { path: file, kind: "file", created: true },
      ])
      assert.equal(result.length, 2)

      for (const target of [dir, file]) {
        const acl = nativeProbe(
          "$a=Get-Acl -LiteralPath $request.path;" +
            "$r=@($a.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier]));" +
            "ConvertTo-Json -Compress -InputObject ([pscustomobject]@{" +
            "owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;" +
            "protected=$a.AreAccessRulesProtected;count=$r.Count;" +
            "identity=$r[0].IdentityReference.Value;rights=$r[0].FileSystemRights.ToString()})",
          { path: target },
        )
        const self = result[0].owner_sid
        assert.equal(acl.owner, self, `${target} must be owned by the current user`)
        assert.equal(acl.protected, true, `${target} must not inherit rules`)
        assert.equal(acl.count, 1, `${target} must carry exactly one access rule`)
        assert.equal(acl.identity, self)
        assert.match(acl.rights, /FullControl/u)
      }

      await assert.rejects(
        () => protectWindowsPaths([{ path: path.join(base, "missing"), kind: "directory", created: false }]),
        /desk_feedback/u,
      )
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  },
)
