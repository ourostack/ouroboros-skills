let admittedUrls = new Set();

export function initialize({ urls }) {
  admittedUrls = new Set(urls);
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  // These source-pinned ESM TypeScript leaves otherwise reach the maintained hook with a null format.
  return admittedUrls.has(result.url) ? { ...result, format: "module" } : result;
}
