import path from "node:path";
import dataset from "./cases/v2-alpha-v1/dataset.json" with { type: "json" };
import { absoluteRoot, canonicalJson, exactKeys, hashString, listRegularFiles, nonblank, overlaps, pathIdentities, plainObject, readRegular, requireCondition, sha256 } from "./core.mjs";
import { observeEffectiveConfiguration } from "./native-assessment.mjs";

const excluded = ["task", "read_agent", "list_agents", "write_agent", "sql", "web_fetch", "run_factory", "factories_manage", "manage_schedule"];
function within(root, filename) {
  return filename === root || filename.startsWith(`${root}${path.sep}`);
}
function verifySources(input) {
  for (const seal of input.sourceSeals) {
    requireCondition(exactKeys(seal, ["root", "files"]) && input.pluginDirectories.includes(seal.root) && Array.isArray(seal.files) && seal.files.length > 0 && seal.files.length <= 4096 && seal.files.every(file => exactKeys(file, ["path", "sha256"]) && hashString(file.sha256)), "INVALID_NATIVE_SUBJECT", "Every declared plugin requires its complete immutable source seal");
    const actual = listRegularFiles(seal.root);
    requireCondition(actual.length === seal.files.length && new Set(seal.files.map(file => file.path)).size === seal.files.length && seal.files.every(file => actual.some(member => member.path === file.path && member.sha256 === file.sha256)), "SUBJECT_SOURCE_CHANGED", "The actual installed plugin bytes differ from the declared complete source");
  }
}
export function prepareNativeSubjectTurn(value) {
  requireCondition(exactKeys(value, ["schemaVersion", "caseId", "turnIndex", "sessionId", "resume", "actorRoot", "canonicalRoot", "person", "taskRef", "agent", "pluginDirectories", "mcpServers", "sourceSeals"]) && value.schemaVersion === 1 && nonblank(value.sessionId) && typeof value.resume === "boolean" && nonblank(value.person) && nonblank(value.agent) && (value.taskRef === null || nonblank(value.taskRef)), "INVALID_NATIVE_SUBJECT", "A subject turn requires its fixed case, native session, installation and canonical context");
  requireCondition(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.sessionId) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.person), "INVALID_NATIVE_SUBJECT", "Native session and canonical person identities cannot contain path syntax");
  const definition = dataset.cases.find(entry => entry.id === value.caseId && entry.mode === "subject");
  requireCondition(definition && Number.isSafeInteger(value.turnIndex) && value.turnIndex >= 0 && value.turnIndex < definition.turns.length, "INVALID_NATIVE_SUBJECT", "Only a declared turn of a fixed subject case may run");
  requireCondition(Array.isArray(value.pluginDirectories) && value.pluginDirectories.length > 0 && value.pluginDirectories.length <= 32 && new Set(value.pluginDirectories).size === value.pluginDirectories.length && value.mcpServers && typeof value.mcpServers === "object" && !Array.isArray(value.mcpServers) && Array.isArray(value.sourceSeals) && value.sourceSeals.length === value.pluginDirectories.length && value.sourceSeals.every(seal => exactKeys(seal, ["root", "files"])) && new Set(value.sourceSeals.map(seal => seal.root)).size === value.sourceSeals.length, "INVALID_NATIVE_SUBJECT", "Native plugin and MCP inputs must be explicit and source sealed");
  const input = structuredClone(value);
  const roots = [input.actorRoot, input.canonicalRoot, ...input.pluginDirectories].map(absoluteRoot);
  for (const [index, root] of roots.entries()) {
    pathIdentities(root);
    requireCondition(roots.slice(index + 1).every(other => !overlaps(root, other)), "INVALID_NATIVE_SUBJECT", "Source, canonical state and installed plugins require distinct roots");
  }
  verifySources(input);
  const prompt = definition.turns[input.turnIndex].prompt;
  const readRoots = [input.actorRoot, input.canonicalRoot, ...input.pluginDirectories];
  const writeRoots = [input.actorRoot, path.join(input.canonicalRoot, "desks", input.person)];
  function permitted(filename, operation) {
    if (typeof filename !== "string" || filename.includes("\0")) return false;
    const absolute = path.resolve(input.actorRoot, filename);
    try {
      if (!(operation === "write" ? writeRoots : readRoots).some(root => within(root, absolute))) return false;
      pathIdentities(absolute, operation === "write");
      return true;
    } catch { return false; }
  }
  function preTool({ toolName, toolArgs }) {
    const name = toolName.split(":").at(-1);
    if (!excluded.includes(name) && !["bash", "read_bash", "stop_bash", "list_bash", "view", "rg", "glob", "apply_patch", "skill", "request_review"].includes(name)) return { permissionDecision: "ask", permissionDecisionReason: "The native permission request must identify this additional tool's actual server and role." };
    let allowed = !excluded.includes(name);
    if (name === "bash") allowed &&= toolArgs?.detach !== true;
    if (name === "view") allowed &&= permitted(toolArgs?.path, "read");
    if (["rg", "glob"].includes(name)) {
      const paths = toolArgs?.paths === undefined ? [input.actorRoot] : Array.isArray(toolArgs.paths) ? toolArgs.paths : [toolArgs.paths];
      allowed &&= paths.every(filename => permitted(filename, "read"));
    }
    if (name === "apply_patch") {
      const patch = typeof toolArgs === "string" ? toolArgs : toolArgs?.input;
      const files = typeof patch === "string" ? [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]) : [];
      allowed &&= files.length > 0 && files.every(filename => permitted(filename, "write"));
    }
    return { permissionDecision: allowed ? "allow" : "deny", permissionDecisionReason: allowed ? "Authorized isolated fixture operation." : "The operation is outside this subject's role or declared tool set." };
  }
  const sessionOptions = {
    agent: input.agent, pluginDirectories: input.pluginDirectories, mcpServers: input.mcpServers, excludedTools: excluded,
    systemMessage: { mode: "append", content: `Declared local workspace context: ${JSON.stringify({ sourceRepository: input.actorRoot, canonicalDesk: input.canonicalRoot, person: input.person, canonicalTask: input.taskRef })}. The current user turn supplies action authority. Delivery is local only: no push, merge, external work item or default/profile mutation. Persistent work belongs in the declared canonical desk, not a substitute task store.` },
    skipCustomInstructions: false, coauthorEnabled: false, manageScheduleEnabled: false,
    enableConfigDiscovery: false, enableOnDemandInstructionDiscovery: false, enableFileHooks: false, enableHostGitOperations: true,
    enableSessionStore: false, enableSkills: true, enableAutoContext: false, remoteSession: "off",
    memory: { enabled: false }, skipEmbeddingRetrieval: true, embeddingCacheStorage: "in-memory", customAgentsLocalOnly: true,
    hooks: { onPreToolUse: preTool },
    onPermissionRequest: request => {
      const allowed = request.managedApprovalRequired !== true && request.requestSandboxBypass !== true && (request.kind === "shell" || (request.kind === "mcp" && request.serverName === "desk") || (["read", "write"].includes(request.kind) && permitted(request.kind === "write" ? request.fileName : request.path, request.kind)));
      return allowed ? { kind: "approve-once" } : { kind: "reject", feedback: "Outside the declared isolated subject role." };
    },
  };
  return { input, prompt, promptSha256: sha256(prompt), sessionOptions, verifySources: () => verifySources(input) };
}

export async function observeSubjectActivation({ prepared, session, metadata, phase, artifact }) {
  const current = await phase(() => session.rpc.agent.getCurrent());
  if (artifact) artifact("subject-agent.json", current);
  const mcps = await phase(() => session.rpc.mcp.list());
  if (artifact) artifact("subject-mcps.json", mcps);
  requireCondition((current?.agent?.id === prepared.input.agent || current?.agent?.name === prepared.input.agent) && typeof current.agent.path === "string", "SUBJECT_AGENT_UNOBSERVED", "The declared agent was not selected from an actual installed file");
  const owner = prepared.input.sourceSeals.find(seal => within(seal.root, current.agent.path));
  requireCondition(owner, "SUBJECT_AGENT_UNOBSERVED", "The selected native agent is outside the installed source closure");
  const relative = path.relative(owner.root, current.agent.path);
  const source = readRegular(owner.root, relative);
  requireCondition(owner.files.some(file => file.path === relative && file.sha256 === source.sha256), "SUBJECT_SOURCE_CHANGED", "The selected native agent file differs from its source seal");
  const desks = mcps?.servers?.filter(server => server.name === "desk");
  const host = mcps?.host;
  requireCondition(plainObject(host) && plainObject(host.failedServers) && plainObject(host.needsAuthServers) && ["clients", "pendingConnections", "disabledServers", "filteredServers"].every(key => Array.isArray(host[key])), "SUBJECT_DESK_UNAVAILABLE", "The native host's complete connection inventories are required");
  requireCondition(desks?.length === 1 && desks[0].status === "connected" && host.mcp3pEnabled === true && host.clients.filter(name => name === "desk").length === 1 && host.pendingConnections.length === 0 && Object.keys(host.failedServers).length === 0 && Object.keys(host.needsAuthServers).length === 0 && !host.disabledServers.includes("desk") && !host.filteredServers.includes("desk"), "SUBJECT_DESK_UNAVAILABLE", "Exactly one connected Desk and no unresolved MCP dependency are required");
  requireCondition(Array.isArray(metadata.tools) && metadata.tools.some(tool => tool.name === "bash") && metadata.tools.some(tool => tool.name === "view") && metadata.tools.every(tool => !excluded.includes(tool.name)), "SUBJECT_TOOLS_UNAVAILABLE", "The actual subject tool set is absent or exposes undeclared subagent/authority routes");
  return { agent: current.agent, agentSource: { root: owner.root, path: relative, sha256: source.sha256 }, mcps, tools: metadata.tools };
}

export function observeSubjectCompletion({ prepared, records, history, sessionId, model, cleanup, failure, endReason, skills, historyRef, sourceVerified = false }) {
  if (!sourceVerified) prepared.verifySources();
  const effective = observeEffectiveConfiguration({ events: records, sessionId, model, ...(prepared.input.resume ? { history, historyRef } : {}) });
  const observed = records.map(record => JSON.parse(record.rawRecord));
  const relevant = observed.filter(event => !event.ephemeral && ["assistant.message", "assistant.turn_start", "tool.execution_complete"].includes(event.type));
  const historyReconciled = Array.isArray(history) && relevant.every(event => history.some(prior => prior.id === event.id && canonicalJson(prior) === canonicalJson(event))) && history.filter(event => event.type === "assistant.message").every(event => prepared.input.resume || relevant.some(prior => prior.id === event.id));
  const status = endReason === "timed_out" ? "timed_out" : endReason === "cancelled" ? "cancelled" : !failure && cleanup.complete && effective.verified && historyReconciled ? "observed" : "unavailable";
  return { status, effectiveConfiguration: effective, historyReconciled, skills, promptSha256: prepared.promptSha256 };
}
