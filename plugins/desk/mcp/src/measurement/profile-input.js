import fs from "node:fs"
import path from "node:path"

export const MAX_INPUT_BYTES = 16 * 1024 * 1024

function requireInput(condition, message) {
  if (!condition) throw new Error(message)
}

// Same descriptor/ancestor checks as the offline evidence reader, kept inside the distributed Desk package; references in a snapshot never reach this API.
function pathIdentity(filename) {
  const parts = []
  let cursor = filename
  while (true) {
    const stat = fs.lstatSync(cursor, { bigint: true })
    requireInput(!stat.isSymbolicLink(), "Input path must not contain symbolic links")
    parts.push(`${cursor}:${stat.dev}:${stat.ino}:${stat.mode}`)
    const parent = path.dirname(cursor)
    if (parent === cursor) return parts.join("\n")
    cursor = parent
  }
}

export function readProfileInput(filename) {
  requireInput(typeof filename === "string" && filename.trim() !== "" && !filename.includes("\0"), "Expected an explicit input path")
  const absolute = path.resolve(filename)
  const identity = pathIdentity(absolute)
  const lexical = fs.lstatSync(absolute, { bigint: true })
  requireInput(lexical.isFile() && lexical.nlink === 1n, "Input must be a single-link regular file")
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const before = fs.fstatSync(fd, { bigint: true })
    requireInput(before.isFile() && before.nlink === 1n, "Input must be a single-link regular file")
    requireInput(before.dev === lexical.dev && before.ino === lexical.ino, "Input file changed before opening")
    requireInput(before.size <= BigInt(MAX_INPUT_BYTES), "Input exceeds the 16 MiB byte limit")
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    let count
    do {
      count = fs.readSync(fd, buffer, length, buffer.length - length, length)
      length += count
    } while (count > 0 && length < buffer.length)
    const after = fs.fstatSync(fd, { bigint: true })
    requireInput(length === Number(before.size) && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && after.nlink === 1n && identity === pathIdentity(absolute), "Input file or path changed while reading")
    return buffer.subarray(0, length)
  } finally {
    fs.closeSync(fd)
  }
}
