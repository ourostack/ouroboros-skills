import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { absoluteRoot, confinedPath, nonblank, overlaps, pathIdentities, readRegular, relativeName, requireCondition, hashString } from "./core.mjs";

const roleRoots = { subject: "actor", held_out: "checker", canonical_fixture_input: "canonical" };
const privateEnvironment = new Set(["CONFIG_FILE", "EVAL_SUBJECT_SNAPSHOT", "CHECKER_CANARY_TOKEN"]);

export async function materializeFixture({ manifest, fixtureId, sourceRoot, roots, actorEnvironment = {}, gitIdentity }) {
  requireCondition(manifest?.schemaVersion === 1 && Array.isArray(manifest.fixtures), "INVALID_MANIFEST", "Expected a versioned fixture manifest");
  const matches = manifest.fixtures.filter(fixture => fixture.id === fixtureId);
  requireCondition(matches.length === 1, "UNKNOWN_FIXTURE", "Fixture identity must resolve exactly once");
  const fixture = matches[0];
  requireCondition(Array.isArray(fixture.files) && fixture.files.length <= 4096 && typeof fixture.requiresAdmittedProducerBinding === "boolean", "INVALID_FIXTURE", "Invalid fixture file inventory or producer-binding declaration");
  const source = absoluteRoot(sourceRoot);
  pathIdentities(source);
  const destinations = Object.fromEntries(Object.values(roleRoots).map(key => [key, absoluteRoot(roots[key])]));
  const allRoots = [source, ...Object.values(destinations)];
  requireCondition(allRoots.every((root, index) => allRoots.slice(index + 1).every(other => !overlaps(root, other))), "OVERLAPPING_ROOTS", "Subject, held-out, canonical and source roots must not overlap");
  for (const root of Object.values(destinations)) {
    pathIdentities(root, true);
    requireCondition(!fs.existsSync(root), "ROOT_NOT_FRESH", "Each role requires a fresh root");
  }
  const inventory = new Set();
  const prepared = fixture.files.map(file => {
    requireCondition(Object.hasOwn(roleRoots, file.role) && hashString(file.sha256), "INVALID_FIXTURE_FILE", "Fixture files require a role and raw-byte hash");
    relativeName(file.targetPath);
    requireCondition(!file.targetPath.split("/").includes(".git"), "RESERVED_FIXTURE_PATH", "Fixture payloads cannot supply Git metadata");
    const key = `${file.role}:${file.targetPath}`;
    requireCondition(!inventory.has(key), "DUPLICATE_FIXTURE_FILE", "Duplicate fixture destination");
    inventory.add(key);
    const member = readRegular(source, file.sourcePath);
    requireCondition(member.sha256 === file.sha256, "FIXTURE_HASH_MISMATCH", "Fixture source bytes differ from the frozen manifest");
    return { file, identity: member.identity };
  });
  requireCondition(gitIdentity && ["authorName", "authorEmail", "committerName", "committerEmail"].every(key => nonblank(gitIdentity[key]) && !/[\r\n<>]/.test(gitIdentity[key])), "GIT_IDENTITY_REQUIRED", "A local seed requires an explicit author and committer");
  for (const root of Object.values(destinations)) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const { file, identity } of prepared) {
    const member = readRegular(source, file.sourcePath);
    requireCondition(member.sha256 === file.sha256 && member.identity === identity, "FIXTURE_SOURCE_CHANGED", "Fixture source changed after its validation pass");
    const destination = confinedPath(destinations[roleRoots[file.role]], file.targetPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    pathIdentities(path.dirname(destination));
    fs.writeFileSync(destination, member.bytes, { flag: "wx", mode: 0o600 });
  }
  const actorRoot = destinations.actor;
  const environment = Object.fromEntries(Object.entries(actorEnvironment).filter(([key]) => !privateEnvironment.has(key)));
  const gitEnvironment = {
    PATH: process.env.PATH, HOME: actorRoot, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: gitIdentity.authorName, GIT_AUTHOR_EMAIL: gitIdentity.authorEmail,
    GIT_COMMITTER_NAME: gitIdentity.committerName, GIT_COMMITTER_EMAIL: gitIdentity.committerEmail,
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = args => execFileSync("git", ["-C", actorRoot, "-c", "core.hooksPath=/dev/null", ...args], { env: gitEnvironment, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--initial-branch=fixture", "--template="]);
  git(["config", "user.name", gitIdentity.committerName]);
  git(["config", "user.email", gitIdentity.committerEmail]);
  git(["config", "core.hooksPath", "/dev/null"]);
  git(["add", "--all"]);
  git(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Seed fixed evaluation fixture"]);
  const baseCommit = git(["rev-parse", "HEAD"]);
  const actorView = Object.freeze({ root: actorRoot, readRoots: [actorRoot], writeRoots: [actorRoot], environment: Object.freeze(environment) });
  return {
    actorView, checkerView: { root: destinations.checker }, canonicalView: { root: destinations.canonical },
    requiresAdmittedProducerBinding: fixture.requiresAdmittedProducerBinding,
    gitSeed: { baseCommit, root: actorRoot, author: { name: gitIdentity.authorName, email: gitIdentity.authorEmail }, committer: { name: gitIdentity.committerName, email: gitIdentity.committerEmail } },
  };
}
export function authorizeRolePath(view, filename, operation) {
  requireCondition(operation === "read" || operation === "write", "INVALID_OPERATION", "Role access is read or write");
  const absolute = absoluteRoot(filename);
  const allowedRoots = operation === "read" ? view.readRoots : view.writeRoots;
  requireCondition(Array.isArray(allowedRoots) && allowedRoots.some(root => absolute === root || absolute.startsWith(`${root}${path.sep}`)), "ROLE_PATH_DENIED", "Path is outside the role view");
  pathIdentities(absolute, operation === "write");
  return true;
}
