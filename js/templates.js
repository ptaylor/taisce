// Templates offered by the slash menu. `|` marks where the caret should land;
// it is stripped before insertion. Pure data and pure functions, so the
// trigger rules can be tested without a DOM.

export const TEMPLATES = [
  { id: 'task', label: 'Task list', hint: '- [ ]', insert: '- [ ] |', keywords: ['todo', 'checkbox', 'check', 'tick'] },
  { id: 'bullet', label: 'Bullet list', hint: '-', insert: '- |', keywords: ['list', 'unordered'] },
  { id: 'number', label: 'Numbered list', hint: '1.', insert: '1. |', keywords: ['ordered', 'list'] },
  { id: 'h2', label: 'Heading', hint: '##', insert: '## |', keywords: ['title', 'header'] },
  { id: 'h3', label: 'Subheading', hint: '###', insert: '### |', keywords: ['smaller heading', 'header'] },
  { id: 'code', label: 'Code block', hint: '```', insert: '```\n|\n```', keywords: ['snippet', 'pre', 'code'] },
  { id: 'quote', label: 'Quote', hint: '>', insert: '> |', keywords: ['blockquote', 'citation'] },
  { id: 'table', label: 'Table', hint: '| |', insert: '| | |\n| --- | --- |\n| | |', keywords: ['grid', 'columns'] },
  { id: 'rule', label: 'Divider', hint: '---', insert: '---', keywords: ['horizontal', 'line', 'separator'] },
  { id: 'link', label: 'Link', hint: '[ ]( )', insert: '[|](url)', keywords: ['url', 'anchor'] },
];

/**
 * The slash menu opens only when the whole current line is "/" followed by a
 * short query and the caret sits at its end. That keeps typing "and/or", a
 * date, or a path from ever popping it open.
 *
 * @param {string} text
 * @param {number} caret
 * @returns {{start: number, end: number, query: string}|null}
 */
export function detectSlash(text, caret = text.length) {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineBefore = before.slice(lineStart);
  const restOfLine = text.slice(caret).split('\n')[0];

  if (restOfLine.length > 0) return null;

  // One word only: no spaces, so prose that starts with a slash stays prose.
  const match = lineBefore.match(/^\/([\p{L}0-9]{0,12})$/u);
  if (!match) return null;

  return { start: lineStart, end: caret, query: match[1].trim().toLowerCase() };
}

/**
 * @param {string} query
 * @returns {typeof TEMPLATES}
 */
export function matchTemplates(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return TEMPLATES;

  const scored = [];
  for (const template of TEMPLATES) {
    const label = template.label.toLowerCase();
    const words = (template.keywords || []).join(' ');
    if (label.startsWith(needle)) scored.push([0, template]);
    else if (label.includes(needle) || words.includes(needle) || template.id.includes(needle)) {
      scored.push([1, template]);
    }
  }

  return scored.sort((a, b) => a[0] - b[0]).map(([, template]) => template);
}

/** Split a template into the text to insert and where the caret belongs. */
export function expandTemplate(template) {
  const marker = template.insert.indexOf('|');
  if (marker === -1) return { text: template.insert, caret: template.insert.length };
  return { text: template.insert.replace('|', ''), caret: marker };
}
