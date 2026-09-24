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
  const absent = declaration.testAttestation === 'absent';
  const replacement = declaration.testAttestation === 'replacement';
  const processIdentity = replacement
    ? { ...observation.processIdentity, startIdentity: 'replacement-generation' }
    : observation.processIdentity;
  process.stdout.write(JSON.stringify({
    healthy: declaration.testAttestation !== 'unhealthy' && !absent,
    reason:
      declaration.testAttestation === 'unhealthy'
        ? 'TEST_ATTESTATION_FAILED'
        : absent
          ? 'PROCESS_ABSENT'
          : undefined,
    endpoint: observation.endpoint,
    processIdentity,
    endpointProcessIdentity: {
      pid: processIdentity.pid,
      startIdentity: processIdentity.startIdentity,
    },
  }));
} else {
  process.stderr.write(`unsupported operation: ${request.operation}`);
  process.exitCode = 2;
}
