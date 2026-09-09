import { retryAttempts } from "./capability.mjs";

console.log(JSON.stringify({ requested: 0, actual: retryAttempts(0) }));
