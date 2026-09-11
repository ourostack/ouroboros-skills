import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

test("headless authentication explicitly selects the existing named token without SDK renaming or auto-login", async () => {
  const value = fixture();
  await runTerminalProtocol(value.input);
  const configuration = value.state.client;
  const index = configuration.connection.args.indexOf("--auth-token-env");
  assert.notEqual(index, -1, "With auto-login disabled, the headless runtime requires its explicit supported token selector.");
  assert.equal(configuration.connection.args[index + 1], "COPILOT_GITHUB_TOKEN");
  assert.equal(configuration.connection.args.includes("--secret-env-vars=COPILOT_GITHUB_TOKEN"), true);
  assert.equal(configuration.useLoggedInUser, false);
  assert.equal(Object.hasOwn(configuration, "gitHubToken"), false);
  assert.equal(Object.hasOwn(configuration.env, "COPILOT_SDK_AUTH_TOKEN"), false);
  assert.equal(configuration.env.COPILOT_GITHUB_TOKEN, value.input.token);
});
