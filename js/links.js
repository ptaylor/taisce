// Finding and rewriting the links inside one block's source.
//
// A link is almost never a line of its own: it sits in a sentence, a list item
// or a quote. So the editor does not re-serialise the Markdown to change one —
// it locates the link's exact span and splices the label and the destination,
// leaving every other character of the block untouched.
//
// Three shapes count as a link, because the renderer makes all three clickable:
// `[text](dest)`, `<autolink>` and a bare `https://…` that GFM links for us.
// Images, inline code and escapes are skipped, so `![alt](x.png)` and
// `` `https://example.com` `` are not offered up as editable links.

const ANGLE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+)>/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
const NEEDS_ANGLE_BRACKETS = /[\s()<>]/;

function escapeLabel(text) {
  return text.replace(/[\\[\]]/g, '\\$&');
}

function formatDestination(href) {
  if (href === '') return '';
  return NEEDS_ANGLE_BRACKETS.test(href) ? `<${href}>` : href;
}

/** The Markdown for a link, ready to drop into a document. */
export function linkMarkdown(text, href) {
  return `[${escapeLabel(text)}](${formatDestination(href.trim())})`;
}

/** True when the clipboard holds one URL and nothing else. */
export function isUrl(value) {
  return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(value.trim());
}

function runLength(source, at) {
  let length = 0;
  while (source[at + length] === '`') length += 1;
  return length;
}

// A code span's closing run must be the same length as its opening run, so a
// lone backtick cannot be closed by half of a double-backtick fence.
function skipCodeSpan(source, at) {
  const length = runLength(source, at);
  const pattern = new RegExp(`(?<!\`)\`{${length}}(?!\`)`, 'g');
  pattern.lastIndex = at + length;
  const match = pattern.exec(source);
  return match ? match.index + length : at + length;
}

function matchDelimiter(source, open, opening, closing) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return i;
    } else if (char === '\n' && source[i + 1] === '\n') return -1;
  }
  return -1;
}

function parseInlineLink(source, open) {
  const labelClose = matchDelimiter(source, open, '[', ']');
  if (labelClose === -1 || source[labelClose + 1] !== '(') return null;
  const destinationClose = matchDelimiter(source, labelClose + 1, '(', ')');
  if (destinationClose === -1) return null;

  const inside = source.slice(labelClose + 2, destinationClose);
  let at = 0;
  while (at < inside.length && /\s/.test(inside[at])) at += 1;

  let start = at;
  let end = at;
  let angled = false;
  if (inside[at] === '<') {
    const close = inside.indexOf('>', at + 1);
    if (close === -1) return null;
    start = at + 1;
    end = close;
    angled = true;
  } else {
    let depth = 0;
    while (end < inside.length) {
      const char = inside[end];
      if (char === '\\') {
        end += 2;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && /\s/.test(char)) break;
      end += 1;
    }
  }

  const base = labelClose + 2;
  return {
    form: 'inline',
    start: open,
    end: destinationClose + 1,
    labelStart: open + 1,
    labelEnd: labelClose,
    text: source.slice(open + 1, labelClose),
    href: inside.slice(start, end),
    hrefStart: base + start,
    hrefEnd: base + end,
    destinationStart: base + start,
    destinationEnd: base + end,
    angled,
  };
}

function trimBareEnd(source, start, end) {
  let at = end;
  for (;;) {
    const slice = source.slice(start, at);
    const punctuation = slice.match(TRAILING_PUNCTUATION);
    if (punctuation) {
      at -= punctuation[0].length;
      continue;
    }
    if (slice.endsWith(')')) {
      const opened = (slice.match(/\(/g) || []).length;
      const closed = (slice.match(/\)/g) || []).length;
      if (closed > opened) {
        at -= 1;
        continue;
      }
    }
    return at;
  }
}

/**
 * Every link in a block source, in the order the renderer will emit them.
 * @param {string} source
 * @returns {{form: string, start: number, end: number, text: string, href: string}[]}
 */
export function findLinks(source) {
  const links = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (char === '\\') {
      i += 2;
      continue;
    }

    if (char === '`') {
      i = skipCodeSpan(source, i);
      continue;
    }

    if (char === '<') {
      const match = ANGLE_AUTOLINK.exec(source.slice(i));
      if (match) {
        const href = match[1];
        links.push({
          form: 'autolink',
          start: i,
          end: i + match[0].length,
          text: href,
          href,
          hrefStart: i + 1,
          hrefEnd: i + 1 + href.length,
        });
        i += match[0].length;
        continue;
      }
      i += 1;
      continue;
    }

    if (char === '!' && source[i + 1] === '[') {
      const image = parseInlineLink(source, i + 1);
      i = image ? image.end : i + 1;
      continue;
    }

    if (char === '[') {
      const link = parseInlineLink(source, i);
      if (link) {
        links.push(link);
        i = link.end;
        continue;
      }
      i += 1;
      continue;
    }

    if (/[hw]/i.test(char) && !/[\w@]/.test(source[i - 1] || '')) {
      const match = BARE_URL.exec(source.slice(i));
      if (match) {
        const end = trimBareEnd(source, i, i + match[0].length);
        const raw = source.slice(i, end);
        const href = /^www\./i.test(raw) ? `http://${raw}` : raw;
        links.push({ form: 'bare', start: i, end, text: raw, href, hrefStart: i, hrefEnd: end });
        i = end;
        continue;
      }
    }

    i += 1;
  }

  return links;
}

/**
 * Rewrite one link in place. A link whose text is unchanged keeps its shape —
 * an autolink stays `<…>` — so retargeting a link does not restyle it.
 */
export function editLink(source, link, { text, href }) {
  const nextText = text ?? link.text;
  const nextHref = (href ?? link.href).trim();

  if (link.form !== 'inline') {
    if (nextText === link.text) {
      return source.slice(0, link.hrefStart) + nextHref + source.slice(link.hrefEnd);
    }
    return source.slice(0, link.start) + linkMarkdown(nextText, nextHref) + source.slice(link.end);
  }

  const withDestination =
    source.slice(0, link.destinationStart) +
    (link.angled ? `<${nextHref}>` : formatDestination(nextHref)) +
    source.slice(link.destinationEnd);

  return (
    withDestination.slice(0, link.labelStart) + escapeLabel(nextText) + withDestination.slice(link.labelEnd)
  );
}

/** Drop the link, keeping the words that were linked. */
export function removeLink(source, link) {
  const label =
    link.form === 'inline' ? source.slice(link.labelStart, link.labelEnd) : link.text;
  return source.slice(0, link.start) + label + source.slice(link.end);
}
