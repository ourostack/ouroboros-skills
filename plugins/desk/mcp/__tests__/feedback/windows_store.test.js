import { test } from "node:test"
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { assertWindowsAclAvailable } from "../../src/feedback/windows-acl.js"
import { resolveProtectedStore } from "../../src/protected/store.js"
import { LEDGER_STORE } from "../../src/measurement/store.js"
import { callTool } from "../../src/server.js"
import { mkFeedbackFixture, useStateHome, cleanup } from "./_helpers.js"
import { mkLedgerFixture, useHostEnv } from "../measurement/_helpers.js"

const isWindows = process.platform === "win32"
const standIn = { skip: isWindows ? "POSIX adapter stand-in; native Windows cases below use the real provider" : false }

async function makeProvider(fixture, failKind = null) {
  const root = path.join(fixture.base, "system")
  const directory = path.join(root, "System32", "WindowsPowerShell", "v1.0")
  const trace = path.join(fixture.base, "provider-calls.jsonl")
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, "powershell.exe"), `#!/usr/bin/env node
const fs = require("node:fs");
let raw = "";
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(raw);
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(request.paths) + "\\n");
  if (request.paths.some(entry => entry.kind === ${JSON.stringify(failKind)})) {
    process.stdout.write(JSON.stringify({status:"error",message:"native protection refused"}));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({status:"ok",results:request.paths.map(entry => ({
    ...entry, owner_sid:"S-1-5-21-1-2-3-1001", owner_reassigned:false, protected:true, rule_count:1
  }))}));
});
`, { mode: 0o755 })
  return {
    binding: { deskRoot: fixture.deskRoot, platform: "win32", env: { SystemRoot: root, XDG_STATE_HOME: fixture.stateHome } },
    trace,
  }
}

test("Windows private storage refuses a missing provider before creating state", async () => {
  const fixture = await mkFeedbackFixture()
  try {
    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, platform: "win32", env: { XDG_STATE_HOME: fixture.stateHome } }),
      /Windows ACL protection.*SystemRoot/u,
    )
    await assert.rejects(() => fs.stat(fixture.stateHome), /ENOENT/u)
  } finally {
    await cleanup(fixture.base)
  }
})

test("Windows storage batches directories and protects the DB before use on every open", standIn, async () => {
  const fixture = await mkFeedbackFixture()
  try {
    const { binding, trace } = await makeProvider(fixture)
    const entry = await withPrivateStore(binding, (store) => store.capture({ text: "private entry", taskRef: null }))
    const listed = await withPrivateStore(binding, (store) => store.list({ limit: 20 }))
    assert.deepEqual(listed.entries, [entry])
    const calls = (await fs.readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(calls.map((entries) => entries.map(({ kind }) => kind)), [
      ["directory", "directory", "directory", "directory"], ["file"],
      ["directory", "directory", "directory", "directory"], ["file"],
    ])
    assert.ok(calls.slice(0, 2).flat().every(({ created }) => created === true))
    assert.ok(calls.slice(2).flat().every(({ created }) => created === false))
    assert.equal(path.basename(calls[1][0].path), "feedback.sqlite")
    assert.doesNotMatch(await fs.readFile(trace, "utf8"), /private entry/u, "the provider gets paths, never feedback text")
  } finally {
    await cleanup(fixture.base)
  }
})

for (const kind of ["directory", "file"]) {
  test(`Windows ${kind} protection failure never reaches SQLite or its callback`, standIn, async () => {
    const fixture = await mkFeedbackFixture()
    try {
      const { binding, trace } = await makeProvider(fixture, kind)
      await assert.rejects(
        () => withPrivateStore(binding, () => assert.fail("must not open SQLite")),
        /native protection refused/u,
      )
      const calls = (await fs.readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
      assert.equal(calls.length, kind === "directory" ? 1 : 2)
      if (kind === "file") {
        assert.equal((await fs.stat(calls[1][0].path)).size, 0, "failed protection leaves no feedback bytes")
      }
    } finally {
      await cleanup(fixture.base)
    }
  })
}

test("native: Windows feedback CRUD preserves content across reopen and rejects stale corrections", {
  skip: isWindows ? false : "requires NTFS and the real Windows ACL provider",
}, async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const input = (value) => callTool({ deskRoot: fixture.deskRoot, person: "rowan", name: "desk_feedback", input: value })
  const body = (response) => {
    assert.equal(response.isError, undefined, JSON.stringify(response.content))
    return JSON.parse(response.content[0].text)
  }
  try {
    const captured = body(await input({ action: "capture", text: "native Windows participant feedback" })).entry
    assert.equal(body(await input({ action: "list" })).entries[0].entry_id, captured.entry_id)
    const corrected = body(await input({
      action: "correct", entry_id: captured.entry_id, expected_revision: 1, text: "corrected native Windows feedback",
    })).entry
    assert.equal(corrected.revision, 2)
    const stale = await input({ action: "correct", entry_id: captured.entry_id, expected_revision: 1, text: "stale text" })
    assert.equal(stale.isError, true)
    assert.equal(body(await input({ action: "list" })).entries[0].text, corrected.text)
    body(await input({ action: "delete", entry_id: captured.entry_id }))
    assert.equal(body(await input({ action: "list" })).total, 0)
    const { dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    const bytes = await fs.readFile(dbPath)
    assert.equal(bytes.includes(Buffer.from(captured.text)), false)
    assert.equal(bytes.includes(Buffer.from(corrected.text)), false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// ── Native work-ledger continuation ─────────────────────────────────────────
//
// The private work ledger keeps its records through the same shared protected
// store as the feedback cases above, so on win32 it goes through the real
// Windows ACL provider and an owner-only NTFS DACL before SQLite opens.
//
// The ledger's own suites cover its logic in full, but they run on POSIX, and
// the native Windows job runs *this* file. A POSIX pass is not evidence about
// NTFS, so without the cases below the ledger caller is not covered by that job
// at all. They live here — rather than in a second job, a new workflow entry or
// a native harness — so the existing entry qualifies the ledger too.
//
// As above, nothing here uses the stand-in provider: the stand-in cases prove
// the adapter, these prove the real thing.

const nativeLedger = { skip: isWindows ? false : "requires NTFS and the real Windows ACL provider" }

const LEDGER_COMMITMENT = {
  outcome: "A native Windows qualification pass for the private work ledger.",
  scope: "The ledger's own storage path on NTFS only.",
  evidence: "The assertions in this test.",
  delivery_endpoint: "desks/rowan/delivery/native-ledger/task.md",
  operator_go: { by: "operator", at: "2026-09-08T18:00:00Z" },
}

function ledgerBody(response) {
  assert.equal(response.isError, undefined, JSON.stringify(response.content))
  return JSON.parse(response.content[0].text)
}

function refusal(response) {
  assert.equal(response.isError, true, "expected a refusal")
  return JSON.parse(response.content[0].text).message
}

async function openLedger() {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv({ stateHome: fixture.stateHome, copilotHome: fixture.copilotHome })
  const ledger = (input) =>
    callTool({ deskRoot: fixture.deskRoot, person: "rowan", name: "desk_work_ledger", input })
  return { fixture, restore, ledger }
}

// Reads a real NTFS ACL through the same provider the store itself locates.
function readNativeAcl(target) {
  const prefix =
    "$ErrorActionPreference='Stop';" +
    "$env:PSModulePath=Join-Path $PSHOME 'Modules';" +
    "[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false);" +
    "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);" +
    "$request=[Console]::In.ReadToEnd()|ConvertFrom-Json;"
  const program =
    "$a=Get-Acl -LiteralPath $request.path;" +
    "$r=@($a.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier]));" +
    "ConvertTo-Json -Compress -InputObject ([pscustomobject]@{" +
    "owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;" +
    "protected=$a.AreAccessRulesProtected;count=$r.Count;" +
    "self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;" +
    "identity=$r[0].IdentityReference.Value;rights=$r[0].FileSystemRights.ToString()})"
  return JSON.parse(execFileSync(
    assertWindowsAclAvailable(),
    ["-NoProfile", "-NonInteractive", "-Command", prefix + program],
    { input: JSON.stringify({ path: target }), encoding: "utf8", windowsHide: true, timeout: 20000 },
  ))
}

test("native: Windows work ledger records, reopens, reports and corrects a work item", nativeLedger, async () => {
  const { fixture, restore, ledger } = await openLedger()
  const request = "Native NTFS work-ledger witness, marker 7f3a1c."
  try {
    // Recording is opted into explicitly rather than inherited from the
    // default, so this case states the capture posture it depends on.
    assert.equal(
      ledgerBody(await ledger({
        action: "set_recording", enabled: true, reason: "native Windows qualification run",
      })).status,
      "recording_enabled",
    )

    const intake = ledgerBody(await ledger({ action: "intake", request, requested_by: "operator" }))
    assert.equal(intake.status, "intake_recorded")
    const workItemId = intake.work_item.work_item_id

    assert.equal(
      ledgerBody(await ledger({ action: "commit", work_item_id: workItemId, ...LEDGER_COMMITMENT })).status,
      "committed",
    )

    // Each call opens its own connection, so this reads the record back off
    // NTFS rather than out of a handle the writer still holds.
    const reopened = ledgerBody(await ledger({ action: "inspect", work_item_id: workItemId }))
    assert.equal(reopened.work_item.state, "committed")
    assert.equal(reopened.work_item.request, request)

    const report = ledgerBody(await ledger({ action: "report", work_item_id: workItemId }))
    const reported = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(reported.request.value, request)
    assert.equal(reported.request.class, "declared")
    assert.equal(report.recording.enabled, true)

    const corrected = ledgerBody(await ledger({
      action: "correct", work_item_id: workItemId, field: "outcome",
      value: "A native Windows qualification pass, stated more precisely.",
      expected_revision: 1, reason: "The first sentence was ambiguous.",
    }))
    assert.equal(corrected.status, "corrected")
    assert.equal(corrected.correction.previous_value, LEDGER_COMMITMENT.outcome)
    assert.equal(corrected.work_item.revision, 2)

    // The revision that was just consumed must not be usable a second time.
    const stale = await ledger({
      action: "correct", work_item_id: workItemId, field: "outcome", value: "written against a stale read",
      expected_revision: 1, reason: "the caller never saw revision 2",
    })
    assert.match(refusal(stale), /is at revision 2/u)

    const settled = ledgerBody(await ledger({ action: "inspect", work_item_id: workItemId }))
    assert.equal(settled.corrections.length, 1, "the refused correction must not have been recorded")
    assert.equal(settled.corrections[0].field, "outcome")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("native: Windows work ledger protects its own namespace and clears deleted bytes", nativeLedger, async () => {
  const { fixture, restore, ledger } = await openLedger()
  const request = "Native NTFS deletion witness, marker 4d9e02."
  try {
    const intake = ledgerBody(await ledger({ action: "intake", request, requested_by: "operator" }))
    const workItemId = intake.work_item.work_item_id
    ledgerBody(await ledger({ action: "commit", work_item_id: workItemId, ...LEDGER_COMMITMENT }))

    // The ledger's namespace is distinct from the feedback store's, and it is
    // the one that has to be protected here.
    const { storeDir, dbPath } = await resolveProtectedStore({
      deskRoot: fixture.deskRoot, person: "rowan", ...LEDGER_STORE,
    })
    assert.equal(path.basename(dbPath), LEDGER_STORE.filename)
    assert.equal(path.basename(path.dirname(storeDir)), LEDGER_STORE.namespace)
    // The ledger's namespace is a sibling of the feedback store's, not the same
    // directory, so protecting feedback says nothing about this one.
    const feedback = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    assert.notEqual(path.dirname(feedback.dbPath), storeDir)

    for (const target of [storeDir, dbPath]) {
      const acl = readNativeAcl(target)
      // Pinning to the current user's own SID is the substantive claim. Asserting
      // only that the granted identity equals the owner would also be satisfied by
      // a directory owned by and granted to Administrators, which is not owner-only
      // for this account. The `S-1-5-21-` prefix is what distinguishes a real
      // machine-local user from a builtin group such as S-1-5-32-544.
      assert.match(acl.self, /^S-1-5-21-/u, "the probe must resolve a real user SID")
      assert.equal(acl.owner, acl.self, `${target} must be owned by the current user`)
      assert.equal(acl.protected, true, `${target} must not inherit rules`)
      assert.equal(acl.count, 1, `${target} must carry exactly one access rule`)
      assert.equal(acl.identity, acl.self, `${target} must grant that user and nobody else`)
      assert.match(acl.rights, /FullControl/u)
    }

    // Confirms the byte search reads the file the records actually landed in,
    // so the absence check below cannot pass against the wrong file.
    assert.equal(
      (await fs.readFile(dbPath)).includes(Buffer.from(request)), true,
      "the recorded request should be present before deletion",
    )

    const deleted = ledgerBody(await ledger({ action: "delete", work_item_id: workItemId, confirm: true }))
    assert.equal(deleted.status, "deleted")
    const removed = deleted.removed_rows.map((row) => row.table)
    assert.ok(removed.includes("work_items"), JSON.stringify(deleted.removed_rows))
    assert.ok(removed.includes("commitments"), JSON.stringify(deleted.removed_rows))

    const bytes = await fs.readFile(dbPath)
    assert.equal(bytes.includes(Buffer.from(request)), false, "the deleted request must not survive on disk")
    assert.equal(
      bytes.includes(Buffer.from(LEDGER_COMMITMENT.outcome)), false,
      "the deleted commitment must not survive on disk",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("native: Windows work ledger refuses capture while recording is off and still answers its owner", nativeLedger, async () => {
  const { fixture, restore, ledger } = await openLedger()
  try {
    const intake = ledgerBody(await ledger({
      action: "intake", request: "Native NTFS recording-gap witness.", requested_by: "operator",
    }))
    const workItemId = intake.work_item.work_item_id

    assert.equal(
      ledgerBody(await ledger({
        action: "set_recording", enabled: false, reason: "the operator stepped away from measured work",
      })).status,
      "recording_disabled",
    )

    const refused = await ledger({
      action: "intake", request: "recorded while the switch was off", requested_by: "operator",
    })
    assert.match(refusal(refused), /recording is disabled/iu)

    // The owner's own routes stay open while capture is off — inspection and
    // reporting are how the gap becomes visible rather than silent.
    assert.equal(
      ledgerBody(await ledger({ action: "inspect", work_item_id: workItemId })).work_item.work_item_id,
      workItemId,
    )
    const report = ledgerBody(await ledger({ action: "report", work_item_id: workItemId }))
    assert.equal(report.recording.enabled, false)
    assert.equal(report.recording_gaps.length, 1)
    assert.equal(report.recording_gaps[0].open, true)
    assert.equal(report.recording_gaps[0].enabled_at, null)

    // Re-enabling closes the gap rather than backfilling the window.
    assert.equal(
      ledgerBody(await ledger({ action: "set_recording", enabled: true, reason: "resuming measured work" })).status,
      "recording_enabled",
    )
    const resumed = ledgerBody(await ledger({ action: "report", work_item_id: workItemId }))
    assert.equal(resumed.recording_gaps.length, 1, "the gap stays on the record instead of disappearing")
    assert.equal(resumed.recording_gaps[0].open, false)
    assert.notEqual(resumed.recording_gaps[0].enabled_at, null)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
