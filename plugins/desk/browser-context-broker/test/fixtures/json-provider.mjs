let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
switch (request.payload.fixture) {
  case 'exit':
    process.stderr.write('fixture exit');
    process.exitCode = 7;
    break;
  case 'malformed':
    process.stdout.write('{broken');
    break;
  case 'timeout':
    setTimeout(() => process.stdout.write('{}'), 1_000);
    break;
  default:
    process.stdout.write(JSON.stringify({
      ok: true,
      operation: request.operation,
      payload: request.payload,
    }));
}
