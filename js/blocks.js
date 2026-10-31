// Splitting a document into blocks that keep their exact source.
//
// The one rule: a block's `source` is `text.slice(block.start, block.end)`, and
// replacing a block with its own source returns the document unchanged. Editing
// a heading must not reformat the paragraph below it, because the file is also
// read by other editors and devices.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const QUOTE = /^ {0,3}>/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-{1,}[ \t]*(?:\|[ \t]*:?-{1,}[ \t]*)*\|?[ \t]*$/;
const TASK = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])/;

function lineStarts(lines) {
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1; // the newline that followed it
  }
  return starts;
}

function isTableStart(lines, i) {
  const head = lines[i];
  const next = lines[i + 1];
  return (
    head !== undefined &&
    next !== undefined &&
    head.includes('|') &&
    next.includes('-') &&
    TABLE_DELIM.test(next)
  );
}

function isFenceClose(line, fence) {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length &&
    trimmed[0] === fence[0] &&
    trimmed === fence[0].repeat(trimmed.length)
  );
}

/**
 * @param {string} text
 * @returns {{type: string, start: number, end: number, source: string}[]}
 */
export function parseBlocks(text) {
  const lines = text.split('\n');
  const starts = lineStarts(lines);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i += 1;
      continue;
    }

    let type;
    const first = i;
    const open = lines[i].match(FENCE_OPEN);

    if (open) {
      type = 'code';
      const fence = open[1];
      i += 1;
      while (i < lines.length && !isFenceClose(lines[i], fence)) i += 1;
      if (i < lines.length) i += 1;
    } else if (HEADING.test(lines[i])) {
      type = 'heading';
      i += 1;
    } else if (RULE.test(lines[i])) {
      type = 'rule';
      i += 1;
    } else if (QUOTE.test(lines[i])) {
      type = 'quote';
      while (i < lines.length && lines[i].trim() !== '' && QUOTE.test(lines[i])) i += 1;
    } else if (isTableStart(lines, i)) {
      type = 'table';
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) i += 1;
    } else if (LIST_ITEM.test(lines[i])) {
      type = 'list';
      while (i < lines.length && lines[i].trim() !== '') i += 1;
    } else {
      type = 'paragraph';
      while (i < lines.length && lines[i].trim() !== '') i += 1;
    }

    const last = i - 1;
    const start = starts[first];
    const end = starts[last] + lines[last].length;
    blocks.push({ type, start, end, source: text.slice(start, end) });
  }

  return blocks;
}

/**
 * Replace one block's source, leaving every other character alone.
 * @param {string} text
 * @param {{start: number, end: number}} block
 * @param {string} source
 */
export function applyBlockEdit(text, block, source) {
  return text.slice(0, block.start) + source + text.slice(block.end);
}

/**
 * Apply several block replacements at once. Edits are matched by index against
 * the blocks parsed from `text`, so this is the merge path: remote text in,
 * locally edited blocks re-applied on top.
 *
 * @param {string} text
 * @param {{index: number, source: string, type?: string}[]} edits
 * @returns {string|null} null when the structure changed and the merge is unsafe
 */
export function applyBlockEdits(text, edits) {
  const blocks = parseBlocks(text);
  const plan = [];

  for (const edit of edits) {
    const block = blocks[edit.index];
    if (!block) return null;
    if (edit.type && block.type !== edit.type) return null;
    plan.push({ start: block.start, end: block.end, source: edit.source });
  }

  // Right-to-left so earlier offsets stay valid.
  plan.sort((a, b) => b.start - a.start);

  let merged = text;
  for (const item of plan) {
    merged = merged.slice(0, item.start) + item.source + merged.slice(item.end);
  }
  return merged;
}

/**
 * The state of every task item in a block, in document order. Used to map the
 * checkboxes marked rendered back to the lines that produced them.
 * @param {{source: string}} block
 * @returns {{checked: boolean, index: number}[]}
 */
export function taskStates(block) {
  const states = [];
  let offset = 0;
  for (const line of block.source.split('\n')) {
    const match = line.match(TASK);
    if (match) states.push({ checked: match[2].toLowerCase() === 'x', index: offset + match[1].length });
    offset += line.length + 1;
  }
  return states;
}

/**
 * Flip the Nth task item in a block. Returns `text` unchanged if there is no
 * such item, so a stale click cannot corrupt the file.
 *
 * @param {string} text
 * @param {{start: number, source: string}} block
 * @param {number} itemIndex
 * @param {boolean} checked
 */
export function setTaskChecked(text, block, itemIndex, checked) {
  const state = taskStates(block)[itemIndex];
  if (!state) return text;
  const at = block.start + state.index;
  const current = text[at];
  if (current !== ' ' && current.toLowerCase() !== 'x') return text;
  const next = checked ? 'x' : ' ';
  if (current === next) return text;
  return text.slice(0, at) + next + text.slice(at + 1);
}

export const BLOCK_TYPES = ['heading', 'paragraph', 'list', 'code', 'quote', 'table', 'rule'];
