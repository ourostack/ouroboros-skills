import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const NATIVE_ROLE_UID = 65534;
export const NATIVE_NODE_OPTIONS = "--disable-sigusr1 --import=/run/role-guard/native-role-entry.mjs";
export const NATIVE_ROLE_ENV = Object.freeze({ NODE_OPTIONS: NATIVE_NODE_OPTIONS, OFFLINE_ROLE_OBSERVATIONS: "/run/controller/role-observations" });

export function prepareNativeRole({ filesystem = fs } = {}) {
  const root = "/work/native-runtime";
  for (const directory of [root, ...["home", "state", "work", "runtime-work"].map(name => path.join(root, name))]) {
    filesystem.mkdirSync(directory, { mode: 0o700 });
    filesystem.chownSync(directory, NATIVE_ROLE_UID, NATIVE_ROLE_UID);
  }
  const observations = NATIVE_ROLE_ENV.OFFLINE_ROLE_OBSERVATIONS;
  filesystem.mkdirSync(observations, { mode: 0o700 });
  const guard = "/run/role-guard";
  filesystem.mkdirSync(guard, { mode: 0o755 });
  for (const name of ["native-identity.mjs", "native-role-entry.mjs", "native-role-probe-entry.mjs"]) {
    const source = path.join(path.dirname(fileURLToPath(import.meta.url)), name);
    const target = path.join(guard, name);
    filesystem.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    filesystem.chmodSync(target, 0o444);
  }
  return { root, env: NATIVE_ROLE_ENV };
}

export function probeNativeRole({ pid, timeoutMs, execute = spawnSync }) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Object.assign(new Error("A native role probe requires an exact PID and positive timeout"), { code: "NATIVE_ROLE_UNPROTECTED" });
  const args = [`--reuid=${NATIVE_ROLE_UID}`, `--regid=${NATIVE_ROLE_UID}`, "--clear-groups", "--no-new-privs", process.execPath, "/run/role-guard/native-role-probe-entry.mjs", String(pid)];
  const execution = execute("/usr/bin/setpriv", args, {
    shell: false, encoding: null, env: { HOME: "/work/native-runtime/home", PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16384,
  });
  if (execution.error?.code === "ETIMEDOUT") throw Object.assign(new Error("The native role probe exhausted the work deadline"), { code: "NATIVE_DEADLINE" });
  if (execution.status !== 0 || execution.error || !Buffer.isBuffer(execution.stdout) || !Buffer.isBuffer(execution.stderr)) throw Object.assign(new Error("The native role probe did not return complete raw process evidence"), { code: "NATIVE_ROLE_UNPROTECTED" });
  const observation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(execution.stdout));
  const proof = { protected: true, observation, capture: { stdoutBase64: execution.stdout.toString("base64"), stderrBase64: execution.stderr.toString("base64"), exitCode: execution.status } };
  if (!validateNativeRoleProbe(proof)) throw Object.assign(new Error("The native process state is readable, missing, differently owned or privilege regain is possible"), { code: "NATIVE_ROLE_UNPROTECTED" });
  return proof;
}

export function validateNativeRoleProbe(proof) {
  try {
    const { capture, observation } = proof;
    if (proof.protected !== true || capture.exitCode !== 0 || !observation) return false;
    for (const name of ["stdoutBase64", "stderrBase64"]) {
      if (typeof capture[name] !== "string" || capture[name].length > 21848 || Buffer.from(capture[name], "base64").toString("base64") !== capture[name]) return false;
    }
    const actual = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(capture.stdoutBase64, "base64")));
    const keys = ["probeUid", "targetUid", "environ", "memory", "descriptor", "rootRegain"];
    if (!actual || Object.keys(actual).length !== keys.length || Object.keys(observation).length !== keys.length || !keys.every(key => actual[key] === observation[key])) return false;
    return actual.probeUid === NATIVE_ROLE_UID && actual.targetUid === NATIVE_ROLE_UID && ["EACCES", "EPERM"].includes(actual.environ) && ["EACCES", "EPERM"].includes(actual.memory) && ["EACCES", "EPERM"].includes(actual.descriptor) && actual.rootRegain === "EPERM";
  } catch { return false; }
}

export function inspectNativeRole({ pid, os = process, filesystem = fs }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("An exact positive native PID is required");
  const status = filesystem.readFileSync(`/proc/${pid}/status`, "utf8");
  const uids = /^Uid:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(status);
  const targetUid = uids && uids.slice(1).every(uid => Number(uid) === NATIVE_ROLE_UID) ? NATIVE_ROLE_UID : null;
  const attemptOpen = filename => {
    let fd;
    try {
      fd = filesystem.openSync(filename, "r");
    } catch (error) { return error.code; }
    try { filesystem.closeSync(fd); }
    catch { return "opened-close-failed"; }
    return "opened";
  };
  let descriptor;
  try { filesystem.readlinkSync(`/proc/${pid}/fd/0`); descriptor = "readable"; }
  catch (error) { descriptor = error.code; }
  let rootRegain;
  try { os.setuid(0); rootRegain = "succeeded"; }
  catch (error) { rootRegain = error.code; }
  return { probeUid: os.getuid(), targetUid, environ: attemptOpen(`/proc/${pid}/environ`), memory: attemptOpen(`/proc/${pid}/mem`), descriptor, rootRegain };
}

export function enterNativeRole({ observationPath, os = process, filesystem = fs }) {
  const requireRole = (condition, message) => {
    if (!condition) throw Object.assign(new Error(message), { code: "NATIVE_ROLE_UNPROTECTED" });
  };
  requireRole(os.platform === "linux", "The native role transition requires Linux");
  const beforeUid = os.getuid();
  if (beforeUid === NATIVE_ROLE_UID) return { transitioned: false };
  requireRole(beforeUid === 0, "The native role must start in its controlled privileged launcher");
  requireRole(typeof observationPath === "string" && path.isAbsolute(observationPath), "The native role requires its private absolute observation path");
  requireRole(os.env.NODE_OPTIONS === NATIVE_NODE_OPTIONS, "The native role requires the fixed inspector-disabled preload");
  const fd = filesystem.openSync(observationPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let failure;
  try {
    // Dropping uid before exec is not equivalent: exec restores dumpability. This transition stays inside the already-executed Node process.
    os.setgroups([]);
    os.setgid(NATIVE_ROLE_UID);
    os.setuid(NATIVE_ROLE_UID);
    const status = filesystem.readFileSync("/proc/self/status", "utf8");
    const capabilitiesEffective = /^CapEff:\s*([a-f0-9]+)$/mi.exec(status)?.[1];
    const noNewPrivileges = /^NoNewPrivs:\s*1$/m.test(status);
    requireRole(os.getuid() === NATIVE_ROLE_UID && os.getgid() === NATIVE_ROLE_UID && os.getgroups().every(group => group === NATIVE_ROLE_UID), "The native identity transition did not complete");
    requireRole(capabilitiesEffective === "0000000000000000" && noNewPrivileges, "The native role retains capabilities or can regain privilege");
    const observation = { schemaVersion: 1, pid: os.pid, beforeUid, uid: os.getuid(), gid: os.getgid(), capabilitiesEffective, noNewPrivileges, inspectorSignalDisabled: true };
    filesystem.writeFileSync(fd, `${JSON.stringify(observation)}\n`);
    return { transitioned: true, observation };
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    try { filesystem.closeSync(fd); }
    catch (error) {
      if (failure) throw new AggregateError([failure.error, error], "Native identity transition and descriptor cleanup failed", { cause: failure.error });
      throw error;
    }
  }
}
