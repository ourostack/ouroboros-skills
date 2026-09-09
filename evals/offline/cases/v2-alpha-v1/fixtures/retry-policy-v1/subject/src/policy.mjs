export function retryAttempts(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new RangeError("attempts must be a nonnegative integer");
  }
  return value || 3;
}

export function requestOptions(options = {}) {
  return { attempts: retryAttempts(options.attempts) };
}
