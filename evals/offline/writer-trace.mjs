import fs from "node:fs";
import path from "node:path";
import { absoluteRoot, pathIdentities, readRegular, requireCondition, sha256 } from "./core.mjs";

// Trace syscall metadata, never buffer contents or the credential-bearing exec environment.
const calls = "%file,%process,close,close_range,dup,dup2,dup3,fcntl,pipe,pipe2,socket,socketpair,accept,accept4,write,writev,pwrite64,pwritev,pwritev2,sendto,sendmsg,sendmmsg,copy_file_range,sendfile,splice,tee,vmsplice,ftruncate,fallocate,fchmod,fchown,mmap,msync,io_uring_setup,connect,bind,mount,umount2,ptrace,process_vm_writev";
const raw = "write,writev,pwrite64,pwritev,pwritev2,sendto,sendmsg,sendmmsg,process_vm_writev,setxattr,lsetxattr,fsetxattr,vmsplice";
export function tracedConnection({ connection, directory, executable = "/usr/bin/strace" }) {
  absoluteRoot(directory);
  pathIdentities(directory);
  requireCondition(fs.readdirSync(directory).length === 0 && path.isAbsolute(connection.path) && Array.isArray(connection.args), "TRACE_INPUT_INVALID", "The OS tracer requires a fresh private directory and the actual native executable invocation");
  return { ...connection, path: executable, args: ["--kill-on-exit", "-ff", "-q", "-ttt", "-yy", "-s", "65536", "-e", `trace=${calls}`, "-e", `raw=${raw}`, "-o", path.join(directory, "syscalls"), "--", connection.path, ...connection.args] };
}

export function readWriterTrace({ directory, retain, ownedSpawns }) {
  const names = fs.readdirSync(directory).sort();
  requireCondition(names.length > 0 && names.length <= 256 && names.every(name => /^syscalls\.[1-9][0-9]*$/.test(name)), "TRACE_UNAVAILABLE", "Only the bounded actual per-process syscall inventory is accepted");
  const processes = [];
  const rawRefs = [];
  let complete = true;
  const mutations = [];
  const executions = [];
  const parents = new Map();
  const operations = [];
  for (const name of names) {
    const member = readRegular(directory, name);
    rawRefs.push(retain(name, member.bytes));
    const lines = member.bytes.toString("utf8").trimEnd().split("\n");
    const pid = Number(name.slice(9));
    let exited = false;
    let exitCode = null;
    let pending = "";
    let activeExec;
    let executionIndex = 0;
    for (const line of lines) {
      let body = line.replace(/^\d+\.\d+ /, "");
      const timestamp = Number(/^\d+\.\d+/.exec(line)?.[0]);
      if (!Number.isFinite(timestamp)) complete = false;
      if (body.endsWith("<unfinished ...>")) {
        if (pending) complete = false;
        pending = body.slice(0, -"<unfinished ...>".length);
        continue;
      }
      const resumed = /^<\.\.\. ([a-z_0-9]+) resumed>(.*)$/.exec(body);
      if (resumed) {
        if (!pending.startsWith(`${resumed[1]}(`)) { complete = false; continue; }
        body = pending + resumed[2];
        pending = "";
      }
      if (/^(exit|exit_group)\(\d+\)\s+= \?$/.test(body) || /^\+\+\+ (exited with \d+|killed by SIG[A-Z0-9]+.*) \+\+\+$/.test(body)) {
        exited = true;
        const code = /^(?:exit|exit_group)\((\d+)\)|^\+\+\+ exited with (\d+)/.exec(body);
        if (code) exitCode = Number(code[1] ?? code[2]);
        if (activeExec && body.startsWith("+++ ") && !pending && Number.isFinite(timestamp)) {
          const signal = /^\+\+\+ killed by (SIG[A-Z0-9]+)/.exec(body)?.[1] ?? null;
          activeExec.outcome = { kind: signal ? "signaled" : "exited", timestamp, exitCode: signal ? null : exitCode, signal };
        }
        continue;
      }
      if (/^--- SIG/.test(body)) continue;
      const match = /^([a-z_0-9]+)\((.*)\)\s+= (.+)$/.exec(body);
      if (!match) { complete = false; continue; }
      const [, call, args, result] = match;
      const event = { pid, call, args, result, timestamp };
      operations.push(event);
      if (["execve", "execveat"].includes(call)) {
        executions.push(event);
        if (result === "0") {
          event.executionId = `${pid}:${++executionIndex}`;
          event.identity = "unavailable";
          event.outcome = { kind: "unavailable" };
          if (activeExec && Number.isFinite(timestamp)) activeExec.outcome = { kind: "replaced", timestamp, replacement: event.executionId };
          activeExec = event;
        }
      }
      if (["clone", "clone3", "fork", "vfork"].includes(call) && /^[1-9][0-9]*$/.test(result)) parents.set(Number(result), pid);
      const effect = /^(write|writev|pwrite64|pwritev|pwritev2|truncate|ftruncate|rename|renameat|renameat2|unlink|unlinkat|mkdir|mkdirat|rmdir|link|linkat|symlink|symlinkat|chmod|fchmodat|chown|lchown|fchownat|utime|utimes|utimensat|copy_file_range|sendfile|connect|bind|mount|umount2|ptrace|process_vm_writev|creat)$/.test(call) || /^(open|openat|openat2)$/.test(call) && /O_(WRONLY|RDWR|CREAT|TRUNC)/.test(args);
      if (effect) mutations.push({ pid, call, args, result, succeeded: !result.startsWith("-1 ") });
      // Unsupported asynchronous/mapped writes and unfinished records cannot prove a negative.
      if (call === "io_uring_setup" || call === "mmap" && /PROT_WRITE/.test(args) && /MAP_SHARED/.test(args)) complete = false;
    }
    complete &&= exited && !pending;
    processes.push({ pid, exited, exitCode, sha256: sha256(member.bytes) });
  }
  const roots = new Set(ownedSpawns?.map(spawn => spawn.pid));
  const reached = new Set([...roots].filter(pid => executions.some(event => event.pid === pid && event.result === "0")));
  for (let index = 0; index < processes.length; index++) for (const [child, parent] of parents) if (reached.has(parent)) reached.add(child);
  complete &&= roots.size > 0 && [...roots].every(pid => processes.some(row => row.pid === pid)) && processes.every(row => reached.has(row.pid)) && [...parents.keys()].every(pid => processes.some(row => row.pid === pid));
  return { traceCoverage: complete ? "complete" : "unavailable", processes, mutations, executions, operations, rawRefs, scope: "OS syscall metadata; writable opens are conservative write-authority observations, not proof of changed bytes." };
}
