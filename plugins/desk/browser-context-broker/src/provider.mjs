import { spawn } from 'node:child_process';

import { BrokerError } from './claims.mjs';

const MAX_DIAGNOSTIC_BYTES = 4_096;

export function invokeProvider(command, operation, payload, options = {}) {
  const {
    args = [],
    timeoutMs = 10_000,
    terminationGraceMs = 1_000,
    cwd,
    env,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKillTimer;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      callback();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-MAX_DIAGNOSTIC_BYTES);
    });
    child.on('error', (cause) => {
      finish(() =>
        reject(new BrokerError('PROVIDER_START_FAILED', 'Provider process could not start', {
          cause: cause.message,
        })),
      );
    });
    child.on('close', (exitCode, signal) => {
      finish(() => {
        if (timedOut) {
          reject(new BrokerError('PROVIDER_TIMEOUT', 'Provider operation timed out', {
            operation,
            timeoutMs,
            stderr: stderr.trim(),
          }));
          return;
        }
        if (exitCode !== 0) {
          reject(new BrokerError('PROVIDER_EXITED', 'Provider process exited unsuccessfully', {
            exitCode,
            signal,
            stderr: stderr.trim(),
          }));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new BrokerError('PROVIDER_INVALID_JSON', 'Provider returned malformed JSON', {
            stderr: stderr.trim(),
          }));
        }
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, terminationGraceMs);
    }, timeoutMs);

    child.stdin.end(JSON.stringify({ operation, payload }));
  });
}
