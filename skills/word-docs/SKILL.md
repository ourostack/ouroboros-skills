---
name: word-docs
description: Convert markdown drafts into shareable Word documents. Uses pypandoc for full-fidelity conversion (tables, lists, code blocks, links) with python-docx post-processing for styling. Supports mermaid diagrams via mmdc pre-rendering.
---

# Word Docs

Use this skill when someone wants a `.docx` version of an existing draft, especially when the markdown should remain the source of truth.

## Dependencies

- `pypandoc-binary` — pandoc wrapper with bundled binary (handles tables, lists, code blocks, links natively)
- `python-docx` — post-processing for styling (table borders, code block backgrounds, margins)
- `@mermaid-js/mermaid-cli` (optional) — pre-renders mermaid blocks to PNG for embedding

Preflight check:
```bash
python3 -c "import pypandoc; print('pypandoc OK')" && python3 -c "import docx; print('python-docx OK')"
```

If `pypandoc-binary` is not installed:
```bash
pip3 install pypandoc-binary python-docx
```

If mermaid diagrams are needed:
```bash
npm install -g @mermaid-js/mermaid-cli
```

## Core workflow

1. **Preserve the source in markdown first**
   - Write or revise a `.md` file as the canonical source.
   - Use standard markdown features: tables, bullet lists, code blocks, links, mermaid diagrams.

2. **Convert with pypandoc**
   ```python
   import pypandoc
   pypandoc.convert_file('source.md', 'docx', outputfile='output.docx')
   ```
   This handles tables, lists, code blocks, headings, links, bold, italic — everything pandoc supports.

3. **Post-process for styling**
   Pandoc's default Word output is plain. Use the bundled post-processing script:
   ```bash
   python3 /path/to/installed/skills/word-docs/style_docx.py output.docx
   ```
   Options:
   ```bash
   python3 style_docx.py output.docx --margins 0.5
   ```
   This adds:
   - **Table styling**: grid borders, blue header row shading, bold headers, compact 9pt font
   - **Code block styling**: grey background, Consolas 9pt font, subtle border
   - **Margins**: 0.5" all around (configurable via `--margins`)

4. **Handle mermaid diagrams** (if present in markdown)
   Pandoc doesn't render mermaid natively. The workflow:
   - Keep ```` ```mermaid ```` blocks in the markdown source (renderable in ADO/GitHub/etc.)
   - At docx generation time: extract mermaid blocks, render to PNG via `mmdc`, create a temp markdown with image refs swapped in, convert that
   ```bash
   mmdc -i diagram.mmd -o diagram.png -w 1200 -b white
   ```
   Pre-rendered PNGs live alongside the markdown source.

5. **Verify the artifact exists**
   - Check with `ls -lh`
   - Do not imply you visually inspected Word layout unless you actually did

## Judgment notes

- If the user wants **no substantive changes**, preserve wording and only change packaging.
- If the source still reads like an email, ask whether they want literal portability or a document-native presentation.
- State clearly what you verified: source markdown written, `.docx` generated, output file exists.
