import { checkerProcess } from "../../checker-process.mjs";
import { captureBoundedCommand } from "../../output.mjs";

// Test-process-only transport for our authored fixtures. Not an OS boundary or native admission.
export function useCheckerDiagnostics() {
  const original = checkerProcess.capture;
  checkerProcess.capture = captureBoundedCommand;
  return () => { checkerProcess.capture = original; };
}
