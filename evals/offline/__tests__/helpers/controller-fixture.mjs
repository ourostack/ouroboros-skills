import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dataset from "../../cases/v2-alpha-v1/dataset.json" with { type: "json" };
import manifest from "../../cases/v2-alpha-v1/fixture-manifest.json" with { type: "json" };
import { jsonBytes, sha256 } from "../../core.mjs";
import { materializeFixture } from "../../materialize.mjs";
import { prepareRunPlan } from "../../producer.mjs";
import { fixture } from "./native-sdk.mjs";
import { engine, plan as judgePlan } from "./native-engine.mjs";
import { expectedFixture, planFixture } from "./run-set.mjs";
import { dataRoot, workRoot } from "./paths.mjs";
import "./controller-evidence.mjs";

let sequence = 0;
const identity = { authorName: "Ari", authorEmail: "ari@example.invalid", committerName: "Ari", committerEmail: "ari@example.invalid" };
const seeds = new Map();
export const generous = { startupSendWorkMs: 20000, cleanup: { totalMs: 1000, abortMs: 200, stopMs: 400 }, maxStreamBytes: 16777216, maxFileBytes: 16777216, maxTotalBytes: 134217728, maxFiles: 4096 };
export async function controllerFixture(caseId = "checker-is-enforced", options = {}) {
  const root = workRoot(`fixed-controller-${++sequence}`);
  const plan = planFixture(`fixed-${sequence}`);
  plan.limits = structuredClone(generous);
  plan.dataset = { id: dataset.id, version: dataset.version, sha256: sha256(fs.readFileSync(path.join(dataRoot, "dataset.json"))) };
  plan.fixtureManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "fixture-manifest.json")));
  plan.checkerManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "check-expectations.json")));
  const expected = { schemaVersion: 1, cells: dataset.cases.flatMap(definition => ["gpt-6-astra", "claude-opus-5"].map((model, index) => {
    const cell = expectedFixture(plan, definition.mode === "deterministic").cells[0];
    cell.id = `${definition.id}-${index + 1}`;
    cell.caseId = definition.id;
    if (cell.subject) { cell.subject.model = model; cell.judge.model = model; }
    else cell.repetition = index + 1;
    return cell;
  })) };
  const inputRoot = path.join(root, "input");
  fs.mkdirSync(inputRoot);
  fs.writeFileSync(path.join(inputRoot, "expected-cells.json"), jsonBytes(expected));
  plan.expectedCells = { path: "expected-cells.json", sha256: sha256(jsonBytes(expected)) };
  const definition = dataset.cases.find(value => value.id === caseId);
  if (!seeds.has(definition.fixture)) {
    const seedRoot = path.join(root, "seed");
    const seeded = await materializeFixture({ manifest, fixtureId: definition.fixture, sourceRoot: dataRoot, roots: Object.fromEntries(["actor", "checker", "canonical"].map(role => [role, path.join(seedRoot, role)])), gitIdentity: identity });
    seeds.set(definition.fixture, seeded.gitSeed.baseCommit);
  }
  const cell = expected.cells.find(value => value.caseId === caseId);
  plan.gitSeeds = [{ cellId: cell.id, fixtureId: definition.fixture, subjectFilesManifestSha256: sha256("synthetic seed manifest"), baseCommit: seeds.get(definition.fixture), initialBranch: "fixture", identity, seedReceipt: { path: "seed.json", sha256: sha256("synthetic seed receipt") } }];
  fs.writeFileSync(path.join(inputRoot, "plan.json"), jsonBytes(plan));
  const prepared = prepareRunPlan({ filename: path.join(inputRoot, "plan.json"), outputRoot: path.join(root, "run") });
  const roles = Object.fromEntries(["actor", "checker", "canonical"].map(role => [role, path.join(root, role)]));
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(plugin);
  fs.writeFileSync(path.join(plugin, "worker.md"), "Synthetic test agent, not installed native source.\n");
  const actorInput = fixture({ send: async ({ configuration, emit, event }) => {
    await options.send?.({ root, roles, configuration });
    emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: configuration.model, reasoningEffort: "high", contextTier: "default" }));
    emit(event("turn", "assistant.turn_start", { turnId: "subject" }));
    emit(event("usage", "assistant.usage", { model: configuration.model, reasoningEffort: "high", contentFilterTriggered: false, finishReason: "stop" }));
    if (caseId === "review-recovery-state") await configuration.tools.find(tool => tool.name === "request_review").handler({ sha: options.reviewSha?.({ roles }) ?? "a".repeat(40) }, { sessionId: configuration.sessionId, toolName: "request_review", toolCallId: `review-${configuration.sessionId}` });
    emit(event("message", "assistant.message", { turnId: "subject", content: "Synthetic controller test.", toolRequests: [] }));
    emit(event("idle", "session.idle", { mode: "interactive" }));
  } });
  const Base = actorInput.input.sdk.CopilotClient;
  class Client extends Base {
    async start() { actorInput.state.stopped = false; }
    async createSession(configuration) {
      actorInput.state.events = [];
      const session = await super.createSession(configuration);
      session.rpc.agent = { getCurrent: async () => ({ agent: { id: "fixture-worker", path: path.join(plugin, "worker.md") } }) };
      session.rpc.mcp = { list: async () => ({ servers: [{ name: "desk", status: "connected" }], host: { mcp3pEnabled: true, clients: ["desk"], pendingConnections: [], failedServers: {}, needsAuthServers: {}, disabledServers: [], filteredServers: [] } }) };
      session.rpc.skills = { getInvoked: async () => ({ skills: [] }) };
      session.rpc.tools.getCurrentMetadata = async () => ({ tools: [{ name: "bash" }, { name: "view" }] });
      session.rpc.tools.execute = async ({ arguments: args }) => {
        const child = spawnSync("/bin/sh", ["-c", args.command], { encoding: "utf8", timeout: 10000 });
        return { resultType: child.status === 0 ? "success" : "failure", textResultForLlm: child.stdout };
      };
      return session;
    }
    async resumeSession(id, config) { return this.createSession(config); }
  }
  const task = { track: "track", slug: "task" };
  const taskPath = path.join(roles.canonical, "task.md");
  const nativeResult = value => ({ resultType: "success", textResultForLlm: JSON.stringify(value) });
  const callbacks = {
    canonical: {
      create: async value => { fs.writeFileSync(taskPath, value.body); return nativeResult({ status: "created" }); },
      update: async value => { fs.appendFileSync(taskPath, "\n" + value.body_append); return nativeResult({ status: "updated" }); },
      archive: async () => nativeResult({ status: "archived" }),
    },
    private: { ledger: async () => nativeResult({}), feedback: async () => nativeResult({}) },
  };
  const traces = (definition.turns ?? [{}]).map((_, index) => {
    const directory = path.join(root, `trace-${index}`);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "syscalls.4242"), '1.0 execve("/opt/native/index.js", ["native"], 0x0 /* 0 vars */) = 0\n2.0 exit_group(0) = ?\n2.1 +++ exited with 0 +++\n');
    return directory;
  });
  fs.mkdirSync(path.join(root, "checks"));
  let closes = 0;
  const value = judgePlan();
  value.limits = { startupSendWorkMs: generous.startupSendWorkMs, commandMs: generous.startupSendWorkMs, cleanupMs: generous.cleanup.totalMs, maxStreamBytes: generous.maxStreamBytes };
  const fakeEngine = engine(value);
  let judges = 0;
  const execute = (command, argv, settings) => {
    if (argv[0] === "start") {
      const result = spawnSync(process.execPath, [new URL("./controller-judge.mjs", import.meta.url).pathname, path.join(root, `judge-fixture-${++judges}`), options.judgeStatus ?? "pass"], { input: settings.input, encoding: null, timeout: 20000 });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    }
    return fakeEngine.execute(command, argv, settings);
  };
  const opened = {
    task, traceDirectories: traces, checkRoot: path.join(root, "checks"),
    protocol: { ...actorInput.input, nativeClient: new Client({}) },
    subjectTurn: { person: "operator", taskRef: "track/task/task.md", agent: "fixture-worker", pluginDirectories: [plugin], mcpServers: {}, sourceSeals: [{ root: plugin, files: [{ path: "worker.md", sha256: sha256(fs.readFileSync(path.join(plugin, "worker.md"))) }] }] },
    judge: { plan: value, execute, outputRoot: path.join(root, "judge"), authorizedRoot: root },
    close: async () => { closes++; await options.close?.(); },
  };
  const input = {
    roots: roles, open: async () => opened, assertConfinement: async () => { await options.confinement?.(); },
    createDeskCallbacks: async () => callbacks, withPermission: async (name, invoke) => invoke(),
    subjectBeforeSend: async context => { await options.beforeSend?.(context); },
    readCanonical: async () => fs.readFileSync(taskPath),
    reviewHandler: async ({ dependencyAvailable }) => dependencyAvailable ? nativeResult({ admitted: false, findings: [{ text: "Synthetic review only" }] }) : { resultType: "failure", textResultForLlm: JSON.stringify({ dependencyFailureObserved: true, completion: "not-complete" }) },
  };
  const nativeInputs = { assertAllocation: async () => {}, assertSourceAndRuntime: async () => {}, cells: new Map(expected.cells.map(value => [value.id, input])) };
  return { root, inputRoot, prepared, plan, expected, cell, input, opened, actorInput, nativeInputs, callbacks, get closes() { return closes; } };
}
