import { workRoot } from "./paths.mjs";

export const criterion = "The approved zero-value API returns zero.";
export const validReport = () => ({ status: "fail", summary: "Zero returned three.", reasoning: "The fixed evidence shows three rather than zero.", observations: [], criteria: [{ criterion, verdict: "fail", evidence: "checks/proof.txt:1" }] });
let sequence = 0;

export function fixture(options = {}) {
  const state = { records: [], events: [], stopped: false, aborted: false };
  const processRow = { pid: 4242, parentPid: process.pid, state: "S", startTicks: "12345" };
  class Client {
    constructor(configuration) { state.client = configuration; }
    async start() { if (Object.hasOwn(options, "startError")) throw options.startError; }
    async getStatus() { return { version: options.version ?? "1.0.84-1", protocolVersion: 3 }; }
    async createSession(configuration) {
      state.session = configuration;
      const emit = event => { state.events.push(event); configuration.onEvent(event); };
      const event = (id, type, data) => ({ id, type, data, parentId: null, timestamp: "2026-09-09T00:00:00Z" });
      const session = {
        rpc: { tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: options.tools ?? configuration.tools.map(tool => ({ name: tool.name, isTerminal: tool.isTerminal === true })) }) } },
        send: async () => {
          if (options.send) return options.send({ configuration, state, emit, event, session });
          emit(event("turn", "assistant.turn_start", { turnId: "supported-turn" }));
          const report = options.report ?? validReport();
          emit(event("request", "assistant.message", { turnId: "supported-turn", content: "", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: report }] }));
          const controller = new AbortController();
          state.returned = await configuration.tools.find(tool => tool.name === "report_result").handler(report, { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result", arguments: report, signal: controller.signal });
          controller.abort();
          emit(event("execution", "tool.execution_complete", { toolCallId: "report", success: options.executionSuccess !== false }));
          emit(event("idle", "session.idle", { mode: "interactive", aborted: false }));
          return "request";
        },
        getEvents: async () => options.history ?? state.events,
        abort: async () => { state.aborted = true; if (options.abortError) throw options.abortError; },
      };
      return session;
    }
    async stop() { state.stopped = true; return options.stopErrors ?? []; }
    async forceStop() { if (options.forceError) throw options.forceError; }
  }
  return {
    state,
    input: {
      sdk: { CopilotClient: Client, RuntimeConnection: { forStdio: value => value }, defineTool: (name, value) => ({ name, ...value }) },
      root: workRoot(`native-protocol-${++sequence}`), model: "gpt-6-astra", token: "synthetic-native-controller-entitlement-value",
      limits: { startupSendWorkMs: 1000, cleanupMs: 100 },
      emit: record => state.records.push(record),
      processObserver: {
        list: () => [processRow], read: () => state.stopped ? null : processRow,
        probe: () => {
          const observation = { probeUid: 65534, targetUid: 65534, environ: "EACCES", memory: "EACCES", descriptor: "EACCES", rootRegain: "EPERM" };
          return { protected: true, observation, capture: { stdoutBase64: Buffer.from(JSON.stringify(observation)).toString("base64"), stderrBase64: "", exitCode: 0 } };
        },
      },
    },
  };
}
