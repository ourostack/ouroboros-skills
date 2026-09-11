import fs from "node:fs";
import path from "node:path";
import { overlaps, requireCondition, sha256 } from "./core.mjs";
import { captureBoundedCommand } from "./output.mjs";

function launcherExecution(result) {
  const unavailable = { status: "unavailable" };
  if (result.status !== "exited" || result.signal !== null) return unavailable;
  try {
    const bytes = result.statusPipe.bytes.toString("utf8");
    if (!bytes.endsWith("\n")) return unavailable;
    const rows = bytes.trimEnd().split("\n").map(line => JSON.parse(line));
    if (rows.length !== 2) return unavailable;
    const pid = rows[0]?.["child-pid"];
    const exitCode = rows[1]?.["exit-code"];
    if (!Number.isSafeInteger(pid) || pid <= 0 || result.cleanup.ownedSpawns.some(row => row.pid === pid) || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255 || exitCode !== result.exitCode) return unavailable;
    return { status: "observed", childPid: pid, shellExitCode: exitCode, scope: "launcher-reported-initial-child-exit-only" };
  } catch { return unavailable; }
}

// A PID namespace, not a process group: setsid/double-fork cannot escape its init's lifetime.
export async function captureConfinedChecker({ executable, argv, cwd, env, limits, signal, workRoot, subject, checkerRoot }) {
  requireCondition(process.platform === "linux", "CHECKER_OS_BOUNDARY_REQUIRED", "Checker execution requires Linux user/mount/PID/network namespaces and the owned bubblewrap launcher; controller-identity execution is forbidden");
  const launcher = "/usr/bin/bwrap";
  let identity;
  try { identity = fs.lstatSync(launcher); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    requireCondition(false, "CHECKER_OS_BOUNDARY_REQUIRED", "The maintained /usr/bin/bwrap namespace launcher is unavailable");
  }
  requireCondition(identity.isFile() && identity.uid === 0 && (identity.mode & 0o6022) === 0, "CHECKER_OS_BOUNDARY_REQUIRED", "The checker launcher must be a root-owned non-setid executable, not a link or writable candidate");
  const launcherSha256 = sha256(fs.readFileSync(launcher));
  const runtimeRoot = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
  const mounts = [...new Set(["/usr", "/bin", "/lib", "/lib64", runtimeRoot].filter(root => fs.existsSync(root)))];
  requireCondition(mounts.every(root => root !== "/" && [workRoot, subject, checkerRoot].every(other => !overlaps(root, other))), "CHECKER_OS_BOUNDARY_REQUIRED", "Runtime mounts must be separate from all candidate and checker inputs");
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534", "--clearenv"];
  // bwrap closes this monitor-only descriptor in the sandbox child before exec.
  args.push("--json-status-fd", "3");
  for (const root of mounts) args.push("--ro-bind", root, root);
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind", workRoot, workRoot, "--ro-bind", subject, subject, "--ro-bind", checkerRoot, checkerRoot, "--chdir", cwd);
  for (const [name, value] of Object.entries(env)) args.push("--setenv", name, value);
  args.push("--", executable, ...argv);
  const result = await captureBoundedCommand({ executable: launcher, argv: args, cwd: workRoot, env: { PATH: "/usr/bin:/bin" }, limits, signal, statusPipe: true });
  // The launcher reports child exit, not a kernel exec event, assertion, identity or descendant proof.
  return { ...result, launcher: { path: launcher, sha256: launcherSha256, identityScope: "prelaunch-file-only", namespace: "user,mount,pid,network,ipc,uts", execution: launcherExecution(result), nativeQualified: false } };
}

// The controller owns this dependency. Test transports replace it only in the test process.
export const checkerProcess = { capture: captureConfinedChecker };
