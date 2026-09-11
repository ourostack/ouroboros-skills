import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { main } from "../cli.mjs";
import { runFixedController } from "../fixed-controller.mjs";
import { prepareRunPlan } from "../producer.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { completedControllerFixture } from "./helpers/completed-controller.mjs";
import { controllerFixture } from "./helpers/controller-fixture.mjs";

async function campaign(judgeStatus = "pass", failLast = false) {
  const first = await completedControllerFixture("discussion-then-go", { judgeStatus });
  const cells = new Map();
  const seeds = [];
  for (const [index, cell] of first.expected.cells.entries()) {
    const f = index === 0 ? first : await completedControllerFixture(cell.caseId, { judgeStatus });
    if (failLast && index === first.expected.cells.length - 1) f.input.assertConfinement = async () => { throw new Error("Last-cell native capability unavailable"); };
    cells.set(cell.id, f.input);
    seeds.push({ ...f.plan.gitSeeds[0], cellId: cell.id });
  }
  first.plan.gitSeeds = seeds;
  fs.writeFileSync(path.join(first.inputRoot, "plan.json"), jsonBytes(first.plan));
  const prepared = prepareRunPlan({ filename: path.join(first.inputRoot, "plan.json"), outputRoot: path.join(first.root, "full-controller") });
  const result = await runFixedController({ prepared, nativeInputs: { ...first.nativeInputs, cells } });
  return { ...first, prepared, result };
}
test("HIGH-6 a committed unavailable twelfth cell wins over complete inventory", async () => {
  const f = await campaign("pass", true);
  assert.equal(f.result.attempts, 12);
  assert.equal(f.result.unstarted, 0);
  assert.equal(f.prepared.runSet.attempts.at(-1).status, "unavailable");
  assert.ok(f.prepared.runSet.attempts.at(-1).commitMarker);
  assert.equal(f.result.exitCode, 3);
});
test("full fixed-six publication source controls preserve pass, inconclusive and failure without inventing a winner", async () => {
  const passed = await campaign();
  assert.equal(passed.result.exitCode, 0, JSON.stringify(passed.result));
  assert.equal(passed.result.attempts, 12);
  const inconclusive = await campaign("investigate");
  assert.equal(inconclusive.result.exitCode, 2, JSON.stringify(inconclusive.result));
  const failed = await campaign("fail");
  assert.equal(failed.result.exitCode, 1, JSON.stringify(failed.result));
  for (const f of [passed, inconclusive, failed]) {
    const runSet = JSON.parse(fs.readFileSync(path.join(f.prepared.root, "run-set.json")));
    assert.equal(runSet.state, "complete");
    assert.equal(runSet.unstartedCellIds.length, 0);
    assert.ok(runSet.attempts.every(attempt => attempt.commitMarker !== null));
  }
  let text = "";
  const exit = await main(["compare", "--left", path.join(passed.prepared.root, "run-set.json"), "--right", path.join(inconclusive.prepared.root, "run-set.json")], { stdout: { write: value => { text += value; } } });
  const compared = JSON.parse(text);
  assert.equal(exit, 0, text);
  assert.equal(compared.expectedCells, 24);
  assert.equal(compared.missing, 0);
  assert.equal(compared.grade, null);
});
test("CLI module loading and publication failures remain stopped, source-bound holds", async () => {
  const f = await controllerFixture();
  const module = path.join(f.inputRoot, "native-input.mjs");
  fs.writeFileSync(module, "export const nativeInputs = undefined;\n");
  const manifest = jsonBytes({ schemaVersion: 1, files: [{ path: "native-input.mjs", sha256: sha256(fs.readFileSync(module)) }] });
  fs.writeFileSync(path.join(f.inputRoot, "tooling-source-manifest.json"), manifest);
  f.plan.toolingSourceManifestSha256 = sha256(manifest);
  fs.writeFileSync(path.join(f.inputRoot, "plan.json"), jsonBytes(f.plan));
  await assert.rejects(main(["run", "--plan", path.join(f.inputRoot, "plan.json"), "--output", path.join(f.root, "module-hold"), "--native-inputs", module]), { code: "NATIVE_QUALIFICATION_REQUIRED", exitCode: 3 });
  fs.appendFileSync(module, "// changed after binding\n");
  await assert.rejects(main(["run", "--plan", path.join(f.inputRoot, "plan.json"), "--output", path.join(f.root, "module-changed"), "--native-inputs", module]), { code: "NATIVE_INPUT_SOURCE_UNBOUND" });
  const failure = await controllerFixture();
  failure.prepared.plan.limits.maxFiles = 4;
  const result = await runFixedController({ prepared: failure.prepared, nativeInputs: failure.nativeInputs });
  assert.equal(result.exitCode, 3);
  assert.equal(failure.prepared.runSet.attempts[0].commitMarker, null);
});
