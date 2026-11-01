// Finding and rewriting the links inside one block's source.
//
// A link is almost never a line of its own: it sits in a sentence, a list item
// or a quote. So the editor does not re-serialise the Markdown to change one —
// it locates the link's exact span and splices the label and the destination,
// leaving every other character of the block untouched.
//
// Three shapes count as a link, because the renderer makes all three clickable:
// `[text](dest)`, `<autolink>` and the bare URLs and addresses that GFM links
// for us. Images, inline code and escapes are skipped, so `![alt](x.png)` and
// `` `https://example.com` `` are not offered up as editable links.
//
// The bare-URL rules are `marked`'s own, character for character, because the
// two must agree on where a link ends: if they disagree, the editor either
// leaves a link uneditable or offers to edit characters that belong to the next
// word. `test/links.test.js` renders a corpus and asserts the two agree.

const ANGLE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+)>/;
// marked's inline.gfm.url, minus the `email` placeholder.
const BARE_URL = /^(?:(?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/i;
const BARE_EMAIL = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/;
// marked's `_backpedal`: the trailing punctuation a bare URL gives back.
const BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const NEEDS_ANGLE_BRACKETS = /[\s()<>]/;
// The longest local part an address may have, used to skip the address rule
// quickly for text that cannot contain one.
const LOCAL_PART_LIMIT = 64;

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

function trimBareUrl(raw) {
  let text = raw;
  let previous;
  do {
    previous = text;
    text = BACKPEDAL.exec(text)?.[0] ?? '';
  } while (previous !== text);
  return text;
}

/**
 * Every link in a block source, in the order the renderer will emit them.
 * @param {string} source
 * @returns {{form: string, start: number, end: number, text: string, href: string}[]}
 */
export function findLinks(source) {
  const links = [];
  // Distance to the next "@", so text that cannot hold an address is skipped
  // without scanning to the end of the block for every character.
  const nextAt = new Uint32Array(source.length + 1).fill(LOCAL_PART_LIMIT + 1);
  for (let i = source.length - 1; i >= 0; i -= 1) {
    nextAt[i] = source[i] === '@' ? 0 : Math.min(nextAt[i + 1] + 1, LOCAL_PART_LIMIT + 1);
  }

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

    const rest = source.slice(i);

    if (nextAt[i] <= LOCAL_PART_LIMIT) {
      const address = BARE_EMAIL.exec(rest);
      if (address) {
        links.push({
          form: 'address',
          start: i,
          end: i + address[0].length,
          text: address[0],
          href: `mailto:${address[0]}`,
          hrefStart: i,
          hrefEnd: i + address[0].length,
        });
        i += address[0].length;
        continue;
      }
    }

    const url = BARE_URL.exec(rest);
    if (url) {
      const text = trimBareUrl(url[0]);
      if (text.length > 0) {
        const href = /^www\./i.test(text) ? `http://${text}` : text;
        links.push({
          form: 'bare',
          start: i,
          end: i + text.length,
          text,
          href,
          hrefStart: i,
          hrefEnd: i + text.length,
        });
        i += text.length;
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
      // An address is written without its scheme, so a mailto: destination goes
      // back into the source as the bare address it came from.
      const target =
        link.form === 'address' && /^mailto:/i.test(nextHref)
          ? nextHref.replace(/^mailto:/i, '')
          : nextHref;
      return source.slice(0, link.hrefStart) + target + source.slice(link.hrefEnd);
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
