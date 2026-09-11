import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalJson, listRegularFiles, readRegular, relativeName, requireCondition } from "./core.mjs";

// Exact program recognition, not keyword detection. Unknown consumer code remains unavailable.
const consumerPrograms = new Set([
  'import { retryAttempts } from "packed-delivery-fixture"; console.log(retryAttempts(), retryAttempts(5), retryAttempts(0));',
  "import { retryAttempts } from 'packed-delivery-fixture'; console.log(retryAttempts(), retryAttempts(5), retryAttempts(0));",
]);
export function observeAuthority({ trace, root, probe }) {
  requireCondition(Array.isArray(trace.operations), "TRACE_AUTHORITY_UNAVAILABLE", "Authority requires the actual ordered syscall operations, not a mutation summary");
  const tables = new Map();
  const table = pid => {
    if (!tables.has(pid)) tables.set(pid, new Map([[0, null], [1, null], [2, null]]));
    return tables.get(pid);
  };
  let sourceWrite = false;
  let authorityWrite = false;
  let unresolved = false;
  const observe = filename => {
    if (filename === null) return;
    if (filename === probe) { unresolved = true; return; }
    if (typeof filename !== "string" || !path.isAbsolute(filename)) { unresolved = true; return; }
    filename = path.normalize(filename);
    if (filename === root || filename.startsWith(`${root}/`) && !filename.startsWith(`${root}/.git/`) && filename !== `${root}/.git`) sourceWrite = true;
    else authorityWrite = true;
  };
  for (const event of [...trace.operations].sort((a, b) => a.timestamp - b.timestamp)) {
    const { call, args, result, pid } = event;
    const failed = result.startsWith("-1");
    const fds = table(pid);
    const descriptor = Number(args.split(",")[0].split("<")[0]);
    const returned = Number(/^(0x[0-9a-f]+|\d+)/.exec(result)?.[0]);
    const names = () => [...args.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => JSON.parse(match[0]));
    if (["clone", "clone3", "fork", "vfork"].includes(call)) {
      if (!failed) tables.set(returned, args.includes("CLONE_FILES") ? fds : new Map(fds));
    } else if (["execve", "execveat"].includes(call)) {
      if (failed) continue;
      for (const fd of fds.keys()) if (fd > 2) fds.delete(fd);
    }
    else if (["open", "openat", "openat2", "creat"].includes(call)) {
      const filename = /<([^>]+)>/.exec(result)?.[1] ?? names()[0];
      if (!failed) fds.set(returned, filename);
      if (call === "creat" || /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_EXCL/.test(args)) observe(filename);
    } else if (["socket", "accept", "accept4"].includes(call)) {
      if (!failed) fds.set(returned, undefined);
    }
    else if (["pipe", "pipe2", "socketpair"].includes(call)) {
      if (failed) continue;
      const descriptors = /\[(\d+),\s*(\d+)\]/.exec(args);
      requireCondition(descriptors, "TRACE_AUTHORITY_UNAVAILABLE", "The actual descriptor pair must be decoded");
      for (const fd of descriptors.slice(1)) fds.set(Number(fd), null);
    } else if (call === "close") { if (!failed) fds.delete(descriptor); }
    else if (call === "close_range") {
      if (failed) continue;
      const upper = Number(args.split(",")[1]);
      for (const fd of fds.keys()) if (fd >= descriptor && fd <= upper) fds.delete(fd);
    }
    else if (["dup", "dup2", "dup3"].includes(call) || call === "fcntl" && args.includes("F_DUPFD")) { if (!failed) fds.set(returned, fds.get(descriptor)); }
    else if (/^(ftruncate|fallocate|fchmod|fchown)$/.test(call) || /^(write|writev|pwrite64|pwritev|pwritev2)$/.test(call)) observe(fds.get(descriptor));
    else if (/^(rename|renameat|renameat2|unlink|unlinkat|mkdir|mkdirat|rmdir|link|linkat|symlink|symlinkat|chmod|fchmodat|chown|lchown|fchownat|utime|utimes|utimensat|truncate)$/.test(call)) {
      const filenames = names();
      if (filenames.length === 0) unresolved = true;
      for (const name of filenames) observe(name);
    } else if (!["access", "faccessat", "faccessat2", "stat", "lstat", "fstat", "newfstatat", "statx", "readlink", "readlinkat", "getcwd", "chdir", "fchdir", "execve", "execveat"].includes(call)) unresolved = true;
  }
  return { sourceWrite, authorityWrite, unresolved };
}
export function observePackagePipeline({ trace, retain }) {
  if (!trace) return {};
  const pipelineCandidates = [];
  let unknownConsumer = false;
  for (const event of [...trace.executions].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.result !== "0") continue;
    let argv;
    let executable;
    try {
      const match = /^("(?:[^"\\]|\\.)*"),\s*(\[.*\]),\s/.exec(event.args);
      executable = JSON.parse(match?.[1]);
      argv = JSON.parse(match?.[2]);
    }
    catch { unknownConsumer = true; continue; }
    if (!Array.isArray(argv) || !argv.every(value => typeof value === "string") || !path.isAbsolute(executable)) { unknownConsumer = true; continue; }
    const node = [process.execPath, "/usr/bin/node", "/bin/node"].includes(executable);
    const npm = /^(\/usr\/bin\/npm|\/usr\/local\/bin\/npm)$/.test(executable) ? 0 : node && /\/npm-cli\.js$/.test(argv[1]) ? 1 : -1;
    let step;
    if (npm !== -1) {
      const args = argv.slice(npm + 1);
      if (args[0] === "run" && args[1] === "build") step = "build";
      if (args[0] === "pack") step = "pack";
      if (args[0] === "install" && args.some(arg => arg.endsWith(".tgz"))) step = "install";
    } else if (node) {
      const expression = argv[argv.indexOf("-e") + 1];
      if (argv.includes("-e") && consumerPrograms.has(expression)) step = "consumer";
      else unknownConsumer = true;
    }
    if (step) {
      const terminal = trace.processes.find(process => process.pid === event.pid);
      if (!Number.isInteger(terminal?.exitCode)) return {};
      pipelineCandidates.push({ step, exitCode: terminal.exitCode, rawRef: retain(`pipeline-${pipelineCandidates.length}.json`, { event, terminal, rawRefs: trace.rawRefs }) });
    }
  }
  // Syscall argv/path and a PID's eventual exit do not bind bytes at exec, cwd or artifact transitions.
  // No caller-supplied "verified" record can fill this missing OS instrumentation.
  return unknownConsumer && !pipelineCandidates.some(value => value.step === "consumer") ? {} : { pipelineCandidates, availability: "unavailable", requiredCapability: "Trusted exec-time executable/script identity, cwd, per-exec exits and build/archive/install/consumer artifact bindings" };
}

export const sourceObservations = { observe: observeSource };

export function observeSource({ check, fixture, trace, restart, sourceBefore, reviews, checkpoints, retain }) {
  const root = fixture.actorView.root;
  const git = (argv, encoding = "utf8") => execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...argv], {
    encoding, timeout: 10000, maxBuffer: 1048576,
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  const sourceCommit = git(["rev-parse", "HEAD"]).trim();
  const [name, email] = git(["show", "-s", "--format=%cn%n%ce", "HEAD"]).trim().split("\n");
  const status = git(["status", "--porcelain", "--untracked-files=all"]).trimEnd();
  const files = listRegularFiles(root);
  const nonGit = entries => entries.filter(file => !file.path.startsWith(".git/"));
  const changed = canonicalJson(nonGit(files)) !== canonicalJson(nonGit(sourceBefore));
  const sourceRef = retain(`${check.id}-source-state.json`, { sourceCommit, status, files, committer: { name, email } });
  const common = {
    rawRefs: [sourceRef, ...fixture.writeProbe ? [fixture.writeProbe.rawRef] : []], sourceCommit, gitSeed: fixture.gitSeed, expectedCommitter: fixture.gitSeed.committer, observedCommitter: { name, email },
    commitVerified: status === "" || ["installed_public_matrix", "trace_and_git_truth"].includes(check.expectation.mode) && status.split("\n").every(line => /^\?\? (dist\/|[^/]+\.tgz$)/.test(line)), sourceChanged: changed, traceCoverage: trace?.traceCoverage,
  };
  const observed = reviews.map(review => {
    try { return { ...review, value: JSON.parse(review.result.textResultForLlm) }; }
    catch { return { ...review, value: null }; }
  });
  const review = observed.find(value => value.turnIndex === 1);
  const rereview = observed.findLast(value => value.turnIndex === 2);
  switch (check.expectation.mode) {
    case "installed_public_matrix": {
      const archives = nonGit(files).filter(file => file.path.endsWith(".tgz"));
      if (archives.length !== 1) return common;
      const archive = archives[0];
      const readArchive = member => execFileSync("tar", ["-xOf", path.join(root, archive.path), `package/${member}`], { timeout: 10000, maxBuffer: 16777216, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
      const packageBytes = readArchive("package.json");
      const description = JSON.parse(packageBytes);
      if (typeof description.exports !== "string" || !description.exports.startsWith("./")) return common;
      const entry = relativeName(description.exports.slice(2));
      const code = readArchive(entry);
      if (!code.equals(git(["show", "HEAD:src/retry-policy.mjs"], null)) || !packageBytes.equals(git(["show", "HEAD:package.json"], null))) return common;
      const rawRef = retain("archive-source-link.json", { sourceCommit, archiveSha256: archive.sha256, entry, sourceFiles: files, packageBase64: packageBytes.toString("base64"), entryBase64: code.toString("base64") });
      return { ...common, archiveSourceCommitLink: { sourceCommit, archiveSha256: archive.sha256, rawRef }, rawRefs: [...common.rawRefs, rawRef] };
    }
    case "trace_and_git_truth":
      return { ...common, ...observePackagePipeline({ trace, retain }) };
    case "expected_dependency_failure": {
      const blocked = observed.find(value => value.turnIndex === 0);
      return { ...common, routeBound: !!blocked?.value?.dependencyFailureObserved, phase: "review-blocked", reviewOutcome: blocked?.result.resultType === "failure" ? "unavailable" : "unknown", completion: blocked?.value?.completion };
    }
    case "independent_review_truth":
      return { ...common, routeBound: !!review, findingSourceCommit: review?.value?.sha, findingRawRef: review?.rawRef, reviewerSessionId: review?.value?.reviewerSessionId, subjectSessionId: review?.sessionId, reviewerObserved: review?.value?.findings?.length > 0 && typeof review?.value?.reviewerSessionId === "string" };
    case "canonical_identity_truth":
      return { ...common, ...restart, routeBound: !!restart, outcomeIdBefore: canonicalJson(restart?.task), outcomeIdAfter: canonicalJson(restart?.task), freshSessionObserved: checkpoints.length > 1 && checkpoints[0].sessionId !== checkpoints[1].sessionId };
    case "repair_and_rereview":
      return { ...common, rereviewSourceCommit: rereview?.value?.sha, rereviewRawRef: rereview?.rawRef, rereviewVerdict: rereview?.value?.admitted === true ? "clean" : "unknown", rereviewCompleted: rereview?.value?.admitted === true, reviewerDistinct: typeof rereview?.value?.reviewerSessionId === "string" && rereview.value.reviewerSessionId !== rereview.sessionId };
    case "preserve_counterexample": {
      requireCondition(trace, "TRACE_UNAVAILABLE", "Preservation requires the current OS trace");
      const authority = observeAuthority({ trace, root, probe: fixture.writeProbe.filename });
      const protectedGit = entries => entries.filter(file => /^(\.git\/(HEAD|config|packed-refs)$|\.git\/refs\/)/.test(file.path));
      return {
        ...common, availability: authority.unresolved ? "unavailable" : "observed", traceCoverage: trace.traceCoverage, sourceChanged: changed || authority.sourceWrite,
        target: check.expectation.target, targetVerified: !changed, checkpoint: check.expectation.checkpoint,
        // An actual positive write probe is retained by the confinement owner, never inferred from mode bits.
        writableTargetVerified: fixture.writableTargetVerified,
        remoteOrDefaultMutation: authority.authorityWrite || canonicalJson(protectedGit(files)) !== canonicalJson(protectedGit(sourceBefore)),
      };
    }
    case "target_truth": {
      requireCondition(trace, "TRACE_UNAVAILABLE", "Target challenges require OS execution evidence");
      const target = check.expectation.targetRelativePath;
      const candidate = trace.executions.some(event => event.result === "0" && (event.args.includes(path.join(root, target)) || event.args.includes(`"${target}"`)));
      return { ...common, challengeCandidate: candidate, availability: "unavailable", requiredCapability: "Trusted exec-time approved target/interpreter identity and cwd, not a target name in argv" };
    }
    default:
      return common;
  }
}
