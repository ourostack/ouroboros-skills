// chunk.js — split a doc body into searchable chunks.
//
// Strategy (per Unit 4 spec):
//   1. Split on H2 boundaries (`## `).
//   2. If a chunk is >800 chars, split further on paragraph boundaries
//      (blank-line separators). Code fences are never split.
//   3. Each chunk carries a stable 0-based index and the nearest preceding
//      heading so search results can show the section the hit came from.
//
// The chunker is intentionally simple — the design doc's "512-token sliding
// window with 64-token overlap" is the long-term target; Unit 4 lays the
// upsert wiring and Units 5+ can refine ranking-side without re-indexing.

const MAX_CHUNK_CHARS = 800

/**
 * Split a doc body into chunks. Returns an array of chunk objects.
 *
 * @param {string} body — the markdown body (frontmatter already stripped).
 * @returns {Array<{ index: number, text: string, heading: string|null,
 *                   start_offset: number, end_offset: number }>}
 */
export function chunkBody(body) {
  const trimmed = body ?? ""
  if (!trimmed.trim()) return []

  // Step 1 — split on H2 boundaries while tracking offsets in the original
  // body. Each section keeps its leading heading line.
  const sections = splitByH2(trimmed)

  // Step 2 — for each section, either keep as one chunk (if small enough)
  // or split by paragraph boundaries (never inside a code fence).
  const out = []
  for (const sec of sections) {
    if (sec.text.length <= MAX_CHUNK_CHARS) {
      pushChunk(out, sec.text, sec.heading, sec.startOffset)
      continue
    }
    const paragraphs = splitParagraphs(sec.text, sec.startOffset)
    let buf = ""
    let bufStart = sec.startOffset
    for (const para of paragraphs) {
      if (buf && buf.length + para.text.length + 2 > MAX_CHUNK_CHARS) {
        pushChunk(out, buf, sec.heading, bufStart)
        buf = ""
      }
      if (!buf) {
        buf = para.text
        bufStart = para.startOffset
      } else {
        buf += "\n\n" + para.text
      }
      // If a single paragraph is itself oversized, emit it as one chunk
      // anyway — splitting mid-paragraph would hurt search quality more
      // than oversized chunks hurt embedding cost.
      if (buf.length >= MAX_CHUNK_CHARS) {
        pushChunk(out, buf, sec.heading, bufStart)
        buf = ""
      }
    }
    if (buf) pushChunk(out, buf, sec.heading, bufStart)
  }

  return out.map((c, i) => ({ ...c, index: i }))
}

function pushChunk(out, text, heading, startOffset) {
  const trimmed = text.trim()
  if (!trimmed) return
  out.push({
    index: out.length,
    text: trimmed,
    heading: heading ?? null,
    start_offset: startOffset,
    end_offset: startOffset + text.length,
  })
}

/**
 * Split a body into sections on H2 boundaries. Each section text starts at
 * the H2 line (or, for the preamble, at offset 0).
 *
 * @returns {Array<{ text: string, heading: string|null, startOffset: number }>}
 */
function splitByH2(body) {
  const lines = body.split("\n")
  const sections = []
  let current = { lines: [], heading: null, startOffset: 0 }
  let offset = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isFence = /^```/.test(line)
    if (isFence) inFence = !inFence
    const isH2 = !inFence && /^##\s+\S/.test(line)
    if (isH2) {
      if (current.lines.length > 0) {
        sections.push({
          text: current.lines.join("\n"),
          heading: current.heading,
          startOffset: current.startOffset,
        })
      }
      current = {
        lines: [line],
        heading: line.replace(/^##\s+/, "").trim(),
        startOffset: offset,
      }
    } else {
      current.lines.push(line)
    }
    // +1 for the newline that follows every line except possibly the last.
    offset += line.length + 1
  }
  if (current.lines.length > 0) {
    sections.push({
      text: current.lines.join("\n"),
      heading: current.heading,
      startOffset: current.startOffset,
    })
  }
  return sections
}

/**
 * Split a section into paragraphs (blank-line-separated runs). Code fences
 * count as a single paragraph regardless of internal blank lines.
 */
function splitParagraphs(text, baseOffset) {
  const out = []
  const lines = text.split("\n")
  let buf = []
  let bufStart = baseOffset
  let cursor = baseOffset
  let inFence = false
  for (const line of lines) {
    const isFence = /^```/.test(line)
    if (isFence) {
      buf.push(line)
      cursor += line.length + 1
      inFence = !inFence
      continue
    }
    if (inFence) {
      buf.push(line)
      cursor += line.length + 1
      continue
    }
    if (line.trim() === "") {
      if (buf.length > 0) {
        out.push({ text: buf.join("\n"), startOffset: bufStart })
        buf = []
      }
      cursor += line.length + 1
      bufStart = cursor
      continue
    }
    if (buf.length === 0) bufStart = cursor
    buf.push(line)
    cursor += line.length + 1
  }
  if (buf.length > 0) {
    out.push({ text: buf.join("\n"), startOffset: bufStart })
  }
  return out
}
