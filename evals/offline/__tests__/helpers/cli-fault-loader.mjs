let target;
let source;

export function initialize(data) {
  target = data.target;
  const bodies = {
    "undefined-return": "export async function main() {}",
    "invalid-return": "export async function main() { return 9; }",
    "null-rejection": "export async function main() { throw null; }",
    "undefined-rejection": "export async function main() { throw undefined; }",
    "string-rejection": "export async function main() { throw 'dependency failed'; }",
    "zero-error-code": "export async function main() { throw Object.assign(new Error('failure'), { exitCode: 0 }); }",
    "large-error-code": "export async function main() { throw Object.assign(new Error('failure'), { exitCode: 9 }); }",
    "typed-error": "export async function main() { throw Object.assign(new Error('typed failure'), { exitCode: 2, status: 'inconclusive', artifacts: 'synthetic-artifact-reference', code: 'SYNTHETIC_FAILURE' }); }",
  };
  source = bodies[data.scenario];
  if (!source) throw new Error("Unknown explicit CLI dependency-fault fixture");
}

export async function load(url, context, nextLoad) {
  return url === target ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
}
