if (!process.env.CHECKER_CANARY_TOKEN) throw new Error("Missing trusted checker canary token.");
console.error(process.env.CHECKER_CANARY_TOKEN);
process.exit(37);
