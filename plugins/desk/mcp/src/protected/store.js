// The shared protected-store primitive.
//
// Two private stores live in the operating-system user's own state directory:
// the participant's qualitative feedback and the operator's work ledger. They
// share one set of protections — owner-only permissions, refusal to sit inside
// a Git checkout, refusal to follow a symlink or a hard link, DELETE
// journalling and secure_delete — and they share nothing else: separate
// namespaces, separate database files, separate schemas.
//
// `namespace`, `filename`, `label` and `subject` are module-internal constants
// of the two callers. They are never tool input, so no caller can address a
// store it was not bound to, or ask for a schema of its choosing. `label`
// prefixes a message and `subject` names the thing inside it; both are
// parameterised because a prefix alone would leave the work ledger reporting a
// compromised *feedback* database.

import { createHash } from "node:crypto"
import childProcess from "node:child_process"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import Database from "better-sqlite3"

import { expandHome, isPathContained, personPrefix } from "../util/paths.js"
import { assertWindowsAclAvailable, protectWindowsPaths } from "../feedback/windows-acl.js"

const OWNER_ONLY_DIR_MODE = 0o700
const OWNER_ONLY_FILE_MODE = 0o600
const ROOT_SEGMENTS = ["ouroboros-skills", "desk"]

/**
 * Resolve (and create) the owner-only directory holding this binding's private
 * database.
 *
 * Partitioning uses the already-resolved desk root and the session's `--person`
 * binding — never anything the tool caller supplies — so one participant's
 * store cannot be addressed from another participant's session.
 */
export async function resolveProtectedStore({
  deskRoot,
  person = null,
  env = process.env,
  platform = process.platform,
  namespace,
  filename,
  label,
  subject,
}) {
  if (platform === "win32") {
    assertWindowsAclAvailable({ env })
  }

  const naming = { label, subject }
  const segments = [...ROOT_SEGMENTS, namespace]
  const alias = bindingAlias(deskRoot, person)
  const realDeskRoot = await realPathOrThrow(deskRoot, "desk root could not be resolved", naming)

  const stateHome = resolveStateHome(env)
  await fs.mkdir(stateHome, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const realStateHome = await realPathOrThrow(
    stateHome,
    "state home could not be resolved",
    naming,
  )

  const partition = partitionId(realDeskRoot, alias)
  const storeDir = path.join(realStateHome, ...segments, partition)
  await assertOutsideGitWorkspace({ realStateHome, storeDir, realDeskRoot, naming })

  let cursor = realStateHome
  const ownedDirectories = []
  for (const segment of [...segments, partition]) {
    cursor = path.join(cursor, segment)
    const created = await ensureOwnerOnlyDirectory(cursor, platform, naming)
    await assertNotGitCheckout(cursor, naming)
    ownedDirectories.push({ path: cursor, kind: "directory", created })
  }
  if (platform === "win32") {
    await protectWindowsPaths(ownedDirectories, { env })
  }

  return { storeDir, dbPath: path.join(storeDir, filename) }
}

/**
 * Open the protected database, run `body` against it, and always close the
 * handle. The handle is bounded by this call: it is closed before this function
 * returns or throws, so nothing escapes to be used later.
 */
export async function withProtectedStore(binding, body) {
  const { dbPath } = await resolveProtectedStore(binding)
  const {
    platform = process.platform,
    env = process.env,
    schemaSql,
    label,
    subject,
  } = binding
  const db = await openProtectedDb(dbPath, { platform, env, schemaSql, naming: { label, subject } })
  try {
    return await body({ db, dbPath })
  } finally {
    db.close()
  }
}

async function openProtectedDb(dbPath, { platform, env, schemaSql, naming }) {
  const { label, subject } = naming
  let created = false
  try {
    await fs.writeFile(dbPath, "", { flag: "wx", mode: OWNER_ONLY_FILE_MODE })
    created = true
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
  const existing = await lstatIfPresent(dbPath, naming)
  if (existing !== null && existing.isSymbolicLink()) {
    throw new Error(
      `${label}: private ${subject} DB path is a symlink and will not be used: ${dbPath}`,
    )
  }
  if (existing === null || !existing.isFile()) {
    throw new Error(`${label}: private ${subject} store at ${dbPath} could not be opened: not a regular file`)
  }
  if (existing.nlink !== 1) {
    throw new Error(`${label}: private ${subject} DB is hard-linked and will not be used: ${dbPath}`)
  }
  if (platform === "win32") {
    await protectWindowsPaths([{ path: dbPath, kind: "file", created }], { env })
  } else {
    clearExtendedAcl(dbPath, platform, naming)
    await fs.chmod(dbPath, OWNER_ONLY_FILE_MODE)
  }
  // The handle exists before anything that can fail against it, so every exit
  // from here closes exactly one open handle.
  const db = new Database(dbPath)
  try {
    // DELETE journalling keeps private rows in one file instead of leaving
    // copies in a -wal sidecar; secure_delete zeroes freed pages so a deletion
    // removes the content rather than unlinking a still-readable page.
    db.pragma("journal_mode = DELETE")
    db.pragma("secure_delete = ON")
    db.exec(schemaSql)
  } catch (error) {
    db.close()
    throw new Error(
      `${label}: private ${subject} store at ${dbPath} could not be opened: ${error.message}`,
    )
  }
  return db
}

function bindingAlias(deskRoot, person) {
  // personPrefix owns alias validation (rejects traversal and multi-segment
  // aliases); reuse it here so the private stores and the desk write paths
  // agree on what a person binding may be.
  const prefix = personPrefix(deskRoot, person)
  return prefix === deskRoot ? null : path.basename(prefix)
}

function partitionId(realDeskRoot, alias) {
  return createHash("sha256")
    .update(JSON.stringify({ desk_root: realDeskRoot, person: alias }))
    .digest("hex")
    .slice(0, 32)
}

function resolveStateHome(env) {
  const home = env.HOME ?? os.homedir()
  const configured = env.XDG_STATE_HOME
  if (typeof configured === "string" && configured.trim() !== "") {
    return path.resolve(expandHome(configured, home))
  }
  return path.join(home, ".local", "state")
}

async function assertOutsideGitWorkspace({ realStateHome, storeDir, realDeskRoot, naming }) {
  const { label, subject } = naming
  if (isPathContained(realDeskRoot, storeDir)) {
    throw new Error(
      `${label}: refusing to write private ${subject} inside the desk workspace: ${storeDir}. ` +
        `The desk workspace is a Git checkout; private ${subject} must stay out of it.`,
    )
  }
  let cursor = realStateHome
  while (true) {
    await assertNotGitCheckout(cursor, naming)
    const parent = path.dirname(cursor)
    if (parent === cursor) return
    cursor = parent
  }
}

async function assertNotGitCheckout(dir, naming) {
  const { label, subject } = naming
  if ((await lstatIfPresent(path.join(dir, ".git"), naming)) !== null) {
    throw new Error(
      `${label}: refusing to write private ${subject} inside the Git checkout at ${dir}. ` +
        "Point XDG_STATE_HOME at a directory that is not under version control.",
    )
  }
}

async function ensureOwnerOnlyDirectory(dir, platform, naming) {
  const { label, subject } = naming
  let existing = await lstatIfPresent(dir, naming)
  let created = false
  if (existing === null) {
    try {
      await fs.mkdir(dir, { mode: OWNER_ONLY_DIR_MODE })
      created = true
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    existing = await fs.lstat(dir)
  }
  if (existing.isSymbolicLink()) {
    throw new Error(
      `${label}: private ${subject} path component is a symlink and will not be used: ${dir}`,
    )
  }
  if (!existing.isDirectory()) {
    throw new Error(`${label}: private ${subject} path component is not a directory: ${dir}`)
  }
  if (platform !== "win32") {
    clearExtendedAcl(dir, platform, naming)
    if ((existing.mode & 0o777) !== OWNER_ONLY_DIR_MODE) {
      await fs.chmod(dir, OWNER_ONLY_DIR_MODE)
    }
  }
  return created
}

function clearExtendedAcl(target, platform, naming) {
  if (platform !== "darwin") return
  const { label, subject } = naming
  const options = { encoding: "utf8", timeout: 5000, maxBuffer: 65536 }
  // macOS ACL grants can survive chmod 0700/0600. Restrict only our own paths.
  childProcess.execFileSync("/bin/chmod", ["-N", target], options)
  const listing = childProcess.execFileSync("/bin/ls", ["-ldeq", target], options)
  if (/^\s*\d+:/mu.test(listing)) {
    throw new Error(`${label}: private ${subject} path retains an extended ACL: ${target}`)
  }
}

async function realPathOrThrow(candidate, reason, naming) {
  try {
    return await fs.realpath(candidate)
  } catch (error) {
    throw new Error(`${naming.label}: ${reason}: ${candidate} (${error.code})`)
  }
}

async function lstatIfPresent(candidate, naming) {
  const { label, subject } = naming
  try {
    return await fs.lstat(candidate)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw new Error(
      `${label}: private ${subject} path ${candidate} could not be inspected (${error.code})`,
    )
  }
}
