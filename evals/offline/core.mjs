import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const plainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const nonblank = value => typeof value === "string" && value.trim().length > 0;
export const hashString = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function canonicalJson(value) {
  function ordered(input) {
    if (Array.isArray(input)) return input.map(ordered);
    if (plainObject(input)) return Object.fromEntries(Object.keys(input).sort().map(key => [key, ordered(input[key])]));
    return input;
  }
  return JSON.stringify(ordered(value));
}
export function requireCondition(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code, exitCode: 4 });
}
export function exactKeys(value, required, optional = []) {
  return plainObject(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function relativeName(value) {
  requireCondition(nonblank(value) && value.length <= 4096 && !path.isAbsolute(value) && !value.includes("\\") && !value.includes("\0") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "INVALID_PATH", "Expected a confined relative file path");
  return value;
}
export function absoluteRoot(value) {
  requireCondition(typeof value === "string" && path.isAbsolute(value) && !value.includes("\0") && !value.includes("\\") && !value.split("/").some(part => part === "." || part === ".."), "INVALID_ROOT", "Expected an absolute root without traversal");
  return path.resolve(value);
}
export function overlaps(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}
export function pathIdentities(value, allowMissing = false) {
  const absolute = absoluteRoot(value);
  const parts = absolute.split(path.sep).filter(Boolean);
  const identities = [];
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current, { bigint: true }); }
    catch (error) {
      if (allowMissing && error.code === "ENOENT") break;
      throw error;
    }
    requireCondition(!stat.isSymbolicLink(), "LINK_NOT_ALLOWED", "Symbolic links are not permitted in a confined path");
    identities.push(`${current}:${stat.dev}:${stat.ino}:${stat.mode}`);
  }
  return identities;
}
export function confinedPath(root, name) {
  return path.join(absoluteRoot(root), relativeName(name));
}
export function readRegular(root, name, maxBytes = MAX_FILE_BYTES) {
  requireCondition(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= MAX_FILE_BYTES, "INVALID_LIMIT", "Invalid regular-file byte limit");
  const filename = confinedPath(root, name);
  const ancestors = pathIdentities(filename);
  const lexical = fs.lstatSync(filename, { bigint: true });
  requireCondition(lexical.isFile() && lexical.nlink === 1n, "REGULAR_FILE_REQUIRED", "Expected a single-link regular file before opening");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    requireCondition(before.isFile() && before.nlink === 1n, "REGULAR_FILE_REQUIRED", "Expected a single-link regular file");
    requireCondition(before.size <= BigInt(maxBytes), "FILE_TOO_LARGE", "Regular file exceeds its byte limit");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    let count;
    do {
      count = fs.readSync(fd, buffer, length, buffer.length - length, length);
      length += count;
    } while (count > 0 && length < buffer.length);
    const after = fs.fstatSync(fd, { bigint: true });
    requireCondition(length === Number(before.size) && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && after.nlink === 1n && JSON.stringify(ancestors) === JSON.stringify(pathIdentities(filename)), "FILE_CHANGED", "File or path changed while it was being read");
    const bytes = buffer.subarray(0, length);
    return { bytes, sha256: sha256(bytes), mode: Number(before.mode & 0o777n), identity: `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}:${before.ctimeNs}` };
  } finally { fs.closeSync(fd); }
}
export function textBytes(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  requireCondition(!text.includes("\0"), "BINARY_NOT_ALLOWED", "NUL bytes are not admitted as text evidence");
  return text;
}
export function readRawReference(ref, readArtifact) {
  requireCondition(plainObject(ref) && hashString(ref.sha256) && typeof readArtifact === "function", "INVALID_RAW_REFERENCE", "A raw reference requires a hash and an artifact reader");
  relativeName(ref.path);
  const bytes = readArtifact(ref.path);
  requireCondition(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE_BYTES && sha256(bytes) === ref.sha256, "RAW_REFERENCE_MISMATCH", "Raw artifact bytes do not match the reference");
  return bytes;
}
export function parseRawJson(bytes) {
  const parsed = JSON.parse(textBytes(bytes));
  const pending = [[parsed, 0]];
  let nodes = 0;
  while (pending.length > 0) {
    const [value, depth] = pending.pop();
    nodes += 1;
    requireCondition(depth <= 64 && nodes <= 100000, "JSON_STRUCTURE_LIMIT", "JSON artifacts are limited to 64 levels and 100000 values");
    if (value !== null && typeof value === "object") for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  return parsed;
}
export function listRegularFiles(root, { maxFiles = 4096, maxTotalBytes = 1073741824, maxFileBytes = MAX_FILE_BYTES } = {}) {
  requireCondition(Number.isSafeInteger(maxFiles) && maxFiles > 0 && maxFiles <= 4096 && Number.isSafeInteger(maxTotalBytes) && maxTotalBytes > 0 && maxTotalBytes <= 1073741824 && Number.isSafeInteger(maxFileBytes) && maxFileBytes > 0 && maxFileBytes <= MAX_FILE_BYTES, "INVALID_INVENTORY_LIMIT", "Expected bounded file count, per-file bytes and aggregate bytes");
  pathIdentities(root);
  const result = [];
  let totalBytes = 0;
  let entries = 0;
  function walk(directory, prefix, depth) {
    requireCondition(depth <= 64, "INVENTORY_LIMIT", "Artifact directories exceed the traversal depth bound");
    const handle = fs.opendirSync(directory);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        entries += 1;
        requireCondition(entries <= 8192, "INVENTORY_LIMIT", "Artifact directories exceed the entry-count bound");
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        requireCondition(!entry.isSymbolicLink(), "LINK_NOT_ALLOWED", "Inventory cannot contain symbolic links");
        if (entry.isDirectory()) walk(path.join(directory, entry.name), name, depth + 1);
        else {
          requireCondition(entry.isFile(), "REGULAR_FILE_REQUIRED", "Inventory cannot contain special files");
          const size = fs.lstatSync(path.join(directory, entry.name)).size;
          requireCondition(result.length < maxFiles && totalBytes + size <= maxTotalBytes, "INVENTORY_LIMIT", "Artifact inventory exceeds its file-count or aggregate-byte bound");
          const member = readRegular(root, name, maxFileBytes);
          totalBytes += member.bytes.length;
          requireCondition(totalBytes <= maxTotalBytes, "INVENTORY_LIMIT", "Artifact bytes grew beyond the aggregate bound");
          result.push({ path: name, bytes: member.bytes.length, mode: member.mode, sha256: member.sha256 });
        }
      }
    } finally { handle.closeSync(); }
  }
  walk(root, "", 0);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}
