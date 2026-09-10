import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES, absoluteRoot, hashString, jsonBytes, listRegularFiles, nonblank, overlaps, parseRawJson, pathIdentities, plainObject, readRegular, relativeName, requireCondition, sha256 } from "./core.mjs";

const channels = { stdout: "stdout.raw", stderr: "stderr.raw", "sdk-events": "sdk-events.jsonl", "schema-events": "schema-events.jsonl" };
const reservedFiles = new Set([...Object.values(channels), "receipt.incomplete.json", "receipt.incomplete.pending.json", "stdout.txt", "stderr.txt", "result.md", "result.json", "receipt.json", "inventory.json", "COMMITTED.pending.json", "COMMITTED.json"]);
const statuses = ["passed", "product_failure", "inconclusive", "protocol_failure", "infrastructure_failure", "timed_out", "cancelled", "unavailable"];
const countNames = ["observedRequests", "schemaAcceptedHandlers", "validatorAcceptedReports", "admittedGrades"];
const defaults = { maxStreamBytes: MAX_FILE_BYTES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: 128 * 1024 * 1024, maxFiles: 4096 };
function outputError(code, error, root) {
  return Object.assign(new Error(error.message), { code, exitCode: 3, artifacts: root, cause: error });
}
function validateReceipt(receipt, runId, executionKind) {
  requireCondition(plainObject(receipt) && receipt.schemaVersion === 1 && receipt.runId === runId && statuses.includes(receipt.status) && plainObject(receipt.counts) && countNames.every(key => Number.isSafeInteger(receipt.counts[key]) && receipt.counts[key] >= 0), "INVALID_RUN_RECEIPT", "A run receipt requires scoped status and all four admission counters");
  const admitted = receipt.grade !== null;
  const deterministic = executionKind === "deterministic";
  const semantic = ["passed", "product_failure", "inconclusive"].includes(receipt.status);
  requireCondition(deterministic ? !admitted && receipt.status !== "inconclusive" : admitted === semantic && (!admitted || executionKind === "subject_with_judge"), "UNADMITTED_SEMANTIC_STATUS", "Semantic outcomes require the frozen execution kind and its matching grading route");
  requireCondition(receipt.counts.admittedGrades === Number(admitted) && (!admitted || receipt.counts.validatorAcceptedReports === 1) && receipt.counts.schemaAcceptedHandlers >= Number(admitted) && receipt.counts.observedRequests >= receipt.counts.validatorAcceptedReports && (!deterministic || countNames.every(key => receipt.counts[key] === 0)), "INVALID_ADMISSION_COUNTS", "Receipt counters do not support its grading route");
  requireCondition(!admitted || (plainObject(receipt.grade) && ({ passed: "pass", product_failure: "fail", inconclusive: "investigate" })[receipt.status] === receipt.grade.status), "INVALID_RECEIPT_GRADE", "Only an admitted semantic outcome can carry its corresponding grade");
}
function fileInventory(root, limits) {
  return listRegularFiles(root, limits);
}
export function openRunOutput({ outputRoot, authorizedRoot, protectedRoots, runContext, limits = defaults, io = {} }) {
  const root = absoluteRoot(outputRoot);
  const authorized = absoluteRoot(authorizedRoot);
  requireCondition(root !== authorized && root.startsWith(`${authorized}${path.sep}`) && Array.isArray(protectedRoots) && protectedRoots.every(protectedRoot => !overlaps(root, absoluteRoot(protectedRoot))), "OUTPUT_ROOT_NOT_AUTHORIZED", "Output requires a separate, nonoverlapping authorized root");
  pathIdentities(authorized);
  pathIdentities(root, true);
  requireCondition(!fs.existsSync(root), "OUTPUT_ROOT_NOT_FRESH", "Output roots must be fresh");
  requireCondition(plainObject(runContext) && nonblank(runContext.runId) && nonblank(runContext.cellId) && hashString(runContext.planSha256), "INVALID_RUN_CONTEXT", "Run context must bind a run, cell and frozen plan");
  requireCondition(runContext.executionKind === undefined || ["subject_with_judge", "deterministic"].includes(runContext.executionKind), "INVALID_RUN_CONTEXT", "Declared execution kind must come from the frozen expected cell");
  requireCondition(plainObject(limits) && Object.keys(defaults).every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0) && limits.maxStreamBytes <= limits.maxFileBytes && limits.maxFileBytes <= MAX_FILE_BYTES && limits.maxTotalBytes <= 1073741824 && limits.maxFiles <= 4096, "INVALID_OUTPUT_LIMITS", "Expected bounded stream, file and inventory limits");
  const operations = { ...fs, ...io };
  const context = structuredClone(runContext);
  const frozenLimits = { ...limits };
  let failed = false;
  let committed = false;
  const streamBytes = new Map();
  const streamHashes = new Map([["stdout", sha256(Buffer.alloc(0))], ["stderr", sha256(Buffer.alloc(0))]]);
  const envelope = { schemaVersion: 1, kind: "offline_incomplete", ...context, captureComplete: false, grade: null, counts: Object.fromEntries(countNames.map(key => [key, 0])), limits: frozenLimits };
  const failureReserve = jsonBytes({ ...envelope, error: { code: "\0".repeat(64), message: "\0".repeat(256) } }).length;
  requireCondition(failureReserve <= frozenLimits.maxFileBytes && jsonBytes(envelope).length + failureReserve <= frozenLimits.maxTotalBytes && frozenLimits.maxFiles >= 4, "INVALID_OUTPUT_LIMITS", "Output must reserve bounded atomic failure-envelope space");
  const allocations = new Map();
  let allocatedBytes = 0;
  function allocate(name, bytes, failure) {
    const addedFile = Number(!allocations.has(name));
    const prior = allocations.get(name) ?? 0;
    if (allocatedBytes + bytes - prior > frozenLimits.maxTotalBytes - (failure ? 0 : failureReserve) || allocations.size + addedFile > frozenLimits.maxFiles - (failure ? 0 : 1)) throw outputError("OUTPUT_AGGREGATE_OVERFLOW", new Error("Capture exceeds its aggregate budget and reserved failure-envelope space"), root);
    allocatedBytes += bytes - prior;
    allocations.set(name, bytes);
  }
  function incomplete(error) {
    failed = true;
    envelope.error = { code: String(error.code).slice(0, 64), message: String(error.message).slice(0, 256) };
    try {
      write("receipt.incomplete.pending.json", jsonBytes(envelope), true);
      operations.renameSync(path.join(root, "receipt.incomplete.pending.json"), path.join(root, "receipt.incomplete.json"));
      allocatedBytes -= allocations.get("receipt.incomplete.json");
      allocations.set("receipt.incomplete.json", allocations.get("receipt.incomplete.pending.json"));
      allocations.delete("receipt.incomplete.pending.json");
    }
    catch { /* The original null-grade envelope remains authoritative if its error annotation cannot be written. */ }
  }
  function write(name, value, failure = false) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    requireCondition(bytes.length <= frozenLimits.maxFileBytes, "OUTPUT_FILE_TOO_LARGE", "Output file exceeds its byte bound");
    if (allocations.has(name)) throw Object.assign(new Error("An immutable output artifact already exists"), { code: "EEXIST" });
    allocate(name, bytes.length, failure);
    operations.writeFileSync(path.join(root, name), bytes, { flag: "wx", mode: 0o600 });
  }
  try {
    fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
    pathIdentities(path.dirname(root));
    fs.mkdirSync(root, { mode: 0o700 });
    write("receipt.incomplete.json", jsonBytes(envelope));
    write("stdout.raw", Buffer.alloc(0));
    write("stderr.raw", Buffer.alloc(0));
  } catch (error) { throw outputError("OUTPUT_WRITE_FAILED", error, root); }
  return Object.freeze({
    writeArtifact(name, bytes) {
      requireCondition(!failed && !committed, "OUTPUT_NOT_COMMITTABLE", "A failed or committed run cannot accept artifacts");
      relativeName(name);
      requireCondition(!reservedFiles.has(name) && Buffer.isBuffer(bytes), "INVALID_OUTPUT_ARTIFACT", "Artifact writes require nonreserved names and raw buffers");
      try { write(name, bytes); }
      catch (error) {
        const translated = outputError("OUTPUT_WRITE_FAILED", error, root);
        incomplete(translated);
        throw translated;
      }
    },
    appendRaw(channel, bytes) {
      requireCondition(!failed && !committed, "OUTPUT_NOT_COMMITTABLE", "A failed or committed run cannot accept more capture");
      requireCondition(Object.hasOwn(channels, channel) && Buffer.isBuffer(bytes), "INVALID_RAW_CHANNEL", "Raw capture requires a declared channel and a Buffer");
      const filename = channels[channel];
      try {
        if (!fs.existsSync(path.join(root, filename))) write(filename, Buffer.alloc(0));
        requireCondition(allocations.has(filename), "OUTPUT_STREAM_CHANGED", "An unowned file cannot become a captured stream");
        const member = readRegular(root, filename, frozenLimits.maxFileBytes);
        const prior = streamBytes.get(channel) ?? 0;
        requireCondition(member.bytes.length === prior && member.sha256 === (streamHashes.get(channel) ?? sha256(Buffer.alloc(0))), "OUTPUT_STREAM_CHANGED", "The raw stream changed outside its writer");
        const remaining = Math.max(0, frozenLimits.maxStreamBytes - prior);
        const totalRemaining = Math.max(0, frozenLimits.maxTotalBytes - failureReserve - allocatedBytes);
        const prefix = bytes.subarray(0, Math.min(remaining, totalRemaining));
        allocate(filename, member.bytes.length + prefix.length, false);
        operations.appendFileSync(path.join(root, filename), prefix, { flag: fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, mode: 0o600 });
        streamBytes.set(channel, prior + prefix.length);
        streamHashes.set(channel, sha256(Buffer.concat([member.bytes, prefix])));
        if (prefix.length !== bytes.length) {
          const error = outputError(remaining <= totalRemaining ? "OUTPUT_STREAM_OVERFLOW" : "OUTPUT_AGGREGATE_OVERFLOW", new Error("Raw capture overflowed; only the bounded prefix is retained"), root);
          throw error;
        }
      } catch (error) {
        const translated = ["OUTPUT_STREAM_OVERFLOW", "OUTPUT_AGGREGATE_OVERFLOW"].includes(error.code) ? error : outputError("OUTPUT_WRITE_FAILED", error, root);
        incomplete(translated);
        throw translated;
      }
    },
    commit(receipt) {
      requireCondition(!failed && !committed, "OUTPUT_NOT_COMMITTABLE", "A failed or committed run cannot be committed");
      let publishing = false;
      try {
        validateReceipt(receipt, context.runId, context.executionKind);
        requireCondition((receipt.cellId === undefined || receipt.cellId === context.cellId) && (receipt.planSha256 === undefined || receipt.planSha256 === context.planSha256) && (receipt.executionKind === undefined || receipt.executionKind === context.executionKind), "RECEIPT_CONTEXT_MISMATCH", "Receipt context differs from the frozen run");
        const finalReceipt = { ...receipt, ...context };
        for (const [channel, expectedHash] of streamHashes) requireCondition(readRegular(root, channels[channel], frozenLimits.maxFileBytes).sha256 === expectedHash, "OUTPUT_STREAM_CHANGED", "A captured raw stream changed before publication");
        for (const channel of ["stdout", "stderr"]) write(`${channel}.txt`, readRegular(root, channels[channel], frozenLimits.maxFileBytes).bytes.toString("utf8"));
        write("result.md", `# Offline evaluation: ${receipt.status}\n\nThis view is not the grade authority. Read the receipt only through its final \`COMMITTED.json\` marker and hashed inventory.\n`);
        write("result.json", jsonBytes({ schemaVersion: 1, status: receipt.status, grade: receipt.grade, counts: receipt.counts, publication: "requires_final_commit_marker" }));
        const receiptBytes = jsonBytes(finalReceipt);
        write("receipt.json", receiptBytes);
        const inventoryBytes = jsonBytes({ schemaVersion: 1, files: fileInventory(root, frozenLimits) });
        write("inventory.json", inventoryBytes);
        const marker = {
          schemaVersion: 1, kind: "offline_commit", runId: context.runId,
          inventory: { path: "inventory.json", sha256: sha256(inventoryBytes) },
          receipt: { path: "receipt.json", sha256: sha256(receiptBytes) },
        };
        write("COMMITTED.pending.json", jsonBytes(marker));
        fileInventory(root, frozenLimits);
        publishing = true;
        operations.renameSync(path.join(root, "COMMITTED.pending.json"), path.join(root, "COMMITTED.json"));
        committed = true;
        return readCommittedRun(root);
      } catch (error) {
        const translated = outputError(publishing ? "OUTPUT_FINAL_PUBLISH_FAILED" : "OUTPUT_WRITE_FAILED", error, root);
        incomplete(translated);
        throw translated;
      }
    },
  });
}
export function readCommittedRun(root) {
  const marker = parseRawJson(readRegular(root, "COMMITTED.json").bytes);
  requireCondition(marker.schemaVersion === 1 && marker.kind === "offline_commit" && nonblank(marker.runId) && marker.inventory?.path === "inventory.json" && marker.receipt?.path === "receipt.json", "INVALID_COMMIT_MARKER", "Expected a final run commit marker");
  const inventoryMember = readRegular(root, marker.inventory.path);
  const receiptMember = readRegular(root, marker.receipt.path);
  requireCondition(inventoryMember.sha256 === marker.inventory.sha256 && receiptMember.sha256 === marker.receipt.sha256, "COMMIT_HASH_MISMATCH", "Marker hashes do not match its inventory and receipt");
  const inventory = parseRawJson(inventoryMember.bytes);
  requireCondition(inventory.schemaVersion === 1 && Array.isArray(inventory.files) && inventory.files.length > 0 && new Set(inventory.files.map(entry => entry.path)).size === inventory.files.length, "INVALID_COMMIT_INVENTORY", "Expected a unique, nonempty committed file inventory");
  const actual = listRegularFiles(root);
  const expectedNames = [...inventory.files.map(entry => entry.path), "inventory.json", "COMMITTED.json"].sort();
  requireCondition(JSON.stringify(actual.map(entry => entry.path).sort()) === JSON.stringify(expectedNames), "COMMIT_INVENTORY_MISMATCH", "Run contains missing, extra or duplicate inventory members");
  for (const member of inventory.files) {
    relativeName(member.path);
    const observed = actual.find(entry => entry.path === member.path);
    requireCondition(observed.sha256 === member.sha256 && observed.bytes === member.bytes && observed.mode === member.mode, "COMMITTED_MEMBER_CHANGED", "A committed member's bytes, size or mode changed");
  }
  const receipt = parseRawJson(receiptMember.bytes);
  validateReceipt(receipt, marker.runId, receipt.executionKind);
  return { marker, inventory, receipt, receiptSha256: receiptMember.sha256, inventorySha256: inventoryMember.sha256 };
}
export async function captureBoundedCommand({ executable, argv, cwd, env, limits, signal }) {
  requireCondition(nonblank(executable) && Array.isArray(argv) && argv.length <= 256 && argv.every(value => typeof value === "string" && value.length <= 65536 && !value.includes("\0")) && plainObject(env) && Object.entries(env).every(([key, value]) => nonblank(key) && typeof value === "string" && !key.includes("=") && !key.includes("\0") && !value.includes("\0")), "INVALID_COMMAND", "Command capture requires executable, argv and explicit environment, never a shell string");
  const directory = absoluteRoot(cwd);
  pathIdentities(directory);
  requireCondition(plainObject(limits) && Number.isSafeInteger(limits.maxStreamBytes) && limits.maxStreamBytes > 0 && limits.maxStreamBytes <= MAX_FILE_BYTES && Number.isSafeInteger(limits.timeoutMs) && limits.timeoutMs > 0 && limits.timeoutMs <= 3600000, "INVALID_COMMAND_LIMITS", "Expected finite capture and execution bounds");
  const cleanupMs = limits.cleanupMs ?? 1000;
  requireCondition(Number.isSafeInteger(cleanupMs) && cleanupMs > 0 && cleanupMs <= 30000, "INVALID_COMMAND_CLEANUP_LIMIT", "Command cleanup must also be bounded");
  return new Promise(resolve => {
    const captured = { stdout: [], stderr: [] };
    const lengths = { stdout: 0, stderr: 0 };
    const timers = [];
    const errors = [];
    let child;
    let settled = false;
    let failure = null;
    let stopping = false;
    const spawnIdentity = randomUUID();
    const startedAt = Date.now();
    function finish(exitCode, exitSignal, exited) {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      signal?.removeEventListener("abort", abort);
      const processIdentity = child?.pid ? { pid: child.pid, spawnIdentity } : null;
      resolve({
        status: failure ? failure.status : "exited", exitCode, signal: exitSignal, failure, errors, elapsedMs: Date.now() - startedAt,
        stdout: { bytes: Buffer.concat(captured.stdout), truncated: lengths.stdout >= limits.maxStreamBytes && failure?.code === "COMMAND_OUTPUT_OVERFLOW" },
        stderr: { bytes: Buffer.concat(captured.stderr), truncated: lengths.stderr >= limits.maxStreamBytes && failure?.code === "COMMAND_OUTPUT_OVERFLOW" },
        cleanup: { ownedSpawns: processIdentity ? [processIdentity] : [], exitObservations: processIdentity && exited ? [{ ...processIdentity, exited: true, exitCode, signal: exitSignal }] : [], unverifiedPids: processIdentity && !exited ? [processIdentity.pid] : [], scope: "captured-direct-child-only" },
      });
    }
    function stop(status, code, message) {
      failure ??= { status, code, message };
      if (stopping || settled) return;
      stopping = true;
      child.kill("SIGTERM");
      timers.push(setTimeout(() => child.kill("SIGKILL"), Math.max(1, Math.floor(cleanupMs / 2))));
      timers.push(setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, null, false); }, cleanupMs));
    }
    function abort() { stop("cancelled", "COMMAND_CANCELLED", "The owning command run was cancelled"); }
    if (signal?.aborted) {
      failure = { status: "cancelled", code: "COMMAND_CANCELLED", message: "Cancelled before process creation" };
      finish(null, null, false);
      return;
    }
    child = spawn(executable, argv, { cwd: directory, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    signal?.addEventListener("abort", abort, { once: true });
    for (const channel of ["stdout", "stderr"]) child[channel].on("data", bytes => {
      if (settled) return;
      const prefix = bytes.subarray(0, Math.max(0, limits.maxStreamBytes - lengths[channel]));
      captured[channel].push(Buffer.from(prefix));
      lengths[channel] += prefix.length;
      if (prefix.length !== bytes.length) stop("infrastructure_failure", "COMMAND_OUTPUT_OVERFLOW", "Command output exceeded its raw-byte bound");
    });
    child.once("error", error => {
      errors.push({ code: error.code, message: error.message });
      failure ??= { status: "infrastructure_failure", code: error.code, message: error.message };
      finish(null, null, false);
    });
    child.once("close", (code, exitSignal) => finish(code, exitSignal, true));
    timers.push(setTimeout(() => stop("timed_out", "COMMAND_TIMEOUT", "Command exceeded its outer execution deadline"), limits.timeoutMs));
  });
}
