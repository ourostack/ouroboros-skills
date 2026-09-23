let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
process.stdout.write(JSON.stringify({
  ok: true,
  operation: request.operation,
  payload: request.payload,
}));
