export const sentinel = "synthetic-qualified-provider-sentinel-not-a-credential";
export const response = (stdout = "", status = 0, stderr = "") => ({ status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });

export function engine(plan, options = {}) {
  const state = { calls: [], id: "b".repeat(64), created: null, removed: false, running: options.running === true };
  const execute = (command, argv, settings) => {
    state.calls.push({ command, argv, settings });
    if (options.before) options.before(command, argv, settings, state);
    if (command === "gh") return options.auth ?? response(sentinel);
    if (argv[0] === "create") { state.created = argv; return options.create ?? response(`${state.id}\n`); }
    if (argv[0] === "start") return options.execution ?? response(options.stdout ?? "");
    if (argv[0] === "kill") { state.running = false; return response(state.id); }
    if (argv[0] === "rm") { state.removed = true; return response(state.id); }
    if (state.removed || !state.created) return response("", 1, "No such object");
    const labels = Object.fromEntries(state.created.flatMap((value, index) => value === "--label" ? [state.created[index + 1].split("=")] : []));
    const container = {
      Id: state.id, Name: `/${state.created[state.created.indexOf("--name") + 1]}`, Image: plan.runtime.imageId,
      Config: { Labels: labels },
      HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"] },
      Mounts: [{ Type: "tmpfs" }], State: { Running: state.running, Status: state.running ? "running" : "exited", Pid: 12, ExitCode: 0, FinishedAt: "2026-09-09T00:00:00Z" },
    };
    if (options.inspect) options.inspect(container, state);
    return response(JSON.stringify([container]));
  };
  return { state, execute };
}

export function plan() {
  return {
    schemaVersion: 1, kind: "offline_runtime_qualification", id: "terminal-control",
    model: "gpt-6-astra", reasoningEffort: "high", contextTier: "default", scenario: "terminal-semantic-fail",
    runtime: { imageId: `sha256:${"a".repeat(64)}`, platform: "linux/amd64", nodeVersion: "22.23.2", cliVersion: "1.0.84-1", sdkVersion: "1.0.13" },
    credentialProvider: { kind: "gh-named-entitlement", hostname: "github.com", account: "explicit-fixture-account" },
    limits: { startupSendWorkMs: 1000, commandMs: 100, cleanupMs: 300, maxStreamBytes: 1000000 },
  };
}
