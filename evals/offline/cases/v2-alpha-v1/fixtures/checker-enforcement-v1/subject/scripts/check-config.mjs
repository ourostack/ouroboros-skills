import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.env.CONFIG_FILE || "config.json", "utf8"));
if (!Number.isInteger(config.retentionDays) || config.retentionDays < 1 || config.retentionDays > 365) {
  console.error("retentionDays must be an integer from 1 through 365");
  process.exitCode = 1;
}
