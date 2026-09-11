import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { controllerFixture } from "./controller-fixture.mjs";
import { privateControllerFixture } from "./private-controller.mjs";
import { success } from "./private-callbacks.mjs";

// This is an intentionally synthetic actor/reviewer transport. It performs real fixture edits
// and local archive operations to exercise the controller, not a native or paid campaign.
export async function completedControllerFixture(caseId, options = {}) {
  if (caseId === "private-recording-boundaries") return privateControllerFixture();
  let turn = -1;
  let f;
  const commands = [];
  const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 });
  const commit = root => { git(root, ["add", "."]); git(root, ["commit", "--quiet", "-m", "Source-test fixture repair"]); };
  const run = (command, args, cwd) => {
    const output = execFileSync(command, args, { cwd, encoding: "utf8", timeout: 15000, env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, HOME: f.root } });
    commands.push([path.basename(command), ...args]);
    return output;
  };
  f = await controllerFixture(caseId, { judgeStatus: options.judgeStatus, reviewSha: ({ roles }) => git(roles.actor, ["rev-parse", "HEAD"]).trim(), send: async ({ roles }) => {
    turn++;
    const actor = roles.actor;
    if (caseId === "discussion-then-go" && turn === 1) {
      const filename = path.join(actor, "src/policy.mjs");
      fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace("return value || 3;", "return value ?? 3;"));
      commit(actor);
    }
    if (caseId === "checker-is-enforced") {
      const filename = path.join(actor, "package.json");
      const value = JSON.parse(fs.readFileSync(filename));
      value.scripts.ci = "npm run test && npm run check";
      fs.writeFileSync(filename, JSON.stringify(value));
    }
    if (caseId === "packed-deliverable") {
      const filename = path.join(actor, "src/retry-policy.mjs");
      fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace("return value || 3;", "return value ?? 3;"));
      const build = path.join(actor, "build.mjs");
      fs.writeFileSync(build, fs.readFileSync(build, "utf8").replace("dist/retry-policy.mjs", "dist/public-entry.mjs"));
      commit(actor);
      run("npm", ["run", "build"], actor);
      const archive = run("npm", ["pack", "--ignore-scripts", "--offline"], actor).trim();
      const consumer = path.join(f.root, "consumer");
      fs.mkdirSync(consumer);
      run("npm", ["install", path.join(actor, archive), "--ignore-scripts", "--offline"], consumer);
      run(process.execPath, ["--input-type=module", "-e", 'import { retryAttempts } from "packed-delivery-fixture"; console.log(retryAttempts(), retryAttempts(5), retryAttempts(0));'], consumer);
      const filename_ = path.join(f.opened.traceDirectories[0], "syscalls.4242");
      const rows = commands.map((argv, index) => `${index + 2}.0 execve(${JSON.stringify(argv[0] === "npm" ? "/usr/bin/npm" : process.execPath)}, ${JSON.stringify(argv)}, 0x0) = 0`);
      fs.writeFileSync(filename_, ['1.0 execve("/native", ["native"], 0x0) = 0', ...rows, '9.0 exit_group(0) = ?'].join("\n") + "\n");
    }
    if (caseId === "review-recovery-state" && turn === 2) {
      const filename = path.join(actor, "quote.mjs");
      fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace("return itemTotal([...items, delivery], discount);", "return items.length === 0 ? 0 : itemTotal(items, discount) + delivery;"));
      commit(actor);
    }
    if (caseId === "capability-probe-authority") {
      run(process.execPath, ["approved/challenge.mjs"], actor);
      fs.writeFileSync(path.join(f.opened.traceDirectories[0], "syscalls.4242"), '1.0 execve("/native", ["native"], 0x0) = 0\n2.0 execve("/bin/node", ["node", "approved/challenge.mjs"], 0x0) = 0\n3.0 exit_group(0) = ?\n');
    }
  } });
  if (caseId === "review-recovery-state") {
    const review = f.input.reviewHandler;
    f.input.reviewHandler = async request => request.turnIndex === 0 ? review(request) : success({ sha: request.sha, admitted: request.turnIndex === 2, findings: request.turnIndex === 1 ? [{ text: "Delivery is incorrectly discounted." }] : [], reviewerSessionId: `synthetic-independent-${request.turnIndex}` });
  }
  return f;
}
