const SET_CLAIMS = new Set(['posture', 'capabilities']);
const ALLOW_LIST_CLAIMS = new Set(['identity', 'tenant']);

export class BrokerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
    this.details = details;
  }
}

function values(value) {
  return Array.isArray(value) ? value : [value];
}

function compatible(aliasValue, requestValue, key) {
  if (SET_CLAIMS.has(key)) {
    const available = new Set(values(aliasValue));
    return values(requestValue).every((value) => available.has(value));
  }
  if (ALLOW_LIST_CLAIMS.has(key)) {
    const aliasValues = new Set(values(aliasValue));
    return values(requestValue).some((value) => aliasValues.has(value));
  }
  return aliasValue === requestValue;
}

export function expandRequest(config, request) {
  if (!request?.alias) return structuredClone(request ?? {});

  const aliasClaims = config?.aliases?.[request.alias];
  if (!aliasClaims) {
    throw new BrokerError('UNKNOWN_CONTEXT_ALIAS', `Unknown context alias: ${request.alias}`, {
      alias: request.alias,
    });
  }

  const expanded = { alias: request.alias, ...structuredClone(aliasClaims) };
  for (const [key, value] of Object.entries(request)) {
    if (key === 'alias') continue;
    if (
      Object.hasOwn(aliasClaims, key) &&
      !compatible(aliasClaims[key], value, key)
    ) {
      throw new BrokerError(
        'CONFLICTING_REQUEST_CLAIMS',
        `Request claim "${key}" conflicts with alias "${request.alias}"`,
        { alias: request.alias, claim: key },
      );
    }
    expanded[key] = structuredClone(value);
  }
  return expanded;
}

function matchesClaim(declared, requested, key) {
  if (declared === undefined || declared === null) return false;
  if (SET_CLAIMS.has(key)) {
    const evidence = new Set(values(declared));
    return values(requested).every((value) => evidence.has(value));
  }
  if (ALLOW_LIST_CLAIMS.has(key)) {
    return values(requested).includes(declared);
  }
  return declared === requested;
}

export function matchContext(config, request) {
  const expanded = expandRequest(config, request);
  const claims = Object.fromEntries(
    Object.entries(expanded).filter(([key]) => key !== 'alias'),
  );
  const matches = (config?.contexts ?? []).filter((declaration) =>
    Object.entries(claims).every(([key, value]) =>
      matchesClaim(declaration.claims?.[key], value, key),
    ),
  );

  if (matches.length === 0) {
    throw new BrokerError('NO_CONTEXT_MATCH', 'No context declaration matches all requested claims', {
      request: expanded,
    });
  }
  if (matches.length > 1) {
    throw new BrokerError(
      'AMBIGUOUS_CONTEXT_MATCH',
      'Multiple context declarations match all requested claims',
      { request: expanded, matches: matches.map(({ id }) => id) },
    );
  }
  return matches[0];
}
