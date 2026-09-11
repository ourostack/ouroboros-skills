import path from "node:path";
import { enterNativeRole } from "./native-identity.mjs";

const directory = process.env.OFFLINE_ROLE_OBSERVATIONS;
enterNativeRole({ observationPath: directory === undefined ? undefined : path.join(directory, `${process.pid}.json`) });
