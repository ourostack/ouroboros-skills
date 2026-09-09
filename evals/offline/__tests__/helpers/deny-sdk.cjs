"use strict";

const Module = require("node:module");
const original = Module._load;
Module._load = function (request, ...args) {
  if (request === "@github/copilot-sdk" || request.startsWith("@github/copilot-sdk/") || request.includes("/@github/copilot-sdk/")) {
    throw new Error("SDK_IMPORT_FORBIDDEN_IN_STATIC_COMMAND");
  }
  return original.call(this, request, ...args);
};
