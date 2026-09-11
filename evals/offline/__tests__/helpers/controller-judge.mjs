// Synthetic protocol transport for controller unit tests. No SDK process or provider is started.
import fs from "node:fs";
import path from "node:path";
import { runTerminalProtocol } from "../../native-protocol.mjs";

const input = JSON.parse(fs.readFileSync(0));
const root = process.argv[2];
fs.mkdirSync(root, { recursive: true });
const evidenceRoot = path.join(root, "evidence");
for (const file of input.evidence) {
  const filename = path.join(evidenceRoot, file.path);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, Buffer.from(file.base64, "base64"));
}
let stopped = false;
const rows = [];
class Client {
  async start() {}
  async getStatus() { return { version: "1.0.84-1" }; }
  async createSession(config) {
    const events = [];
    const emit = (id, type, data) => {
      const event = { id, type, data, parentId: null, timestamp: "2026-01-01T00:00:00Z" };
      events.push(event);
      config.onEvent(event);
    };
    return {
      rpc: { tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: config.tools.map(tool => ({ name: tool.name })) }) } },
      send: async () => {
        emit("start", "session.start", { sessionId: config.sessionId, selectedModel: config.model, reasoningEffort: "high", contextTier: "default" });
        emit("turn", "assistant.turn_start", { turnId: "turn" });
        emit("usage", "assistant.usage", { model: config.model, reasoningEffort: "high", contentFilterTriggered: false, finishReason: "tool_calls" });
        const criteria = input.assessment.criteria.map(criterion => ({ criterion, verdict: input.assessment.fixedVerdicts.find(value => value.criterion === criterion)?.verdict ?? (process.argv[3] === "investigate" ? "unclear" : process.argv[3]), evidence: input.assessment.evidenceIndex.files[0] }));
        const report = { status: criteria.some(value => value.verdict === "fail") ? "fail" : criteria.some(value => value.verdict === "unclear") ? "investigate" : "pass", summary: "Synthetic test report.", reasoning: "Synthetic controller-transport test only.", observations: [], criteria };
        emit("request", "assistant.message", { content: "", turnId: "turn", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: report }] });
        const returned = await config.tools.find(tool => tool.name === "report_result").handler(report, { sessionId: config.sessionId, toolName: "report_result", toolCallId: "report" });
        emit("complete", "tool.execution_complete", { toolCallId: "report", success: returned.resultType === "success" });
        emit("idle", "session.idle", { mode: "interactive" });
      },
      getEvents: async () => events,
      abort: async () => {},
    };
  }
  async stop() { stopped = true; return []; }
  async forceStop() {}
}
const processRow = { pid: 4242, parentPid: process.pid, startTicks: "12345", state: "S" };
const observation = { probeUid: 65534, targetUid: 65534, environ: "EACCES", memory: "EACCES", descriptor: "EACCES", rootRegain: "EPERM" };
await runTerminalProtocol({
  sdk: { CopilotClient: Client, RuntimeConnection: { forStdio: value => value }, defineTool: (name, value) => ({ name, ...value }) },
  root: path.join(root, "runtime"), model: input.model, token: "synthetic-controller-test-entitlement", limits: input.limits,
  assessment: { ...input.assessment, evidenceRoot },
  processObserver: { list: () => [processRow], read: () => stopped ? null : processRow, probe: () => ({ protected: true, observation, capture: { stdoutBase64: Buffer.from(JSON.stringify(observation)).toString("base64"), stderrBase64: "", exitCode: 0 } }) },
  emit: record => rows.push(record),
});
process.stdout.write(rows.map(row => JSON.stringify(row)).join("\n") + "\n");
