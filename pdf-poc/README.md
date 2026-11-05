# Markdown to PDF — proof of concept

A small, standalone browser app that takes a Markdown file and writes an A4 PDF
without uploading it. It exists to test whether a useful PDF can be produced
with very little memory and CPU, and without a PDF library.

## Run it

Serve the repository root — the app imports the `marked` copy already vendored
at `../vendor/` — then open `/pdf-poc/`:

```sh
python3 -m http.server 8080
```

<http://localhost:8080/pdf-poc/>

Drop a `.md` file or use **Choose a file**. The PDF is generated in the tab and
offered as a download. Nothing leaves the browser, and the page has no service
worker, no analytics and no network calls after its own files have loaded.

## What it supports

- Headings, paragraphs, bold, italic, inline code and fenced code.
- Bullet, numbered and task lists, including one level of nesting.
- Blockquotes and horizontal rules.
- Links, written as clickable PDF link annotations.
- Simple tables, rendered as rows of `A | B` text.
- Images, rendered as their alt text.

Deliberately out of scope for this POC: embedding pictures, syntax
highlighting, complex table layouts, footnotes, raw HTML and Unicode beyond
WinAnsi (accented Latin text works; emoji become `?`).

## How it stays small

- `../js/pdf.js` writes the PDF objects directly. There is no PDF library, no canvas,
  no screenshot and no rasterisation; the output is text plus base-14 font
  references.
- `marked` tokenises the Markdown once. Text is measured with the fonts'
  published widths, wrapped into lines, and appended to a page content stream.
- Memory is dominated by the note text and the token tree. CPU is one
  tokenise-and-layout pass; the browser run of the sample note took about 20 ms.

The trade-off is fidelity: a real PDF library would handle embedded fonts,
images and Unicode far better, at the cost of code size and memory.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page: drop zone, result and download. |
| `app.js` | Reads the file, calls the renderer, makes the download. |
| `../js/pdf.js` | Markdown tokens to an A4 PDF byte array. No DOM, no dependencies beyond `marked`. Also imported by the app's Share button. |
| `styles.css` | The POC's own interface styles. |
| `pdf.test.js` | `node --test` coverage for the renderer. |

## Tests

```sh
npm test
```

The suite checks the PDF envelope, font references, WinAnsi escaping, links,
wrapping, pagination, lists, code, tables and deterministic output. Rendering
the result with Ghostscript is a useful extra check:

```sh
gs -q -dNOPAUSE -dBATCH -dPDFSTOPONERROR -sDEVICE=nullpage note.pdf
```

## Publishing

This folder is not in `publish.sh`'s site whitelist. It is a local POC branch,
not part of the deployed Taisce app.

---

This file was written with an AI coding assistant.
Assisted-by: Claude Code (deepseek-flash)
