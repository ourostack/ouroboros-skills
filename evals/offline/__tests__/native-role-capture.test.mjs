import assert from "node:assert/strict";
import test from "node:test";
import { validateNativeRoleProbe, NATIVE_ROLE_UID } from "../native-identity.mjs";

function proof() {
  const observation = { probeUid: NATIVE_ROLE_UID, targetUid: NATIVE_ROLE_UID, environ: "EACCES", memory: "EPERM", descriptor: "EACCES", rootRegain: "EPERM" };
  return { protected: true, observation, capture: { stdoutBase64: Buffer.from(JSON.stringify(observation)).toString("base64"), stderrBase64: "", exitCode: 0 } };
}
test("native role admission checks the actual captured same-UID probe rather than a caller boolean", () => {
  const value = proof();
  assert.equal(validateNativeRoleProbe(value), true);
  value.observation = { ...value.observation, environ: "opened" };
  assert.equal(validateNativeRoleProbe(value), false);
});
test("opaque, incomplete, differently owned and contradictory role captures cannot establish protection", () => {
  for (const value of [undefined, {}, { protected: true }, { ...proof(), protected: false }, { ...proof(), capture: { ...proof().capture, exitCode: 1 } }, { ...proof(), capture: { ...proof().capture, stdoutBase64: "not base64" } }, { ...proof(), capture: { ...proof().capture, stdoutBase64: Buffer.from("{bad").toString("base64") } }]) assert.equal(validateNativeRoleProbe(value), false);
  const value = proof();
  value.capture.stdoutBase64 = Buffer.from(JSON.stringify({ ...value.observation, targetUid: 0 })).toString("base64");
  assert.equal(validateNativeRoleProbe(value), false);
});
