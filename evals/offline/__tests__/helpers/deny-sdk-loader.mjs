export function resolve(specifier, context, nextResolve) {
  if (specifier === "@github/copilot-sdk" || specifier.startsWith("@github/copilot-sdk/") || specifier.includes("/@github/copilot-sdk/")) {
    throw new Error("SDK_IMPORT_FORBIDDEN_IN_STATIC_COMMAND");
  }
  return nextResolve(specifier, context);
}
