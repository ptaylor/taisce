import { parseBlocks, applyBlockEdit, setTaskChecked } from './blocks.js';
import { renderMarkdown } from './markdown.js';

const LIST_PREFIX = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/;

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
 */
export function createEditor({ container, onChange = () => {}, onStatus = () => {} }) {
  let text = '';
  let editing = -1;
  let editBlock = null;
  const edits = new Map();

  function wireCheckboxes(scope, blockIndex) {
    const states = taskStatesOf(blockIndex);
    scope.querySelectorAll('input[type="checkbox"]').forEach((box, i) => {
      if (i >= states.length) {
        box.removeAttribute('data-item');
        return;
      }
      box.disabled = false;
      box.dataset.item = String(i);
      box.dataset.block = String(blockIndex);
      box.setAttribute('aria-label', `Task ${i + 1}`);
    });
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
        el.innerHTML = renderMarkdown(block.source);
        wireCheckboxes(el, index);
        container.appendChild(el);
      });
    }

    if (keepScroll) window.scrollTo(0, scrollY);
  }

  function setText(next) {
    text = next;
    edits.clear();
    render();
  }

  function beginEdit(blockEl) {
    if (editing !== -1) return;

    const index = Number(blockEl.dataset.index);
    const block = parseBlocks(text)[index] || { start: 0, end: 0, source: '', type: 'paragraph' };

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

    textarea.addEventListener('blur', () => {
      if (editing === index) render();
    });

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        textarea.blur();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        const before = textarea.value.slice(0, textarea.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
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

    const before = text.slice(0, block.start).replace(/\n+$/, '');
    const after = text.slice(block.end).replace(/^\n+/, '');
    text = [before, after].filter(Boolean).join('\n\n');
    edits.clear();
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

    text = next;
    const updated = parseBlocks(text)[blockIndex];
    edits.set(blockIndex, { source: updated.source, type: updated.type });
    onStatus('editing');
    onChange(text);
    render();
  }

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

  return {    setText,
    render,
    text: () => text,
    edits: () => [...edits.entries()].map(([index, edit]) => ({ index, ...edit })),
    isEditing: () => editing !== -1,
  };
}
