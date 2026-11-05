// A deliberately small Markdown -> PDF renderer.
//
// There is no PDF library here: the file is written directly as PDF objects,
// using the five base-14 fonts every viewer already has. Nothing is rasterised,
// so memory stays close to the size of the text and CPU is spent on tokenising
// and laying out lines once. `marked` (already vendored by the app) supplies the
// Markdown tree; everything below lays that tree out as text on A4 pages.
//
// The subset is the one a note actually needs: headings, paragraphs, bold,
// italic, inline code, fenced code, bullet/numbered/task lists, blockquotes,
// rules, simple tables and clickable links. Images become their alt text,
// because embedding them would mean decoding and re-encoding their bytes.

import { lexer } from '../vendor/marked.esm.js';

export const PAGE_WIDTH = 595.28; // A4, points
export const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 62;
const BODY_SIZE = 11;
const BODY_LEADING = 15.5;
const HEADING_SIZE = [0, 22, 17, 14, 12, 11, 11];
const LINK_COLOR = [0.137, 0.161, 0.478];
const QUOTE_COLOR = [0.36, 0.38, 0.46];
const CODE_COLOR = [0.13, 0.15, 0.24];
const RULE_COLOR = [0.78, 0.8, 0.86];

const FONT_NAMES = {
  F1: 'Helvetica',
  F2: 'Helvetica-Bold',
  F3: 'Helvetica-Oblique',
  F4: 'Helvetica-BoldOblique',
  F5: 'Courier',
};

// Character widths from the base-14 AFM metrics, in 1/1000 em, for ASCII 32-126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const COURIER_WIDTH = 600;

const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const DECODE_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const hex = name[1] === 'x' || name[1] === 'X';
      const value = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    }
    return DECODE_ENTITIES[name.toLowerCase()] ?? match;
  });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
}

/** Convert one Unicode code point to its WinAnsi byte, or `?`. */
export function winAnsiCode(codePoint) {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return WIN_ANSI.get(codePoint) ?? 0x3f;
}

/** Escape a JS string as a PDF literal string, using only ASCII bytes. */
export function pdfString(value) {
  let out = '';
  for (const character of String(value ?? '')) {
    const code = winAnsiCode(character.codePointAt(0));
    if (code === 0x5c || code === 0x28 || code === 0x29) {
      out += `\\${String.fromCharCode(code)}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += String.fromCharCode(code);
    } else {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    }
  }
  return out;
}

function charWidth(code, font) {
  if (font === 'F5') return COURIER_WIDTH;
  const table = font === 'F2' || font === 'F4' ? HELVETICA_BOLD : HELVETICA;
  if (code >= 0x20 && code <= 0x7e) return table[code - 0x20];
  if (code === 0x2022) return 350;
  if (code === 0x2018 || code === 0x2019) return 333;
  if (code === 0x201c || code === 0x201d) return 333;
  if (code === 0x2013 || code === 0x2014) return table['-'.charCodeAt(0) - 0x20];
  if (code === 0x2026) return table['.'.charCodeAt(0) - 0x20];
  // Accented Latin letters are close enough to their base letter for wrapping.
  if (code >= 0xa0 && code <= 0xff) {
    const base = String.fromCharCode(code).normalize('NFD')[0];
    if (base.length === 1 && base >= ' ' && base <= '~') {
      return table[base.charCodeAt(0) - 0x20];
    }
    return table['?'.charCodeAt(0) - 0x20];
  }
  return table['?'.charCodeAt(0) - 0x20];
}

function measure(text, run) {
  let width = 0;
  for (const character of text) width += charWidth(character.codePointAt(0), run.font);
  return (width * run.size) / 1000;
}

function fontFor(style) {
  if (style.code) return 'F5';
  if (style.bold && style.italic) return 'F4';
  if (style.bold) return 'F2';
  if (style.italic) return 'F3';
  return 'F1';
}

function colorFor(style, link) {
  if (link) return LINK_COLOR;
  if (style.color) return style.color;
  if (style.code) return CODE_COLOR;
  return null;
}

function makeRun(text, style, link = null) {
  return {
    text,
    font: fontFor(style),
    size: style.size ?? (style.code ? 9.8 : BODY_SIZE),
    color: colorFor(style, link),
    link: link && isSafeLink(link) ? link : null,
  };
}

function isSafeLink(href) {
  return /^(?:https?:|mailto:|ftp:)/i.test(String(href || ''));
}

function pushText(runs, text, style, link = null) {
  const clean = decodeEntities(String(text ?? '')).replace(/\s+/g, ' ');
  if (clean) runs.push(makeRun(clean, style, link));
}

// Inline code keeps its spaces for the same reason a code block does: they can
// be the difference between one value and another.
function pushCodeText(runs, text, style, link = null) {
  const clean = decodeEntities(String(text ?? ''));
  if (clean) runs.push(makeRun(clean, style, link));
}

function inlineRuns(tokens, style = {}, link = null) {
  const runs = [];
  for (const token of tokens || []) {
    switch (token.type) {
      case 'text':
        if (token.tokens?.length) runs.push(...inlineRuns(token.tokens, style, link));
        else pushText(runs, token.text, style, link);
        break;
      case 'escape':
        pushText(runs, token.text, style, link);
        break;
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...style, bold: true }, link));
        break;
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...style, italic: true }, link));
        break;
      case 'del':
        runs.push(...inlineRuns(token.tokens, style, link));
        break;
      case 'codespan':
        pushCodeText(runs, token.text, { ...style, code: true, size: style.size ? style.size * 0.9 : 9.8 }, link);
        break;
      case 'link':
        runs.push(...inlineRuns(token.tokens, style, token.href));
        break;
      case 'image':
        pushText(runs, token.text || 'image', { ...style, italic: true }, link);
        break;
      case 'br':
        runs.push({ break: true });
        break;
      case 'html':
        pushText(runs, stripTags(token.text || token.raw), style, link);
        break;
      default:
        if (token.tokens?.length) runs.push(...inlineRuns(token.tokens, style, link));
        else if (token.text) pushText(runs, token.text, style, link);
    }
  }
  return runs;
}

function sameRun(a, b) {
  return a.font === b.font && a.size === b.size && a.color === b.color && a.link === b.link;
}

function mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (run.break) {
      merged.push(run);
    } else if (previous && !previous.break && sameRun(previous, run)) {
      previous.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function splitWord(word, run, maxWidth) {
  const chunks = [];
  let chunk = '';
  for (const character of word) {
    const next = chunk + character;
    if (chunk && measure(next, run) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function atomsFor(runs, maxWidth) {
  const atoms = [];
  for (const run of mergeRuns(runs)) {
    if (run.break) {
      atoms.push({ type: 'break' });
      continue;
    }
    // Code runs break only at the margin, never at a space, so indentation and
    // repeated spaces are not lost to the prose layout.
    if (run.font === 'F5') {
      const chunks =
        measure(run.text, run) > maxWidth ? splitWord(run.text, run, maxWidth) : [run.text];
      for (const chunk of chunks) {
        atoms.push({ type: 'word', text: chunk, run, width: measure(chunk, run) });
      }
      continue;
    }
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        atoms.push({ type: 'space', run, width: measure(' ', run) });
        continue;
      }
      const chunks = measure(part, run) > maxWidth ? splitWord(part, run, maxWidth) : [part];
      for (const chunk of chunks) {
        atoms.push({ type: 'word', text: chunk, run, width: measure(chunk, run) });
      }
    }
  }
  return atoms;
}

function wrapRuns(runs, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;
  let pendingSpace = null;

  const flush = () => {
    while (line.length && line[line.length - 1].type === 'space') line.pop();
    lines.push(line);
    line = [];
    width = 0;
    pendingSpace = null;
  };

  for (const atom of atomsFor(runs, maxWidth)) {
    if (atom.type === 'break') {
      flush();
      continue;
    }
    if (atom.type === 'space') {
      if (line.length) pendingSpace = atom;
      continue;
    }

    const gap = pendingSpace ? pendingSpace.width : 0;
    if (line.length && width + gap + atom.width > maxWidth) flush();
    if (line.length && pendingSpace) {
      line.push(pendingSpace);
      width += pendingSpace.width;
    }
    line.push(atom);
    width += atom.width;
    pendingSpace = null;
  }

  if (line.length || !lines.length) flush();
  return lines;
}

function linePieces(line) {
  const pieces = [];
  for (const atom of line) {
    if (atom.type !== 'word' && atom.type !== 'space') continue;
    const piece = { ...atom.run, text: atom.type === 'space' ? ' ' : atom.text };
    const previous = pieces[pieces.length - 1];
    if (previous && sameRun(previous, piece)) previous.text += piece.text;
    else pieces.push(piece);
  }
  return pieces;
}

function tint([r, g, b]) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

class PdfDocument {
  constructor(title) {
    this.title = title || 'Untitled';
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    if (this.page) this.pages.push(this.page);
    this.page = { content: [], annots: [] };
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  rect(x, y, width, height, color) {
    this.page.content.push(
      `q ${tint(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`,
    );
  }

  line(x1, y1, x2, y2, color, width = 0.6) {
    this.page.content.push(
      `q ${tint(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`,
    );
  }

  drawLine(line, x, y, options = {}) {
    const pieces = linePieces(line);
    if (!pieces.length) return;
    let cursor = x;
    for (const piece of pieces) {
      const width = measure(piece.text, piece);
      if (piece.text.trim()) {
        const output = pdfString(piece.text);
        const color = piece.color ? `${tint(piece.color)} rg ` : '0 0 0 rg ';
        this.page.content.push(
          `BT ${color}/${piece.font} ${piece.size} Tf 1 0 0 1 ${cursor.toFixed(2)} ${y.toFixed(2)} Tm (${output}) Tj ET`,
        );
        if (piece.link) {
          this.line(cursor, y - 1.4, cursor + width, y - 1.4, piece.color || LINK_COLOR, 0.5);
          this.page.annots.push({
            rect: [cursor, y - 2.2, cursor + width, y + piece.size * 0.86],
            uri: piece.link,
          });
        }
      }
      cursor += width;
    }
    if (options.quote) {
      const height = options.leading || BODY_LEADING;
      this.rect(x - 11, y - 3, 2.2, height + 1, RULE_COLOR);
    }
  }

  drawBlockLines(runs, x, maxWidth, leading, options = {}) {
    const lines = wrapRuns(runs, maxWidth);
    for (const line of lines) {
      this.ensure(leading);
      this.drawLine(line, x, this.y, { ...options, leading });
      this.y -= leading;
    }
    return lines.length;
  }

  renderBlocks(tokens, context = {}) {
    const ctx = {
      indent: 0,
      width: CONTENT_WIDTH,
      color: null,
      quote: false,
      listLevel: 0,
      ...context,
    };

    for (const token of tokens || []) this.renderBlock(token, ctx);
  }

  renderBlock(token, ctx) {
    switch (token.type) {
      case 'space':
      case 'def':
        return;
      case 'heading':
        this.renderHeading(token, ctx);
        return;
      case 'paragraph':
        this.renderParagraph(token.tokens, ctx);
        return;
      case 'text':
        this.renderParagraph(token.tokens || [token], ctx);
        return;
      case 'list':
        this.renderList(token, ctx);
        return;
      case 'blockquote':
        this.renderBlockquote(token, ctx);
        return;
      case 'code':
        this.renderCode(token, ctx);
        return;
      case 'hr':
        this.renderRule(ctx);
        return;
      case 'table':
        this.renderTable(token, ctx);
        return;
      case 'html':
        this.renderParagraph([{ type: 'text', text: stripTags(token.text || token.raw) }], ctx);
        return;
      default:
        if (token.tokens?.length) this.renderBlocks(token.tokens, ctx);
    }
  }

  renderHeading(token, ctx) {
    const depth = Math.min(Math.max(token.depth || 1, 1), 6);
    const size = HEADING_SIZE[depth];
    const leading = size * 1.28;
    this.y -= depth === 1 ? 16 : 12;
    this.ensure(leading + 8);
    const style = { size, bold: true, color: ctx.color || [0.1, 0.12, 0.24] };
    const runs = inlineRuns(token.tokens, style);
    const x = MARGIN + ctx.indent;
    this.drawBlockLines(runs, x, ctx.width, leading, { quote: ctx.quote });
    this.y -= 5;
  }

  renderParagraph(tokens, ctx, overrides = {}) {
    const style = { size: BODY_SIZE, color: ctx.color, ...overrides };
    const runs = inlineRuns(tokens, style);
    if (!runs.length) return;
    const x = MARGIN + ctx.indent;
    this.drawBlockLines(runs, x, ctx.width, BODY_LEADING, { quote: ctx.quote });
    this.y -= 9;
  }

  renderList(token, ctx) {
    const start = Number.isFinite(Number(token.start)) ? Number(token.start) : 1;
    let number = token.ordered ? start : 0;

    for (const item of token.items || []) {
      const marker = item.task ? (item.checked ? '[x]' : '[ ]') : token.ordered ? `${number}.` : '•';
      if (token.ordered) number += 1;

      const markerWidth = item.task ? 22 : 18;
      const x = MARGIN + ctx.indent;
      const textX = x + markerWidth;
      const maxWidth = ctx.width - markerWidth;
      let first = true;

      for (const child of item.tokens || []) {
        if (child.type === 'list') {
          this.renderList(child, {
            ...ctx,
            indent: ctx.indent + markerWidth,
            width: ctx.width - markerWidth,
            listLevel: ctx.listLevel + 1,
          });
          continue;
        }

        const tokens = child.type === 'text' ? child.tokens || [child] : child.tokens || [];
        if (!tokens.length) continue;
        const runs = inlineRuns(tokens, { size: BODY_SIZE, color: ctx.color });
        if (!runs.length) continue;

        const lines = wrapRuns(runs, maxWidth);
        lines.forEach((line, index) => {
          this.ensure(BODY_LEADING);
          if (first && index === 0) {
            this.drawLine(
              [{
                type: 'word',
                text: marker,
                run: { font: 'F1', size: BODY_SIZE, color: ctx.color, link: null },
                width: 0,
              }],
              x,
              this.y,
              { quote: ctx.quote },
            );
            first = false;
          }
          this.drawLine(line, textX, this.y, { quote: ctx.quote });
          this.y -= BODY_LEADING;
        });
        this.y -= 2;
      }

      if (first) {
        this.y -= BODY_LEADING;
      }
    }
    this.y -= 6;
  }

  renderBlockquote(token, ctx) {
    this.y -= 2;
    this.renderBlocks(token.tokens, {
      ...ctx,
      indent: ctx.indent + 14,
      width: ctx.width - 14,
      quote: true,
      color: ctx.color || QUOTE_COLOR,
    });
    this.y -= 4;
  }

  renderCode(token, ctx) {
    const x = MARGIN + ctx.indent;
    const maxWidth = ctx.width - 10;
    const leading = 11.5;
    this.y -= 5;

    for (const sourceLine of String(token.text || '').replace(/\t/g, '  ').split('\n')) {
      const run = {
        font: 'F5',
        size: 8.6,
        color: CODE_COLOR,
        link: null,
      };
      const text = sourceLine || ' ';
      // Code is not prose: wrapping on spaces would drop the indentation and
      // collapse runs of spaces that carry meaning in Python, YAML and tables.
      // Split only where the line would run past the margin, character by
      // character, so every space in the source survives.
      const lines =
        measure(text, run) > maxWidth ? splitWord(text, run, maxWidth) : [text];
      for (const line of lines) {
        this.ensure(leading + 2);
        this.rect(x - 4, this.y - 9, maxWidth + 12, leading + 3, [0.955, 0.96, 0.98]);
        this.drawLine(
          [{ type: 'word', text: line, run, width: measure(line, run) }],
          x,
          this.y,
        );
        this.y -= leading;
      }
    }
    this.y -= 7;
  }

  renderRule(ctx) {
    this.ensure(18);
    this.y -= 7;
    const x = MARGIN + ctx.indent;
    this.line(x, this.y, x + ctx.width, this.y, RULE_COLOR, 0.7);
    this.y -= 11;
  }

  renderTable(token, ctx) {
    // Cells carry marked's inline tokens, so bold, code and links in a table
    // render like they do anywhere else; cell.text would print the markup.
    const rowRuns = (cells, style) => {
      const runs = [];
      (cells || []).forEach((cell, index) => {
        if (index) pushText(runs, ' | ', style);
        const tokens = cell.tokens?.length
          ? cell.tokens
          : [{ type: 'text', text: cell.text }];
        runs.push(...inlineRuns(tokens, style));
      });
      return runs;
    };

    const drawRow = (cells, style) => {
      const runs = rowRuns(cells, style);
      if (!runs.length) return;
      this.drawBlockLines(runs, MARGIN + ctx.indent, ctx.width, BODY_LEADING, {
        quote: ctx.quote,
      });
      this.y -= 9;
    };

    drawRow(token.header, {
      size: BODY_SIZE,
      bold: true,
      color: ctx.color || [0.1, 0.12, 0.24],
    });
    for (const row of token.rows || []) {
      drawRow(row, { size: BODY_SIZE, color: ctx.color });
    }
    this.y -= 2;
  }

  footer(number, total) {
    this.page.content.push(
      `BT 0.45 0.47 0.54 rg /F1 8 Tf 1 0 0 1 ${MARGIN} 28 Tm (Page ${number} of ${total}) Tj ET`,
    );
  }

  toBytes() {
    this.pages.push(this.page);
    this.page = null;
    this.pages.forEach((page, index) => {
      page.number = index + 1;
      this.page = page;
      this.footer(index + 1, this.pages.length);
    });
    this.page = null;

    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalog = add(null);
    const pages = add(null);
    const fontIds = Object.values(FONT_NAMES).map((base) =>
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`),
    );
    const info = add(`<< /Title (${pdfString(this.title)}) /Producer (Taisce) >>`);
    const fontRefs = Object.keys(FONT_NAMES)
      .map((name, index) => `/${name} ${fontIds[index]} 0 R`)
      .join(' ');
    const kids = [];

    for (const page of this.pages) {
      const pageId = add(null);
      const contentId = add(null);
      kids.push(`${pageId} 0 R`);
      const annotations = page.annots.map((annot) => {
        const id = add(
          `<< /Type /Annot /Subtype /Link /Rect [${annot.rect.map((n) => n.toFixed(2)).join(' ')}] ` +
            `/Border [0 0 0] /A << /S /URI /URI (${pdfString(annot.uri)}) >> >>`,
        );
        return `${id} 0 R`;
      });
      const content = page.content.join('\n') + '\n';
      objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      objects[pageId - 1] =
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << ${fontRefs} >> >> /Contents ${contentId} 0 R` +
        (annotations.length ? ` /Annots [${annotations.join(' ')}]` : '') +
        ' >>';
    }

    objects[pages - 1] =
      `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${this.pages.length} >>`;
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;

    const header = '%PDF-1.4\n';
    const chunks = [header];
    const offsets = [0];
    let offset = header.length;
    objects.forEach((body, index) => {
      offsets[index + 1] = offset;
      const object = `${index + 1} 0 obj\n${body}\nendobj\n`;
      chunks.push(object);
      offset += object.length;
    });

    const xrefOffset = offset;
    const xref = [
      'xref',
      `0 ${objects.length + 1}`,
      '0000000000 65535 f ',
      ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `),
      'trailer',
      `<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>`,
      'startxref',
      String(xrefOffset),
      '%%EOF',
      '',
    ].join('\n');
    chunks.push(xref);

    return new TextEncoder().encode(chunks.join(''));
  }
}

/**
 * Render Markdown to a PDF byte array.
 * @param {string} markdown
 * @param {{title?: string}} [options]
 * @returns {Uint8Array}
 */
export function markdownToPdf(markdown, { title = 'Untitled' } = {}) {
  const doc = new PdfDocument(title);
  const tokens = lexer(String(markdown ?? ''), { gfm: true });
  doc.renderBlocks(tokens);
  return doc.toBytes();
}

/**
 * The PDF shared beside a note: `notes/foo.md` -> `notes/foo.pdf`.
 * @param {string} notePath
 * @returns {string}
 */
export function pdfPathFor(notePath) {
  return String(notePath || '').replace(/\.md$/i, '') + '.pdf';
}

/**
 * True when these bytes are a PDF this app generated. Deleting `<note>.pdf`
 * must not take a PDF the reader made with another tool, so the share copy
 * identifies itself in the Producer entry. The info object is written before
 * the page objects, so its first few kilobytes are enough to tell.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isTaiscePdf(bytes) {
  if (!bytes || !bytes.length) return false;
  const head = new TextDecoder('latin1').decode(
    bytes.subarray(0, Math.min(bytes.length, 8192)),
  );
  return head.startsWith('%PDF-') && head.includes('/Producer (Taisce');
}
