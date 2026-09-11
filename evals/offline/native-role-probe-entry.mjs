import { inspectNativeRole } from "./native-identity.mjs";

process.stdout.write(`${JSON.stringify(inspectNativeRole({ pid: Number(process.argv[2]) }))}\n`);
