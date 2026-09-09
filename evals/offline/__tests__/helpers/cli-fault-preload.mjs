import { register } from "node:module";

register(new URL("./cli-fault-loader.mjs", import.meta.url), { data: { target: new URL("../../cli.mjs", import.meta.url).href, scenario: process.env.OFFLINE_CLI_FAULT } });
