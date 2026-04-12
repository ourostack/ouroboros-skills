---
name: word-docs
description: Convert markdown drafts into shareable Word documents. Ships with a reusable `md_to_docx.py` helper so the workflow is portable instead of living inline in the skill text.
---

# Word Docs

Use this skill when someone wants a `.docx` version of an existing draft, especially when markdown should remain the source of truth.

## Core workflow

1. **Preserve the source in markdown first**
   - Write or revise a `.md` file as the canonical source.
   - If the request is "keep all the content, just make it shareable," keep substantive text intact and only change presentation.

2. **Use the bundled conversion script**
   - Helper script: `skills/word-docs/md_to_docx.py`
   - Run:
     ```bash
     python3 /path/to/installed/skills/word-docs/md_to_docx.py /absolute/path/to/source.md
     ```
   - Optional explicit output path:
     ```bash
     python3 /path/to/installed/skills/word-docs/md_to_docx.py /absolute/path/to/source.md --output /absolute/path/to/output.docx
     ```

3. **What the helper script does**
   - reads markdown from disk
   - converts `#` and `##` to Word headings
   - preserves paragraphs and blank lines
   - renders inline markdown for:
     - hyperlinks `[text](url)`
     - bold `**text**`
     - inline code `` `code` ``
   - writes a `.docx` using `python-docx`

4. **Preflight dependency check**
   - confirm `python-docx` is installed before relying on the helper script:
     ```bash
     python3 - <<'PY'
     import importlib.util
     print(bool(importlib.util.find_spec('docx')))
     PY
     ```
   - if unavailable, install `python-docx` in the local environment or choose a different conversion path

5. **Verify the artifact exists**
   - check the output file with `ls -lh`
   - if useful, re-open or re-read the markdown source to confirm you did not accidentally change substance

## Judgment notes

- If the user wants **no substantive changes**, preserve wording and only change packaging.
- If the source still reads like an email, ask whether they want:
  - literal portability, or
  - a document-native presentation with the same substance.
- State clearly what you verified:
  - source markdown written
  - `.docx` generated
  - output file exists
- Do not imply you visually inspected Word layout unless you actually did.
