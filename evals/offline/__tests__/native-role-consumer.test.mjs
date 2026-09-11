import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { NATIVE_NODE_OPTIONS } from "../native-identity.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { runRuntimeQualification, verifyProtocolEvidence } from "../native-runtime.mjs";
import { fixture } from "./helpers/native-sdk.mjs";
import { engine, plan } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("the actual SDK launch consumes the inspector-disabled in-process identity entry", async () => {
  const value = fixture();
  await runTerminalProtocol(value.input);
  assert.equal(value.state.client.env.NODE_OPTIONS, NATIVE_NODE_OPTIONS);
  assert.equal(value.state.client.env.OFFLINE_ROLE_OBSERVATIONS, "/run/controller/role-observations");
});
test("the actual native launch archives the complete guard and grants only its explicit supervisor capabilities", async () => {
  const selected = plan();
  const fake = engine(selected);
  const root = workRoot("native-role-consumer");
  await runRuntimeQualification({ plan: selected, outputRoot: path.join(root, "run"), authorizedRoot: root, execute: fake.execute });
  const create = fake.state.calls.find(call => call.argv[0] === "create").argv;
  const caps = create.flatMap((value, index) => value === "--cap-add" ? [create[index + 1]] : []);
  assert.deepEqual(caps, ["SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"]);
  const payload = JSON.parse(fake.state.calls.find(call => call.argv[0] === "start").settings.input);
  for (const name of ["native-identity.mjs", "native-role-entry.mjs", "native-role-probe-entry.mjs"]) assert.equal(payload.files.some(file => file.path === name), true);
  assert.equal(create.includes("--privileged"), false);
  assert.equal(create.includes("--pid=host"), false);
});
test("a constant protection claim cannot replace retained actual role-probe evidence", async () => {
  const value = fixture();
  await runTerminalProtocol(value.input);
  const rows = value.state.records.filter(record => !(record.kind === "artifact" && record.ref.path.startsWith("native-role-probe-")));
  assert.throws(() => verifyProtocolEvidence(rows, plan()), /role|probe/i);
});
