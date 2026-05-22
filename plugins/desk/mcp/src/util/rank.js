// rank.js — pure ranking math for desk MCP search.
//
// Per desk-search-design §4 the hybrid score is:
//   0.55 * semantic_cos
// + 0.25 * bm25_normalized
// + 0.12 * recency_decay (exp(-Δdays / 60))
// + 0.08 * state_bias
// + active_iteration_pin (additive +0.30 if chunk's doc lives under an
//                         active-iteration directory)
//
// Soft-fail rule: when Ollama is down, drop the semantic component and
// renormalize the remaining base weights so their internal ratios are
// preserved. The active-iteration pin stays additive on top either way.
//
// state_bias map (mapping desk's 8-state lifecycle to the design doc's
// numeric scale — see planning Unit 5):
//   drafting/processing/collaborating/validating → 1.0  (active work)
//   blocked → 0.7
//   paused → 0.65
//   done → 0.6
//   cancelled → 0.3
//   (anything else / null) → 0.5
//
// All exports are pure functions (no DB, no I/O) so the per-tool dispatch
// can call them in tight loops without overhead.

export const BASE_WEIGHTS = Object.freeze({
  semantic: 0.55,
  bm25: 0.25,
  recency: 0.12,
  state: 0.08,
})

export const PIN_WEIGHT = 0.30

export const STATE_BIAS = Object.freeze({
  drafting: 1.0,
  processing: 1.0,
  collaborating: 1.0,
  validating: 1.0,
  blocked: 0.7,
  paused: 0.65,
  done: 0.6,
  cancelled: 0.3,
})

const STATE_BIAS_DEFAULT = 0.5
const RECENCY_HALF_LIFE_DAYS = 60

/**
 * Look up a status string's state-bias weight. Case-insensitive; tolerant of
 * null / undefined / unknown values (returns the neutral default).
 */
export function stateBias(status) {
  if (typeof status !== "string") return STATE_BIAS_DEFAULT
  const key = status.toLowerCase().trim()
  return Object.prototype.hasOwnProperty.call(STATE_BIAS, key)
    ? STATE_BIAS[key]
    : STATE_BIAS_DEFAULT
}

/**
 * Compute the 60-day half-life recency decay. `updated_at` is a string from
 * the docs table (ISO 8601 or YYYY-MM-DD). Now defaults to wall clock; tests
 * pass a fixed `now` to keep results deterministic.
 *
 * @returns {number} in [0, 1]
 */
export function recencyDecay(updatedAt, now = Date.now()) {
  if (!updatedAt) return 0
  const ts = Date.parse(updatedAt)
  if (Number.isNaN(ts)) return 0
  const deltaDays = (now - ts) / (1000 * 60 * 60 * 24)
  if (deltaDays <= 0) return 1
  return Math.exp(-deltaDays / RECENCY_HALF_LIFE_DAYS)
}

/**
 * Clip cosine similarity to [0, 1]. sqlite-vec returns L2 distance for vec0
 * tables — callers convert distance to similarity (`1 - distance/2` for unit
 * vectors, or use the raw cosine path) before passing in. This helper just
 * guards the range.
 */
export function clipCosine(x) {
  if (typeof x !== "number" || Number.isNaN(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/**
 * Min-max normalize a list of BM25 scores to [0, 1]. BM25 from FTS5 is
 * unbounded (and SQLite returns negative values where higher = better, per
 * its `bm25(table)` convention) so we flip and then renormalize. If every
 * value is equal the function returns 0 for all entries (no signal).
 *
 * @param {number[]} raw — raw bm25() values from sqlite (negative; lower = more relevant)
 * @returns {number[]} normalized scores in [0, 1] where higher = more relevant
 */
export function normalizeBm25(raw) {
  if (!raw.length) return []
  // Flip sign so higher = more relevant.
  const flipped = raw.map((v) => -v)
  const min = Math.min(...flipped)
  const max = Math.max(...flipped)
  if (max === min) return flipped.map(() => 0)
  return flipped.map((v) => (v - min) / (max - min))
}

/**
 * Compute the final hybrid score from component breakdowns.
 *
 * @param {object} parts
 * @param {number} [parts.semantic] — clipped cosine in [0,1]; null/undef → drop component
 * @param {number} [parts.bm25] — normalized BM25 in [0,1]
 * @param {number} [parts.recency] — decay in [0,1]
 * @param {number} [parts.state] — state bias in [0,1]
 * @param {boolean} [parts.pin] — true if chunk is under active iteration
 * @param {boolean} [parts.semanticAvailable] — when false, drops the semantic
 *                                              term + renormalizes weights
 * @returns {{ score: number, breakdown: object }}
 */
export function combineScore(parts) {
  const semanticAvailable = parts.semanticAvailable !== false
  const components = {
    semantic: semanticAvailable ? clipCosine(parts.semantic ?? 0) : 0,
    bm25: clipCosine(parts.bm25 ?? 0),
    recency: clipCosine(parts.recency ?? 0),
    state: clipCosine(parts.state ?? STATE_BIAS_DEFAULT),
  }

  // Active weight set — when semantic is unavailable, drop it AND renormalize
  // the rest so their internal ratios are preserved (and so a perfect FTS hit
  // can still earn a competitive score). Pin stays additive on top.
  const activeWeights = { ...BASE_WEIGHTS }
  if (!semanticAvailable) {
    activeWeights.semantic = 0
    const remaining = activeWeights.bm25 + activeWeights.recency + activeWeights.state
    if (remaining > 0) {
      // Preserve ratios: scale each remaining weight so they sum back to the
      // original base weight total (0.55 + 0.25 + 0.12 + 0.08 = 1.0).
      const baseTotal = BASE_WEIGHTS.semantic + BASE_WEIGHTS.bm25 +
        BASE_WEIGHTS.recency + BASE_WEIGHTS.state
      const factor = baseTotal / remaining
      activeWeights.bm25 *= factor
      activeWeights.recency *= factor
      activeWeights.state *= factor
    }
  }

  let score =
    activeWeights.semantic * components.semantic +
    activeWeights.bm25 * components.bm25 +
    activeWeights.recency * components.recency +
    activeWeights.state * components.state

  if (parts.pin) score += PIN_WEIGHT

  return {
    score,
    breakdown: {
      semantic: components.semantic,
      bm25: components.bm25,
      recency: components.recency,
      state: components.state,
      pin: parts.pin ? PIN_WEIGHT : 0,
    },
  }
}

/**
 * Cosine similarity between two same-length numeric arrays. Used by the
 * search tools to score sqlite-vec results — vec0 returns L2 distance; we
 * post-process with this against the raw embeddings to get a proper cosine.
 *
 * Returns 0 for mismatched lengths / non-arrays so callers don't have to
 * guard every site.
 */
export function cosine(a, b) {
  if (!Array.isArray(a) && !ArrayBuffer.isView(a)) return 0
  if (!Array.isArray(b) && !ArrayBuffer.isView(b)) return 0
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let aMag = 0
  let bMag = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    aMag += a[i] * a[i]
    bMag += b[i] * b[i]
  }
  if (aMag === 0 || bMag === 0) return 0
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag))
}
