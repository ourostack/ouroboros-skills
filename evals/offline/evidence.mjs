import { parseEvidenceIndex, validateEvidenceIndex } from "./vendor/gauntlet/src/context/scoped-read.ts";
import { absoluteRoot, readRegular, relativeName, requireCondition, textBytes } from "./core.mjs";

export function createEvidenceReader({ root, index, gauntlet = { parseEvidenceIndex, validateEvidenceIndex } }) {
  const evidenceRoot = absoluteRoot(root);
  requireCondition(index && Array.isArray(index.files) && index.files.length <= 4096, "INVALID_EVIDENCE_INDEX", "Expected a bounded evidence index");
  requireCondition(index.files.every(file => typeof file === "string") && (index.notes === undefined || (Array.isArray(index.notes) && index.notes.every(note => typeof note === "string"))), "INVALID_EVIDENCE_INDEX", "Evidence paths and optional notes must be strings");
  const parsed = gauntlet.parseEvidenceIndex(index);
  gauntlet.validateEvidenceIndex(evidenceRoot, parsed);
  const seals = new Map();
  for (const name of parsed.files) {
    relativeName(name);
    requireCondition(!seals.has(name), "DUPLICATE_EVIDENCE_PATH", "Evidence index repeats a path");
    const member = readRegular(evidenceRoot, name);
    textBytes(member.bytes);
    seals.set(name, { sha256: member.sha256, identity: member.identity });
  }
  return Object.freeze({
    seal: Object.freeze([...seals].map(([path, value]) => Object.freeze({ path, sha256: value.sha256 }))),
    read(name, offset = 0, length = 16000) {
      relativeName(name);
      requireCondition(seals.has(name), "UNINDEXED_EVIDENCE_PATH", "Only indexed evidence can be read");
      requireCondition(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 1 && length <= 16000, "INVALID_EVIDENCE_PAGE", "Expected a nonnegative integer offset and a 1..16000 UTF-16 page");
      const member = readRegular(evidenceRoot, name);
      const seal = seals.get(name);
      requireCondition(member.sha256 === seal.sha256 && member.identity === seal.identity, "EVIDENCE_CHANGED", "Sealed evidence or its identity changed");
      const text = textBytes(member.bytes);
      const end = Math.min(text.length, offset + length);
      return { text: text.slice(offset, end), totalCharacters: text.length, nextOffset: end < text.length ? end : null };
    },
  });
}
