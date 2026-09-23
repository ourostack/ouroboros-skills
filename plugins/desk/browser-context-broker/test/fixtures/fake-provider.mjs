let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const declaration = request.payload.declaration;
const observation = request.payload.observation;

if (request.operation === 'discover') {
  process.stdout.write(JSON.stringify(
    observation
      ? { found: true, observation }
      : { found: false },
  ));
} else if (request.operation === 'launch') {
  const processIdentity = {
    pid: declaration.testPid ?? 900,
    startIdentity: `start-${declaration.testPid ?? 900}`,
    owner: declaration.testOwner ?? 'operator',
    executable: declaration.launch.executable,
    profileRoot: declaration.launch.profileRoot,
  };
  process.stdout.write(JSON.stringify({
    observation: {
      contextId: declaration.id,
      endpoint: declaration.testEndpoint ?? request.payload.endpoint,
      processIdentity,
    },
  }));
} else if (request.operation === 'attest') {
  process.stdout.write(JSON.stringify({
    healthy: declaration.testAttestation !== 'unhealthy',
    reason: declaration.testAttestation === 'unhealthy' ? 'TEST_ATTESTATION_FAILED' : undefined,
    endpoint: observation.endpoint,
    processIdentity: observation.processIdentity,
    endpointProcessIdentity: {
      pid: observation.processIdentity.pid,
      startIdentity: observation.processIdentity.startIdentity,
    },
  }));
} else {
  process.stderr.write(`unsupported operation: ${request.operation}`);
  process.exitCode = 2;
}
