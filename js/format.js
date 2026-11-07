// Inline formatting from the keyboard, while a block is open for editing.
// Pure string and offset work: the editor owns the textarea, this module owns
// what the delimiters should be and where the caret lands.
//
// Markdown has no underline, so underline is the one format that writes HTML
// (`<u>…</u>`). It is inline markup the sanitizer already allows, and it never
// becomes a block of its own.

export const INLINE_FORMATS = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  underline: { open: '<u>', close: '</u>' },
  strike: { open: '~~', close: '~~' },
};

const SPACE = /\s/;

/**
 * Which format a keydown asks for, or null. Mod is Cmd on a Mac and Ctrl
 * elsewhere. Shift+Cmd/Ctrl+X for strikethrough is what Slack and Notion use,
 * and it stays clear of Cmd+Shift+S, the browser's own "Save As".
 *
 * @param {{key?: string, metaKey?: boolean, ctrlKey?: boolean,
 *          shiftKey?: boolean, altKey?: boolean, repeat?: boolean}} event
 */
export function shortcutFormat(event) {
  if (event.repeat) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;

  const key = String(event.key || '').toLowerCase();
  if (event.shiftKey) return key === 'x' ? 'strike' : null;

  switch (key) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'u':
      return 'underline';
    default:
      return null;
  }
}

function starsBefore(source, at) {
  let width = 0;
  while (at - width - 1 >= 0 && source[at - width - 1] === '*') width += 1;
  return width;
}

function starsAfter(source, at) {
  let width = 0;
  while (at + width < source.length && source[at + width] === '*') width += 1;
  return width;
}

// The delimiters immediately outside the selection, if they already carry the
// format. A run of two stars is bold, not italic: pressing Cmd+I inside
// `**bold**` nests italic instead of eating a star and turning bold into
// italic. Only an odd run is italic, so `***both***` loses one star per side.
function outerWrap(source, start, end, format) {
  if (format === 'bold' || format === 'italic') {
    const before = starsBefore(source, start);
    const after = starsAfter(source, end);
    const width = format === 'bold' ? 2 : 1;
    if (before < width || after < width) return null;
    if (format === 'italic' && (before % 2 === 0 || after % 2 === 0)) return null;
    return { open: width, close: width };
  }

  const { open, close } = INLINE_FORMATS[format];
  if (!source.slice(0, start).endsWith(open)) return null;
  if (!source.slice(end).startsWith(close)) return null;
  return { open: open.length, close: close.length };
}

// The delimiters inside the selection, when the whole wrapped phrase was
// selected: `**bold**` toggles back to `bold`.
function innerWrap(source, start, end, format) {
  if (format === 'bold' || format === 'italic') {
    const lead = starsAfter(source, start);
    const trail = starsBefore(source, end);
    const width = format === 'bold' ? 2 : 1;
    if (lead < width || trail < width) return null;
    if (lead + trail > end - start) return null; // a selection that is only stars
    if (format === 'italic' && (lead % 2 === 0 || trail % 2 === 0)) return null;
    return { open: width, close: width };
  }

  const { open, close } = INLINE_FORMATS[format];
  const selected = source.slice(start, end);
  if (selected.length < open.length + close.length) return null;
  if (!selected.startsWith(open) || !selected.endsWith(close)) return null;
  return { open: open.length, close: close.length };
}

/**
 * Apply a format to a selection, or take it off when the selection already
 * has it. Returns the whole new source and the selection to put back.
 *
 * @returns {{text: string, start: number, end: number}}
 */
export function formatSelection(source, start, end, format) {
  const spec = INLINE_FORMATS[format];
  if (!spec) return { text: source, start, end };

  const inner = innerWrap(source, start, end, format);
  if (inner) {
    return {
      text:
        source.slice(0, start) +
        source.slice(start + inner.open, end - inner.close) +
        source.slice(end),
      start,
      end: end - inner.open - inner.close,
    };
  }

  const outer = outerWrap(source, start, end, format);
  if (outer) {
    return {
      text:
        source.slice(0, start - outer.open) +
        source.slice(start, end) +
        source.slice(end + outer.close),
      start: start - outer.open,
      end: end - outer.open,
    };
  }

  // `** text **` does not render, so spaces at the edges stay outside the
  // delimiters.
  let coreStart = start;
  let coreEnd = end;
  while (coreStart < coreEnd && SPACE.test(source[coreStart])) coreStart += 1;
  while (coreEnd > coreStart && SPACE.test(source[coreEnd - 1])) coreEnd -= 1;
  if (coreStart === coreEnd) return { text: source, start, end };

  return {
    text:
      source.slice(0, coreStart) +
      spec.open +
      source.slice(coreStart, coreEnd) +
      spec.close +
      source.slice(coreEnd),
    start: coreStart + spec.open.length,
    end: coreEnd + spec.open.length,
  };
}

/**
 * Start a format for typing into: insert the empty pair and put the caret
 * between the two halves. The editor tracks where it is; the closing half is
 * already there, so ordinary typing stays inside it.
 *
 * @returns {{text: string, caret: number}|null}
 */
export function startFormat(source, at, format) {
  const spec = INLINE_FORMATS[format];
  if (!spec) return null;
  return {
    text: source.slice(0, at) + spec.open + spec.close + source.slice(at),
    caret: at + spec.open.length,
  };
}

/**
 * Where the closing half of a typing format is, or -1 when the opening half
 * has been deleted or is no longer where the editor thought it was.
 */
export function closeOfFormat(source, openStart, format) {
  const spec = INLINE_FORMATS[format];
  if (!spec || !source.startsWith(spec.open, openStart)) return -1;
  return source.indexOf(spec.close, openStart + spec.open.length);
}
