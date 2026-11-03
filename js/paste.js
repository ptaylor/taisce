// A blockquote marker at the start of a line, with its indentation and any
// nesting: `> `, `>> `, `  > > `.
const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]*)+/;

/**
 * Keep a multi-line paste inside the blockquote it is pasted into.
 *
 * Markdown ends a blockquote at the first line without a `>` marker, so a plain
 * paste leaves only its first line quoted. Every pasted line after the first
 * gets the marker of the line the selection starts on. The first line needs one
 * too only when the selection also covers the existing marker, because a marker
 * to the left of the selection survives the paste.
 *
 * @param {string} value the textarea's value before the paste
 * @param {number} start the selection start, an offset into `value`
 * @param {string} pasted plain text from the clipboard
 * @returns {string|null} the text that replaces the selection, or null to let
 *   the browser paste as usual
 */
export function quotePaste(value, start, pasted) {
  // Clipboard line endings vary by platform; the textarea holds `\n`.
  const text = pasted.replace(/\r\n?/g, '\n');
  if (!text.includes('\n')) return null;

  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', lineStart);
  const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
  const marker = line.match(QUOTE_PREFIX);
  if (!marker) return null;

  const prefix = marker[0];
  const lines = text.split('\n');
  if (start < lineStart + prefix.length) lines[0] = prefix + lines[0];

  return lines.map((line, index) => (index === 0 ? line : prefix + line)).join('\n');
}
