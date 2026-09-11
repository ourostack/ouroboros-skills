import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readWriterTrace, tracedConnection } from "../writer-trace.mjs";
import { workRoot } from "./helpers/paths.mjs";

const root = workRoot("writer-trace");
let sequence = 0;
function directory(content, name = "syscalls.123") {
  const dir = path.join(root, String(++sequence));
  fs.mkdirSync(dir);
  if (content !== undefined) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const retain = (path, bytes) => ({ path, sha256: String(bytes.length).padStart(64, "0") });
test("OS trace invocation preserves the actual native command, environment and raw-buffer redaction", () => {
  const connection = { path: "/usr/bin/node", args: ["/opt/native/index.js"], env: { SECRET: "not copied into trace flags" } };
  const result = tracedConnection({ connection, directory: directory() });
  assert.equal(result.path, "/usr/bin/strace");
  assert.deepEqual(result.args.slice(-3), ["--", connection.path, ...connection.args]);
  assert.equal(result.env, connection.env);
  assert.ok(result.args.includes("--kill-on-exit"));
  assert.ok(result.args.includes("-q"), "Suppress attach/detach messages, not the terminal records required by per-exec outcome capture");
  assert.ok(!result.args.includes("-qq"), "Double quiet suppresses normal exit-status records");
  assert.ok(result.args.some(arg => arg.startsWith("raw=write")));
  assert.equal(tracedConnection({ connection, directory: directory(), executable: "/opt/strace" }).path, "/opt/strace");
  for (const input of [{ connection: { ...connection, path: "relative" }, directory: directory() }, { connection, directory: directory("occupied") }]) assert.throws(() => tracedConnection(input), { code: "TRACE_INPUT_INVALID" });
});
test("synthetic syscall parser controls retain writes, denied authority and child exits, not native qualification", () => {
  const dir = directory([
    '1.1 execve("/bin/node", ["node"], 0x0 /* 2 vars */) = 0',
    '1.2 openat(AT_FDCWD, "file", O_WRONLY|O_CREAT, 0600) = 4</work/file>',
    '1.3 write(0x4, 0xabc, 0x1) = 0x1',
    '1.4 connect(3, 0xabc, 10) = -1 EACCES (Permission denied)',
    '1.5 newfstatat(3, "", 0xabc, 0) = 0',
    '1.5 clone(flags=SIGCHLD) = 124',
    '1.6 --- SIGCHLD {si_signo=SIGCHLD} ---',
    '1.7 exit_group(0) = ?',
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "syscalls.124"), '1.2 creat("other", 0600) = 4\n1.4 +++ killed by SIGTERM +++\n');
  const result = readWriterTrace({ directory: dir, retain, ownedSpawns: [{ pid: 123 }] });
  assert.equal(result.traceCoverage, "complete");
  assert.equal(result.processes.length, 2);
  assert.equal(result.executions.length, 1);
  assert.equal(result.mutations.length, 4);
  assert.equal(result.mutations.find(row => row.call === "connect").succeeded, false);
});
for (const line of ['write(0x1, 0x0, 1) = 1', 'io_uring_setup(8, 0x0) = 4\nexit_group(0) = ?', 'mmap(NULL, 4096, PROT_WRITE, MAP_SHARED, 4, 0) = 0x123\nexit(0) = ?', '<... openat resumed> nonsense\nexit_group(0) = ?']) test(`unresolved syscall evidence stays unavailable: ${line}`, () => {
  assert.equal(readWriterTrace({ directory: directory(line), retain }).traceCoverage, "unavailable");
});
test("missing or foreign trace files are refused rather than becoming an empty clean trace", () => {
  for (const dir of [directory(), directory("not OS data", "claimed-success.json")]) assert.throws(() => readWriterTrace({ directory: dir, retain }), { code: "TRACE_UNAVAILABLE" });
});
test("unfinished records must resume their exact syscall and every cloned child must terminate", () => {
  const first = '1.0 execve("/bin/node", ["node"], 0x0) = 0\n';
  const valid = directory(first + '2.0 openat(AT_FDCWD, "file", O_RDONLY <unfinished ...>\n2.1 <... openat resumed>) = 3</file>\n3.0 +++ exited with 0 +++\n');
  assert.equal(readWriterTrace({ directory: valid, retain, ownedSpawns: [{ pid: 123 }] }).traceCoverage, "complete");
  for (const extra of [
    '2.0 openat(0, <unfinished ...>\n2.1 openat(0, <unfinished ...>\n3.0 exit_group(0) = ?\n',
    '2.0 openat(0, <unfinished ...>\n2.1 <... write resumed>) = 1\n3.0 exit_group(0) = ?\n',
    '2.0 fork() = 125\n3.0 exit_group(0) = ?\n',
    '2.0 not a syscall record\n3.0 exit_group(0) = ?\n',
  ]) assert.equal(readWriterTrace({ directory: directory(first + extra), retain, ownedSpawns: [{ pid: 123 }] }).traceCoverage, "unavailable");
  const orphan = directory(first + "3.0 exit_group(0) = ?\n");
  fs.writeFileSync(path.join(orphan, "syscalls.129"), "1.0 fork() = 130\n3.0 exit_group(0) = ?\n");
  assert.equal(readWriterTrace({ directory: orphan, retain, ownedSpawns: [{ pid: 123 }] }).traceCoverage, "unavailable");
});

test("exec outcomes belong to an image lifetime, never the PID's eventual exit", () => {
  const dir = directory([
    '1.0 execve("/usr/bin/npm", ["npm", "pack"], 0x0) = 0',
    '2.0 execve("/missing", ["node"], 0x0) = -1 ENOENT',
    '3.0 execve("/bin/false", ["npm", "pack"], 0x0) = 0',
    '4.0 exit_group(7) = ?',
    '4.1 +++ exited with 7 +++',
  ].join("\n"));
  const observed = readWriterTrace({ directory: dir, retain, ownedSpawns: [{ pid: 123 }] });
  assert.deepEqual(observed.executions.map(event => event.outcome), [
    { kind: "replaced", timestamp: 3, replacement: "123:2" },
    undefined,
    { kind: "exited", timestamp: 4.1, exitCode: 7, signal: null },
  ]);
  assert.equal(observed.executions[0].executionId, "123:1");
  assert.equal(observed.executions[2].executionId, "123:2");
  assert.equal(observed.executions[0].identity, "unavailable");
});

test("an exit request, interrupted exec, or killed image cannot become a successful exec outcome", () => {
  const first = '1.0 execve("/bin/node", ["node"], 0x0) = 0\n';
  for (const [tail, expected] of [
    ['2.0 exit_group(0) = ?\n', { kind: "unavailable" }],
    ['2.0 +++ killed by SIGKILL +++\n', { kind: "signaled", timestamp: 2, exitCode: null, signal: "SIGKILL" }],
    ['2.0 execve("/bin/true", ["true"], 0x0 <unfinished ...>\n3.0 +++ exited with 0 +++\n', { kind: "unavailable" }],
    ['+++ exited with 0 +++\n', { kind: "unavailable" }],
    ['execve("/bin/true", ["true"], 0x0) = 0\n3.0 +++ exited with 0 +++\n', { kind: "unavailable" }],
  ]) {
    const observed = readWriterTrace({ directory: directory(first + tail), retain, ownedSpawns: [{ pid: 123 }] });
    assert.deepEqual(observed.executions[0].outcome, expected);
  }
});
