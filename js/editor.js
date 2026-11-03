import { parseBlocks, applyBlockEdit, setTaskChecked, taskStates } from './blocks.js';
import { createHistory } from './history.js';
import { detectSlash, expandTemplate, matchTemplates } from './templates.js';
import { editLink, findLinks, isUrl, linkMarkdown, removeLink } from './links.js';
import { renderMarkdown } from './markdown.js';
import { trackEvent } from './analytics.js';
import { findImageRefs, removeImageRef } from './images.js';
import { quotePaste } from './paste.js';

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
  onViewImage,
  onDeleteImage,
  undoLimit = 50,
}) {
  let text = '';
  let editing = -1;
  let editBlock = null;
  let popover = null;
  let imageMenu = null;
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

  // A rendered link is matched to its Markdown by position: anchors come out in
  // source order, so the nth anchor is the nth link. When the counts disagree
  // (raw HTML anchors in the note, say) the block keeps plain web links rather
  // than offering an edit that would land in the wrong place.
  function labelLinks(el, source) {
    const anchors = [...el.querySelectorAll('a[href]')].filter(
      (anchor) => !anchor.classList.contains('remote-image'),
    );
    const links = findLinks(source);
    if (anchors.length === 0 || anchors.length !== links.length) return;
    anchors.forEach((anchor, index) => {
      anchor.dataset.link = String(index);
    });
  }

  function render({ keepScroll = true } = {}) {
    const scrollY = window.scrollY;
    const blocks = parseBlocks(text);

    dismissLink(false);
    closeImageMenu();
    container.replaceChildren();
    editing = -1;
    editBlock = null;

    if (blocks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'block empty';
      empty.dataset.index = '0';
      empty.textContent = 'This file is empty. Tap here, then type / for templates.';
      container.appendChild(empty);
    } else {
      blocks.forEach((block, index) => {
        const el = document.createElement('div');
        el.className = `block ${block.type}`;
        el.dataset.index = String(index);
        el.innerHTML = sandboxHtml(renderMarkdown(block.source));
        if (block.type !== 'code') labelLinks(el, block.source);

        // The boxes and the toggles have to agree about which task is which,
        // so both come from the same function in blocks.js.
        const states = taskStates(block);
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

    // An explicit way to finish, for a phone where tapping "somewhere else"
    // is easy to get wrong. Escape does the same thing from a keyboard.
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'done-btn';
    done.setAttribute('aria-label', 'Done editing');
    done.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
      'stroke-linejoin="round" d="M5 12.5 10 17.5 19 7"/></svg>';
    // Commit explicitly rather than relying on blur: a blur that never fires
    // (tab in the background, focus lost) would leave the tick doing nothing.
    done.addEventListener('mousedown', (event) => event.preventDefault());
    done.addEventListener('click', (event) => {
      event.stopPropagation();
      commit();
    });
    blockEl.appendChild(done);

    autosize(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const commit = () => {
      closeMenu();
      if (editing !== index) return;
      if (span.source !== before) {
        history.record({ start: span.start, before, after: span.source });
        notifyHistory();
      }
      render();
    };

    let menu = null;
    let options = [];
    let active = 0;
    let slash = null;

    function closeMenu() {
      if (menu) menu.remove();
      menu = null;
      options = [];
      slash = null;
      active = 0;
    }

    function paintMenu() {
      if (!menu) return;
      menu.replaceChildren();

      options.forEach((template, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = index === active ? 'slash-item active' : 'slash-item';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', index === active ? 'true' : 'false');

        const label = document.createElement('span');
        label.className = 'slash-label';
        label.textContent = template.label;

        const hint = document.createElement('code');
        hint.className = 'slash-hint';
        hint.textContent = template.hint;

        row.append(label, hint);
        // Keep the caret in the textarea so the chosen text appears at the slash.
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => choose(index));
        menu.appendChild(row);
      });
    }

    function positionMenu() {
      if (!menu) return;
      const gap = 6;
      menu.style.top = `${textarea.offsetTop + textarea.offsetHeight + gap}px`;

      // Flip above the block when the keyboard would otherwise cover it.
      const box = menu.getBoundingClientRect();
      if (box.bottom > window.innerHeight - 8 && textarea.offsetTop > box.height + gap) {
        menu.style.top = `${textarea.offsetTop - box.height - gap}px`;
      }
    }

    function updateMenu() {
      const found = detectSlash(textarea.value, textarea.selectionStart);
      if (!found) return closeMenu();

      const matches = matchTemplates(found.query);
      if (!matches.length) return closeMenu();

      slash = found;
      options = matches;

      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'slash-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', 'Insert a template');
        blockEl.appendChild(menu);
      }

      if (active >= options.length) active = 0;
      paintMenu();
      positionMenu();
    }

    function choose(index) {
      const template = options[index];
      if (!template || !slash) return;

      const { text, caret } = expandTemplate(template);
      textarea.setRangeText(text, slash.start, slash.end, 'end');
      textarea.setSelectionRange(slash.start + caret, slash.start + caret);
      closeMenu();
      trackEvent('template-insert');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }

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
      updateMenu();
    });

    textarea.addEventListener('click', updateMenu);
    // Pasting an address over a selection is how a link is usually made: the
    // words are already there and the URL is on the clipboard.
    textarea.addEventListener('paste', (event) => {
      const data = event.clipboardData;
      if (!data || data.files.length > 0) return; // pictures are the app's job
      const pasted = data.getData('text/plain');
      const { selectionStart: from, selectionEnd: to } = textarea;

      // A line break ends a blockquote unless every line carries the marker,
      // so a multi-line paste into one keeps the quote on each line. A code
      // block is exempt: a line of source may well begin with `>`.
      if (block.type !== 'code') {
        const quoted = quotePaste(textarea.value, from, pasted);
        if (quoted) {
          event.preventDefault();
          textarea.setRangeText(quoted, from, to, 'end');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
      }

      if (from === to || !isUrl(pasted)) return;
      event.preventDefault();
      textarea.setRangeText(linkMarkdown(textarea.value.slice(from, to), pasted), from, to, 'end');
      trackEvent('link-paste');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    textarea.addEventListener('keyup', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMenu();
    });

    textarea.addEventListener('blur', commit);

    textarea.addEventListener('keydown', (event) => {
      if (menu) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          active = (active + 1) % options.length;
          paintMenu();
          positionMenu();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          active = (active - 1 + options.length) % options.length;
          paintMenu();
          positionMenu();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          choose(active);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
          return;
        }
      }

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

  function removeBlock(index, { edit = true } = {}) {
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
    if (!edit) return;
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

    trackEvent('task-toggle');
    // One character changed in place: the block's span is unchanged, so there
    // is nothing to re-parse.
    edits.set(blockIndex, { source: text.slice(block.start, block.end), type: block.type });
    onStatus('editing');
    onChange(text);
    render();
  }

  // A rendered link is a thing to change, not a thing to leave the note for.
  // Clicking one opens a small editor anchored to it; the note itself is only
  // rewritten when the editor closes, so nothing re-renders under the caret.
  function dismissLink(apply) {
    if (!popover) return;
    const current = popover;
    popover = null;
    current.element.remove();
    document.removeEventListener('pointerdown', current.onOutside, true);
    window.removeEventListener('scroll', current.onMove, true);
    window.removeEventListener('resize', current.onMove);
    if (apply) applyLink(current);
  }

  function applyLink(current) {
    const block = parseBlocks(text)[current.index];
    // The document can move on underneath an open editor; if it has, the span
    // this editor was built from no longer points at the same characters.
    if (!block || block.source !== current.source) return;

    const href = current.destination();
    const next =
      href === ''
        ? removeLink(current.source, current.link)
        : editLink(current.source, current.link, { text: current.label.value, href });
    if (next === current.source) return;
    trackEvent(href === '' ? 'link-remove' : 'link-change');

    text = applyBlockEdit(text, block, next);
    history.record({ start: block.start, before: current.source, after: next });
    edits.set(current.index, { source: next, type: block.type });
    notifyHistory();
    onStatus('editing');
    onChange(text);
    render();
  }

  // Anchored to a rectangle on screen, flipped above when there is no room
  // below, and kept inside the viewport sideways.
  function placeNear(element, rect) {
    const box = element.getBoundingClientRect();
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + box.height > window.innerHeight - gap) {
      top = Math.max(gap, rect.top - box.height - gap);
    }
    const left = Math.min(
      Math.max(gap, rect.left),
      Math.max(gap, window.innerWidth - box.width - gap),
    );
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
  }

  // A picture is a thing to look at or remove, not a paragraph to edit. Tapping
  // one offers both, and removing it takes the Dropbox file and the markup that
  // points at it.
  function openImageMenu(image) {
    const ref = image.dataset.src;
    const blockEl = image.closest('.block');
    const index = Number(blockEl?.dataset.index);
    const block = parseBlocks(text)[index];
    if (!ref || !block) return false;

    trackEvent('image-open');
    dismissLink(false);
    closeImageMenu();

    const element = document.createElement('div');
    element.className = 'link-pop image-pop';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'Picture');

    const caption = document.createElement('p');
    caption.className = 'image-caption';
    caption.textContent = image.getAttribute('alt') || ref.split('/').pop();

    const actions = document.createElement('div');
    actions.className = 'link-actions';

    const action = (label, handler, className = 'link-action') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.addEventListener('click', handler);
      actions.appendChild(button);
    };

    action('View', () => {
      closeImageMenu();
      onViewImage?.({
        url: image.src,
        alt: image.getAttribute('alt') || '',
        name: ref.split('/').pop(),
      });
    });

    action(
      'Delete',
      async () => {
        closeImageMenu();
        const removed = await onDeleteImage?.(ref);
        if (removed) removePicture(index, ref);
      },
      'link-action danger',
    );

    element.append(caption, actions);
    document.body.appendChild(element);
    placeNear(element, image.getBoundingClientRect());

    const onOutside = (event) => {
      if (!element.contains(event.target)) closeImageMenu();
    };
    // Opening the menu is a pointerdown as well; listen from the next frame.
    requestAnimationFrame(() => document.addEventListener('pointerdown', onOutside, true));
    imageMenu = { element, onOutside };
    return true;
  }

  function closeImageMenu() {
    if (!imageMenu) return;
    const current = imageMenu;
    imageMenu = null;
    current.element.remove();
    document.removeEventListener('pointerdown', current.onOutside, true);
  }

  // The file is already gone from Dropbox by the time this runs; what is left is
  // the pointer to it, which must go too or the note links to nothing.
  function removePicture(index, ref) {
    const block = parseBlocks(text)[index];
    if (!block) return;

    const target = findImageRefs(block.source).find((candidate) => candidate.src === ref);
    if (!target) return;

    const before = block.source;
    const next = removeImageRef(before, target);
    if (next.trim() === '') {
      // The picture was the whole paragraph: drop the paragraph as well, or the
      // note keeps an empty line where a picture used to be. No editing: this
      // was not a request to write anything.
      removeBlock(index, { edit: false });
      return;
    }

    text = applyBlockEdit(text, block, next);
    history.record({ start: block.start, before, after: next });
    edits.set(index, { source: next, type: block.type });
    notifyHistory();
    onStatus('editing');
    onChange(text);
    render();
  }

  function openLink(anchor) {
    if (anchor.dataset.link === undefined) return false;

    const blockEl = anchor.closest('.block');
    const index = Number(blockEl?.dataset.index);
    const block = parseBlocks(text)[index];
    if (!block) return false;

    const link = findLinks(block.source)[Number(anchor.dataset.link)];
    if (!link) return false;

    trackEvent('link-open');
    dismissLink(false);

    const element = document.createElement('div');
    element.className = 'link-pop';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'Link');

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'link-field';
    label.placeholder = 'Text';
    label.setAttribute('aria-label', 'Link text');
    label.value = link.text;

    const href = document.createElement('input');
    href.type = 'url';
    href.className = 'link-field link-field-url';
    href.placeholder = 'https://example.com';
    href.spellcheck = false;
    href.setAttribute('aria-label', 'Link address');
    // An address is shown the way it was written; mailto: is added back on
    // commit rather than put in front of someone typing an email.
    const isAddress = link.form === 'address';
    href.value = isAddress ? link.text : link.href;

    const actions = document.createElement('div');
    actions.className = 'link-actions';

    const action = (text, handler, className = 'link-action') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      button.addEventListener('click', handler);
      actions.appendChild(button);
      return button;
    };

    const destination = () => {
      const value = href.value.trim();
      if (value === '') return '';
      return isAddress && !value.includes('://') && value.includes('@') ? `mailto:${value}` : value;
    };

    action('Open', () => {
      trackEvent('link-go');
      const target = destination() || link.href;
      dismissLink(true);
      window.open(target, '_blank', 'noopener,noreferrer');
    });

    const copy = action('Copy', async () => {
      try {
        await navigator.clipboard.writeText(destination() || link.href);
        trackEvent('link-copy');
        copy.textContent = 'Copied';
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1400);
      } catch {
        href.select(); // no clipboard permission: the address is there to copy by hand
      }
    });

    action(
      'Remove',
      () => {
        href.value = '';
        dismissLink(true);
      },
      'link-action danger',
    );

    element.append(label, href, actions);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissLink(true);
      }
    });

    const openedAt = Date.now();
    const onOutside = (event) => {
      if (!element.contains(event.target)) dismissLink(true);
    };
    // An editor pinned to a rectangle on screen has to close when that
    // rectangle moves. Ignore the moment it opens: focusing a field on a phone
    // can scroll the page before the user has touched anything.
    const onMove = () => {
      if (Date.now() - openedAt > 250) dismissLink(true);
    };

    document.body.appendChild(element);

    placeNear(element, anchor.getBoundingClientRect());

    popover = {
      element,
      index,
      source: block.source,
      link,
      label,
      href,
      destination,
      onOutside,
      onMove,
    };
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);

    // On a phone the tap already said "I mean this link"; typing is the next
    // step only if the pointer is a mouse. The address takes the focus because
    // a link is changed far more often than its words are.
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
      href.focus();
      href.select();
    }

    return true;
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
      trackEvent('image-paste');
      insertSnippet(snippet);
    } catch (error) {
      trackEvent('error-image');
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

    const anchor = event.target.closest('a');
    if (anchor) {
      if (anchor.classList.contains('remote-image')) return; // the image itself opens
      if (openLink(anchor)) {
        event.preventDefault();
        return;
      }
      return; // nothing in the source to edit: let the browser follow it
    }
    const picture = event.target.closest('img');
    if (picture && !picture.closest('a') && openImageMenu(picture)) {
      event.preventDefault();
      return;
    }
    if (event.target.closest('textarea')) return;
    if (event.target.closest('.done-btn')) return; // the blur already committed

    const block = event.target.closest('.block');
    if (block) beginEdit(block);
  });

  function undo() {
    if (editing !== -1) return false;
    const op = history.undo();
    if (!op) return false;
    trackEvent('undo');
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
    trackEvent('redo');
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
