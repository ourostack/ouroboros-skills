// Native Windows ACL primitive for the private feedback store.
//
// POSIX hosts protect the store with owner-only 0700/0600 modes. Windows has no
// equivalent, so this module constrains the real NTFS DACL instead: exactly one
// access rule, allowing only the current user's SID FullControl, with inherited
// rules cut off. It uses the ACL APIs already present on every Windows install
// (Windows PowerShell over System.Security.AccessControl) — no new dependency,
// no crypto, and no pretence that a chmod protects anything here.
//
// This module owns one thing: applying and verifying that protection on paths
// the caller has already created and validated. It creates no files or
// directories, resolves no store location, and picks no namespace — every path
// it touches is one the caller handed it.

import { spawn as nodeSpawn } from "node:child_process"
import { statSync } from "node:fs"
import * as path from "node:path"

// Resolved from %SystemRoot%, never from PATH: the provider must be the one
// shipped with the operating system, not the first match on a search path.
const PROVIDER_SEGMENTS = ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"]

const MAX_PATHS = 64
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024
const ENTRY_FIELDS = new Set(["path", "kind", "created"])
const KINDS = new Set(["directory", "file"])
const SID_PATTERN = /^S-1-[\d-]+$/u

// The whole program, fixed at build time. Paths never appear in it — they
// arrive as JSON on stdin — so there is nothing for a path to inject into.
// It constrains the DACL, writes it, then re-reads it and proves the result,
// failing loudly rather than reporting an unverified success.
const ACL_PROGRAM = `
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $self = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $administrators = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $results = @()
  foreach ($entry in $request.paths) {
    $target = $entry.path
    $item = Get-Item -LiteralPath $target -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "refusing a reparse point: $target"
    }
    $isDirectory = $item.PSIsContainer
    if ($isDirectory -ne ($entry.kind -eq 'directory')) {
      throw "path is not a $($entry.kind): $target"
    }
    $acl = Get-Acl -LiteralPath $target
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
    $reassigned = $false
    if ($owner -ne $self) {
      if ($entry.created -and $owner -eq $administrators) {
        $acl.SetOwner($self)
        $reassigned = $true
      } else {
        throw "refusing a path owned by another user ($owner): $target"
      }
    }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) { [void]$acl.RemoveAccessRule($existing) }
    $inheritance = if ($isDirectory) {
      [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
      [System.Security.AccessControl.InheritanceFlags]::None
    }
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $self,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow)))
    Set-Acl -LiteralPath $target -AclObject $acl
    $applied = Get-Acl -LiteralPath $target
    if ($applied.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $self) {
      throw "owner was not applied: $target"
    }
    if (-not $applied.AreAccessRulesProtected) {
      throw "inherited access rules still apply: $target"
    }
    $rules = @($applied.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1) {
      throw "expected exactly one access rule, found $($rules.Count): $target"
    }
    if ($rules[0].IdentityReference.Value -ne $self.Value) {
      throw "access rule grants another identity ($($rules[0].IdentityReference.Value)): $target"
    }
    if ($rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
      throw "access rule is not an Allow rule: $target"
    }
    $full = [System.Security.AccessControl.FileSystemRights]::FullControl
    if (($rules[0].FileSystemRights -band $full) -ne $full) {
      throw "access rule does not grant FullControl: $target"
    }
    if ($rules[0].InheritanceFlags -ne $inheritance) {
      throw "access rule carries the wrong inheritance flags: $target"
    }
    $results += [pscustomobject]@{
      path = $target
      kind = $entry.kind
      owner_sid = $self.Value
      owner_reassigned = $reassigned
      protected = $true
      rule_count = $rules.Count
    }
  }
  [Console]::Out.Write((ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{
    status = 'ok'
    results = @($results)
  })))
} catch {
  [Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 -InputObject ([pscustomobject]@{
    status = 'error'
    message = $_.Exception.Message
  })))
  exit 1
}
`

const ENCODED_PROGRAM = Buffer.from(ACL_PROGRAM, "utf16le").toString("base64")

function fail(message) {
  throw new Error(`desk_feedback: ${message}`)
}

/**
 * Resolve the operating system's own ACL provider, or fail before the caller
 * creates anything. Returns the absolute provider path.
 */
export function assertWindowsAclAvailable({ env = process.env } = {}) {
  const systemRoot = typeof env.SystemRoot === "string" ? env.SystemRoot.trim() : ""
  if (systemRoot === "") {
    fail(
      "Windows ACL protection needs %SystemRoot% to locate the system PowerShell; " +
        "it is unset, so the private feedback store cannot be protected",
    )
  }
  if (!path.isAbsolute(systemRoot)) {
    fail("Windows ACL protection requires an absolute SystemRoot")
  }
  const providerPath = path.join(systemRoot, ...PROVIDER_SEGMENTS)
  let stats
  try {
    stats = statSync(providerPath)
  } catch (error) {
    fail(
      `Windows ACL protection is not available: ${providerPath} could not be read (${error.code})`,
    )
  }
  if (!stats.isFile()) {
    fail(`Windows ACL protection is not available: ${providerPath} is not a regular file`)
  }
  return providerPath
}

function validateBatch(paths) {
  if (!Array.isArray(paths)) fail("Windows ACL protection expects an array of paths")
  if (paths.length === 0) fail("Windows ACL protection needs at least one path")
  if (paths.length > MAX_PATHS) {
    fail(`Windows ACL protection refuses too many paths at once (${paths.length} > ${MAX_PATHS})`)
  }
  return paths.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail("Windows ACL protection expects each path to be an object")
    }
    for (const field of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(field)) {
        fail(`Windows ACL protection received an unknown field: ${field}`)
      }
    }
    const { path: target, kind, created } = entry
    if (typeof target !== "string" || target.trim() === "" || target.includes("\0")) {
      fail("Windows ACL protection expects a non-empty path string")
    }
    if (!path.win32.isAbsolute(target)) {
      fail(`Windows ACL protection expects an absolute path: ${target}`)
    }
    if (!KINDS.has(kind)) {
      fail(`Windows ACL protection expects kind 'directory' or 'file': ${target}`)
    }
    if (typeof created !== "boolean") {
      fail(`Windows ACL protection expects created to be a boolean: ${target}`)
    }
    return { path: target, kind, created }
  })
}

function defaultRunner({ executable, args, payload, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    // Windows PowerShell cannot safely autoload PowerShell Core modules inherited from the host.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "psmodulepath"),
    )
    env.PSModulePath = path.join(path.dirname(executable), "Modules")
    const child = nodeSpawn(executable, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let outputBytes = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill("SIGKILL")
        reject(error)
        return
      }
      resolve(value)
    }
    const timer = setTimeout(() => {
      finish(new Error(`desk_feedback: Windows ACL provider timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const collect = (stream, append) => {
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => {
        outputBytes += Buffer.byteLength(chunk, "utf8")
        append(chunk)
        if (outputBytes > maxOutputBytes) {
          finish(new Error("desk_feedback: Windows ACL provider produced too much output"))
        }
      })
    }
    collect(child.stdout, (chunk) => {
      stdout += chunk
    })
    collect(child.stderr, (chunk) => {
      stderr += chunk
    })
    const abort = (error) => finish(error)
    child.on("error", abort)
    child.stdin.on("error", abort)
    child.on("close", (code) => finish(null, { code, stdout, stderr }))
    child.stdin.end(payload)
  })
}

function readResponse({ code, stdout, stderr }) {
  let parsed = null
  try {
    parsed = JSON.parse(stdout)
  } catch {
    parsed = null
  }
  if (parsed !== null && typeof parsed === "object" && parsed.status === "error") {
    fail(`Windows ACL protection failed: ${parsed.message}`)
  }
  if (code !== 0) {
    fail(
      `Windows ACL provider exited with code ${code}: ` +
        `${stderr.trim().slice(0, 500) || "no diagnostic output"}`,
    )
  }
  if (parsed === null || typeof parsed !== "object" || parsed.status !== "ok") {
    fail("Windows ACL provider returned unreadable output")
  }
  if (!Array.isArray(parsed.results)) {
    fail("Windows ACL provider returned no results array")
  }
  return parsed.results
}

function verify(requested, results) {
  if (results.length !== requested.length) {
    fail(
      `Windows ACL protection reported ${results.length} of ${requested.length} paths; ` +
        "refusing a partially verified batch",
    )
  }
  return requested.map((entry, index) => {
    const result = results[index]
    if (result === null || typeof result !== "object") {
      fail(`Windows ACL protection returned no result for ${entry.path}`)
    }
    if (result.path !== entry.path) {
      fail(`Windows ACL protection reported a different path than requested: ${entry.path}`)
    }
    if (result.kind !== entry.kind) {
      fail(`Windows ACL protection reported a different kind than requested: ${entry.path}`)
    }
    if (result.protected !== true) {
      fail(`Windows ACL protection did not report a protected DACL for ${entry.path}`)
    }
    if (result.rule_count !== 1) {
      fail(`Windows ACL protection did not leave exactly one access rule on ${entry.path}`)
    }
    if (typeof result.owner_sid !== "string" || !SID_PATTERN.test(result.owner_sid)) {
      fail(`Windows ACL protection reported no usable owner SID for ${entry.path}`)
    }
    if (typeof result.owner_reassigned !== "boolean") {
      fail(`Windows ACL protection reported no usable owner_reassigned flag for ${entry.path}`)
    }
    return {
      path: result.path,
      kind: result.kind,
      owner_sid: result.owner_sid,
      owner_reassigned: result.owner_reassigned,
    }
  })
}

/**
 * Constrain each already-created path to an owner-only protected DACL and read
 * the result back. Resolves with one verified descriptor per requested path, in
 * the order requested; rejects — never resolves — when anything is unproven.
 *
 * @param {Array<{path: string, kind: 'directory'|'file', created: boolean}>} paths
 */
export async function protectWindowsPaths(
  paths,
  {
    env = process.env,
    runner = defaultRunner,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = {},
) {
  const requested = validateBatch(paths)
  const executable = assertWindowsAclAvailable({ env })
  const completed = await runner({
    executable,
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_PROGRAM],
    payload: JSON.stringify({ paths: requested }),
    timeoutMs,
    maxOutputBytes,
  })
  return verify(requested, readResponse(completed))
}
