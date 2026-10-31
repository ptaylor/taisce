import { parseBlocks, applyBlockEdit, setTaskChecked, taskStates } from './blocks.js';
import { createHistory } from './history.js';
import { renderMarkdown } from './markdown.js';

const LIST_PREFIX = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/;

// A relative image is in Dropbox, not on this web server. Point the element at
// a blank pixel first, or the browser requests the path from the server and
// logs a 404 before hydration replaces it.
const BLANK_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function nextMarker(marker) {
  const numbered = marker.match(/^(\d{1,9})([.)])$/);
  if (numbered) return `${Number(numbered[1]) + 1}${numbered[2]}`;
  return marker;
}

/**
 * Rendered Markdown, edited in place. A block shows its source only while it
 * has the caret; leaving it re-renders from the source, so typing `## ` turns
 * the block into a heading and there is no toolbar to learn.
 *
 * History records source-range operations, not snapshots: one entry per block
 * edit session, one per tick, one per structural change.
 */
export function createEditor({
  container,
  onChange = () => {},
  onStatus = () => {},
  onHistory = () => {},
  resolveImage,
  onPasteImage,
  undoLimit = 50,
}) {
  let text = '';
  let editing = -1;
  let editBlock = null;
  const edits = new Map();
  const history = createHistory(undoLimit);

  const notifyHistory = () => onHistory({ canUndo: history.canUndo(), canRedo: history.canRedo() });

  function requireNewImage(src) {
    if (!resolveImage) return null;
    return Promise.resolve(resolveImage(src)).catch(() => null);
  }

  // Images live in Dropbox, not on the web server, so each one is fetched and
  // swapped for an object URL after the block is rendered.
  function hydrateImages(scope) {
    if (!resolveImage) return;
    for (const image of scope.querySelectorAll('img')) {
      const src = image.dataset.src;
      if (!src) continue;
      requireNewImage(src).then((url) => {
        if (url && image.isConnected) image.src = url;
      });
    }
  }

  // Images inside a note are not trusted to make requests. A Dropbox object is
  // fetched with the user's token and shown from an object URL; anything remote
  // becomes a link the reader can choose to follow, so opening a note never
  // reveals their address to whoever wrote it.
  //
  // This runs on a parsed-but-detached document, before the markup is inserted:
  // an <img> with a remote src fetches even in a detached div, so replacing it
  // afterwards would already have leaked the request.
  function sandboxHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    for (const image of doc.querySelectorAll('img')) {
      const src = image.getAttribute('src') || '';
      if (!src) continue;

      if (/^(?:data|blob):/i.test(src)) continue;
      if (!ABSOLUTE_URL.test(src)) {
        image.dataset.src = src;
        image.src = BLANK_PIXEL;
        continue;
      }

      const link = doc.createElement('a');
      link.setAttribute('href', src);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.className = 'remote-image';
      link.textContent = image.getAttribute('alt') || 'Remote image';
      image.replaceWith(link);
    }

    return doc.body.innerHTML;
  }

  function taskStatesOf(blockIndex) {
    const block = parseBlocks(text)[blockIndex];
    if (!block) return [];
    return block.source
      .split('\n')
      .map((line) => line.match(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/))
      .filter(Boolean)
      .map((match) => match[2].toLowerCase() === 'x');
  }

  function render({ keepScroll = true } = {}) {
    const scrollY = window.scrollY;
    const blocks = parseBlocks(text);

    container.replaceChildren();
    editing = -1;
    editBlock = null;

    if (blocks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'block empty';
      empty.dataset.index = '0';
      empty.textContent = 'This file is empty. Tap here to write.';
      container.appendChild(empty);
    } else {
      blocks.forEach((block, index) => {
        const el = document.createElement('div');
        el.className = `block ${block.type}`;
        el.dataset.index = String(index);
        el.innerHTML = sandboxHtml(renderMarkdown(block.source));

        const states = taskStatesOf(index);
        el.querySelectorAll('input[type="checkbox"]').forEach((box, i) => {
          if (i >= states.length) return;
          box.disabled = false;
          box.dataset.item = String(i);
          box.dataset.block = String(index);
          box.setAttribute('aria-label', `Task ${i + 1}`);
        });

        hydrateImages(el);
        container.appendChild(el);
      });
    }

    if (keepScroll) window.scrollTo(0, scrollY);
  }

  function setText(next) {
    text = next;
    edits.clear();
    history.clear();
    render();
    notifyHistory();
  }

  function beginEdit(blockEl) {
    if (editing !== -1) return;

    const index = Number(blockEl.dataset.index);
    const block = parseBlocks(text)[index] || { start: 0, end: 0, source: '', type: 'paragraph' };
    const before = block.source;

    const textarea = document.createElement('textarea');
    textarea.className = 'src';
    textarea.rows = 1;
    textarea.spellcheck = false;
    textarea.value = block.source;
    textarea.dataset.index = String(index);

    // The block grows and shrinks as you type, so the span must grow with it.
    // Only the requested edit touches the document; offsets before it are stable.
    let span = { start: block.start, end: block.end, source: block.source, type: block.type };

    blockEl.replaceChildren(textarea);
    blockEl.classList.add('editing');
    editing = index;
    editBlock = span;

    autosize(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const commit = () => {
      if (editing !== index) return;
      if (span.source !== before) {
        history.record({ start: span.start, before, after: span.source });
        notifyHistory();
      }
      render();
    };

    textarea.addEventListener('input', () => {
      const next = applyBlockEdit(text, span, textarea.value);
      if (next === text) return;
      text = next;
      span = { ...span, end: span.start + textarea.value.length, source: textarea.value };
      editBlock = span;
      edits.set(index, { source: textarea.value, type: block.type });
      autosize(textarea);
      onStatus('editing');
      onChange(text);
    });

    textarea.addEventListener('blur', commit);

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        textarea.blur();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        const beforeCaret = textarea.value.slice(0, textarea.selectionStart);
        const line = beforeCaret.slice(beforeCaret.lastIndexOf('\n') + 1);
        const match = line.match(LIST_PREFIX);
        if (match) {
          event.preventDefault();
          const marker = nextMarker(match[2]);
          const box = match[3] ? '[ ] ' : '';
          textarea.setRangeText(
            `\n${match[1]}${marker} ${box}`,
            textarea.selectionStart,
            textarea.selectionEnd,
            'end',
          );
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }

      if (event.key === 'Backspace' && textarea.value === '' && !event.isComposing) {
        event.preventDefault();
        removeBlock(index);
      }
    });
  }

  function removeBlock(index) {
    const block = parseBlocks(text)[index];
    if (!block) return;

    const before = text;
    const head = text.slice(0, block.start).replace(/\n+$/, '');
    const tail = text.slice(block.end).replace(/^\n+/, '');
    text = [head, tail].filter(Boolean).join('\n\n');

    history.record({ start: 0, before, after: text });
    edits.clear();
    notifyHistory();
    onStatus('editing');
    onChange(text);
    render();
    const previous = container.querySelector(`.block[data-index="${Math.max(0, index - 1)}"]`);
    if (previous) beginEdit(previous);
  }

  function toggleTask(box) {
    const blockIndex = Number(box.dataset.block);
    const itemIndex = Number(box.dataset.item);
    const blocks = parseBlocks(text);
    const block = blocks[blockIndex];
    if (!block) return;

    const next = setTaskChecked(text, block, itemIndex, box.checked);
    if (next === text) return;

    const before = text;
    text = next;
    const position = before.split('').findIndex((char, i) => char !== text[i]);
    if (position >= 0) {
      history.record({ start: position, before: before[position], after: text[position] });
      notifyHistory();
    }

    const updated = parseBlocks(text)[blockIndex];
    edits.set(blockIndex, { source: updated.source, type: updated.type });
    onStatus('editing');
    onChange(text);
    render();
  }

  function insertSnippet(snippet) {
    const textarea = container.querySelector('textarea.src');
    if (textarea) {
      const at = textarea.selectionStart ?? textarea.value.length;
      textarea.setRangeText(snippet, at, textarea.selectionEnd ?? at, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const before = text;
    const joiner = before === '' ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const addition = `${joiner}${snippet}\n`;
    text = before + addition;
    history.record({ start: before.length, before: '', after: addition });
    notifyHistory();
    onStatus('editing');
    onChange(text);
    render();
  }

  async function insertPastedImage(file) {
    if (!onPasteImage) return;
    onStatus('saving');
    try {
      const snippet = await onPasteImage(file);
      if (!snippet) throw new Error('the image could not be uploaded');
      insertSnippet(snippet);
    } catch (error) {
      onStatus('error', error.message || 'image upload failed');
    }
  }

  container.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    const image = files.find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    void insertPastedImage(image);
  });

  container.addEventListener('click', (event) => {
    const box = event.target.closest('input[type="checkbox"][data-item]');
    if (box) {
      // The browser has already flipped it; the source decides whether that
      // sticks, and the re-render puts the box back to what the file says.
      toggleTask(box);
      return;
    }

    if (event.target.closest('a')) return; // let links open
    if (event.target.closest('textarea')) return;

    const block = event.target.closest('.block');
    if (block) beginEdit(block);
  });

  function undo() {
    if (editing !== -1) return false;
    const op = history.undo();
    if (!op) return false;
    text = text.slice(0, op.start) + op.before + text.slice(op.start + op.after.length);
    onChange(text);
    render();
    notifyHistory();
    return true;
  }

  function redo() {
    if (editing !== -1) return false;
    const op = history.redo();
    if (!op) return false;
    text = text.slice(0, op.start) + op.after + text.slice(op.start + op.before.length);
    onChange(text);
    render();
    notifyHistory();
    return true;
  }

  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (editing !== -1) return; // the textarea's own undo is the right one there

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      if (undo()) event.preventDefault();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      if (redo()) event.preventDefault();
    }
  });

  return {
    setText,
    render,
    text: () => text,
    edits: () => [...edits.entries()].map(([index, edit]) => ({ index, ...edit })),
    isEditing: () => editing !== -1,
    undo,
    redo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    setUndoLimit(limit) {
      history.setLimit(limit);
      notifyHistory();
    },
  };
}
