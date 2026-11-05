import { APP_CONFIG } from './js/config.js';
import { DropboxProvider } from './js/dropbox.js';
import { createMockProvider } from './js/mock.js';
import { completeSignIn, isSignedIn, redirectUri, startSignIn } from './js/auth.js';
import { createSaveEngine } from './js/save.js';
import { createBackupWriter } from './js/backup.js';
import { createEditor } from './js/editor.js';
import { AuthError, ConflictError, ScopeError } from './js/errors.js';
import {
  breadcrumbs,
  isHiddenName,
  joinPath,
  normaliseDir,
  parentDir,
  renamedPath,
} from './js/paths.js';
import { folderOf, recentCount, recentFiles, recentsOpen, searchFiles } from './js/recents.js';
import { undoLimit } from './js/history.js';
import {
  assetDirFor,
  attachedImages,
  imageFileName,
  markdownImage,
  resolveImagePath,
} from './js/images.js';
import {
  $,
  ask,
  hideBusy,
  setScreen,
  setStatus,
  setTitle,
  showBusy,
  toast,
} from './js/ui.js';
import {
  canShare,
  forgetPdfShare,
  parseShareRecords,
  pdfNeedsPublish,
  recordPdfShare,
  SHARE_FORMAT_KEY,
  SHARE_RECORDS_KEY,
  shareFormatChoice,
  shareFingerprint,
  sharePayload,
  viewableLink,
} from './js/share.js';
import { isTaiscePdf, markdownToPdf, pdfPathFor } from './js/pdf.js';
import { configure, releaseSlug, trackEvent, trackView } from './js/analytics.js';
import { effectiveTheme, themeChoice, THEME_KEY } from './js/theme.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const provider = MOCK ? createMockProvider() : new DropboxProvider(APP_CONFIG.appKey);
const backupNote = createBackupWriter(provider, {
  warn: (...args) => {
    trackEvent('error-backup');
    console.warn(...args);
  },
});
const RECENT_KEY = 'taisce.recentCount';
const RECENTS_OPEN_KEY = 'taisce.recentsOpen';
const UNDO_KEY = 'taisce.undoLimit';
const imageUrls = new Map();

const state = {
  dir: '',
  entries: [],
  file: null,
  index: null,
  query: '',
  countedQuery: '',
  recentMax: recentCount(localStorage.getItem(RECENT_KEY)),
  recentsOpen: recentsOpen(localStorage.getItem(RECENTS_OPEN_KEY)),
  undoMax: undoLimit(localStorage.getItem(UNDO_KEY)),
  theme: themeChoice(localStorage.getItem(THEME_KEY)),
  shareFormat: shareFormatChoice(localStorage.getItem(SHARE_FORMAT_KEY)),
  sharedPdfs: parseShareRecords(localStorage.getItem(SHARE_RECORDS_KEY)),
};

const darkScheme = matchMedia('(prefers-color-scheme: dark)');

// The boot script painted the stored theme before the stylesheet resolved;
// this keeps the attribute, the browser chrome colour and a live System choice
// in step once the app is running.
function applyTheme() {
  const theme = effectiveTheme(state.theme, darkScheme.matches);
  document.documentElement.dataset.theme = theme;
  const chrome = getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim();
  if (chrome) {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = chrome;
    }
  }
}

darkScheme.addEventListener('change', () => {
  if (state.theme === 'system') applyTheme();
});

applyTheme();

// The app is one document with three screens and no address of its own, so the
// Android back gesture is browser history. Without entries of our own it takes
// the reader out of the app — and, in the session that signed in, it can reach
// the Dropbox authorisation page, which a standalone window cannot leave.
// Every screen change records the screen it is about to show; `popstate`
// replays it, so the system back button and the header's arrow are one path.
// Note paths live only in `history.state`: the address bar must stay clear of
// them, because analytics sends `location.search` with every hit.
const VIEW = 'taisce';
let currentView = { screen: 'list', dir: '' };
let navId = 0;

function depthOf(record) {
  return record && record[VIEW] ? Number(record.depth) || 0 : 0;
}

function recordView(view, { push = false } = {}) {
  currentView = view;
  const record = { [VIEW]: true, ...view, depth: depthOf(history.state) + (push ? 1 : 0) };
  if (push) history.pushState(record, '');
  else history.replaceState(record, '');
}

function updateHistoryButtons({ canUndo, canRedo }) {
  $('#undo').disabled = !canUndo;
  $('#redo').disabled = !canRedo;
}

function storedShareRecords() {
  try {
    return parseShareRecords(localStorage.getItem(SHARE_RECORDS_KEY));
  } catch {
    return {};
  }
}

// Records are shared by every tab on this origin. A tab that has been open for
// a while holds a stale copy, so merge what is stored now before writing;
// otherwise one tab's share wipes another tab's recent shares. `replace` is for
// the two operations that remove records, which a merge would undo.
function saveShareRecords({ replace = false } = {}) {
  try {
    if (!replace) {
      state.sharedPdfs = { ...storedShareRecords(), ...state.sharedPdfs };
    }
    localStorage.setItem(SHARE_RECORDS_KEY, JSON.stringify(state.sharedPdfs));
  } catch {
    // The dot is a convenience; losing it must not fail a share.
  }
}

function setShareButtonStale(stale) {
  const button = $('#share');
  if (!button) return;
  button.classList.toggle('needs-publish', stale);
  button.setAttribute(
    'aria-label',
    stale ? 'Share this file — the PDF needs republishing' : 'Share this file',
  );
  button.title = stale ? 'The shared PDF is out of date — share again to republish it' : '';
}

/**
 * Mark the Share button when the open note has a PDF behind a shared link that
 * is older than the text on screen. The dot is the cue; the label and title say
 * what it means where it cannot be seen.
 */
function updateShareButton(text = editor.text()) {
  const stale =
    state.shareFormat === 'pdf' &&
    Boolean(state.file) &&
    pdfNeedsPublish(state.sharedPdfs, state.file.path, text);
  setShareButtonStale(stale);
}

const editor = createEditor({
  container: $('#blocks'),
  onChange: (text) => {
    engine.setText(text);
    updateShareButton(text);
  },
  onStatus: setStatus,
  onHistory: updateHistoryButtons,
  undoLimit: state.undoMax,
  resolveImage,
  onPasteImage: uploadPastedImage,
  onViewImage: ({ url, alt, name }) => showViewer(url, alt || name),
  onDeleteImage: (src) => deletePicture(src),
});

function showViewer(url, alt) {
  const dialog = $('#viewer');
  $('#viewer-img').src = url;
  $('#viewer-img').alt = alt || '';
  $('#viewer-name').textContent = alt || '';
  $('#viewer-name').hidden = !alt;
  dialog.showModal();
}

// Deleting a picture is a file delete, so it asks the same way a note delete
// does — and the markup pointing at it is removed by the editor afterwards.
async function deletePicture(src) {
  if (!state.file) return false;
  const path = resolveImagePath(state.file.path, src);
  const name = path ? path.split('/').pop() : src.split('/').pop();

  const ok = await ask({
    title: `Delete “${name}”?`,
    body:
      'The picture moves to the Dropbox trash, and the reference to it is ' +
      'removed from this note. Taisce cannot undo this.',
    ok: 'Delete',
    danger: true,
  });
  if (!ok) return false;

  try {
    await provider.remove(path);
  } catch (error) {
    if (error instanceof AuthError) {
      showAuth();
      return false;
    }
    trackEvent('error-image-delete');
    toast(error.message || 'could not delete the picture');
    return false;
  }

  trackEvent('image-delete');
  const cached = imageUrls.get(path);
  if (cached) URL.revokeObjectURL(cached);
  imageUrls.delete(path);
  return true;
}

const engine = createSaveEngine({
  provider,
  onStatus: (kind, detail) => {
    // A save changes the modified time, so the recent list is stale.
    if (kind === 'saved') state.index = null;
    if (kind === 'error') trackEvent('error-save');
    setStatus(kind, detail);
  },
  onRemote: (text, info) => {
    editor.setText(text);
    updateShareButton(text);
    // A conflict is the one save failure the reader is told about, so it is the
    // one worth counting: a rise means two devices are racing.
    trackEvent(info.dropped ? 'conflict-dropped' : 'conflict-merged');
    toast(
      info.dropped
        ? 'Changed elsewhere — reloaded, local edits dropped'
        : 'Merged with changes from another device',
    );
  },
  onAuthLost: () => showAuth(),
  getEdits: () => editor.edits(),
});

// Dropbox is not a web host: an image reference in a note is fetched with the
// user's token and shown from an object URL. The map is a session cache so a
// re-render does not re-download every picture.
async function resolveImage(src) {
  if (!state.file) return null;
  const path = resolveImagePath(state.file.path, src);
  if (!path) return null;
  if (imageUrls.has(path)) return imageUrls.get(path);

  try {
    const blob = await provider.readBlob(path);
    const url = URL.createObjectURL(blob);
    imageUrls.set(path, url);
    return url;
  } catch {
    // Remembered as missing, or every re-render asks Dropbox again for a file
    // that is not there.
    imageUrls.set(path, null);
    return null;
  }
}

// Upload first, link second: a link to an image that failed to upload is worse
// than no link at all.
async function uploadPastedImage(file) {
  if (!state.file) throw new Error('open a note before pasting an image');

  const dir = assetDirFor(state.file.path);
  showBusy('Saving the picture…');
  try {
    try {
      await provider.createFolder(dir);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }

    // Two pastes inside one second would otherwise collide, and an upload is
    // created rather than renamed, so the second would fail.
    const name = imageFileName(file.type, Date.now(), Math.random().toString(36).slice(2, 6));
    const target = joinPath(dir, name);
    await provider.uploadFile(target, file);
    imageUrls.delete(target);
    return markdownImage(name);
  } finally {
    hideBusy();
  }
}

function showAuth() {
  // Losing the token can happen while a read is in flight. The auth screen is
  // now the screen: stop the stale navigation, own the busy overlay (its
  // finally will no longer hide it), and record the screen so Back has a
  // truthful entry to return to.
  ++navId;
  recordView({ screen: 'auth' });
  hideBusy();
  setTitle('Taisce');
  setStatus('ready');
  setScreen('auth');
}

function renderCrumbs() {
  const nav = $('#crumbs');
  nav.replaceChildren();

  // The root is not a crumb: at the top level there is nowhere to go, and the
  // app's own name above the search box was only repeating the header. One
  // folder deep there is nowhere to jump to either, so the trail appears only
  // once it can take you somewhere — the back arrow covers the single step up.
  const trail = breadcrumbs(state.dir).slice(1);
  if (trail.length < 2) return;

  trail.forEach((crumb, index) => {
    const last = index === trail.length - 1;
    const node = document.createElement(last ? 'span' : 'button');
    node.className = last ? 'crumb current' : 'crumb';
    node.textContent = crumb.label;

    if (last) {
      node.setAttribute('aria-current', 'page');
    } else {
      node.type = 'button';
      node.addEventListener('click', () => {
        void loadList(crumb.path, { push: true });
      });
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '/';
      nav.append(node, sep);
      return;
    }
    nav.append(node);
  });
}

function applyRecentsOpen() {
  $('#recents-toggle').setAttribute('aria-expanded', String(state.recentsOpen));
  $('#recents').hidden = !state.recentsOpen;
}

function makeEntry(item, { sub = '', onOpen }) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `entry ${item.type || 'file'}`;

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = item.type === 'folder' ? '\u203a' : '';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = item.name;

  button.append(glyph, label);

  if (sub) {
    const where = document.createElement('span');
    where.className = 'sub';
    where.textContent = sub;
    button.appendChild(where);
  }

  button.addEventListener('click', onOpen);
  li.appendChild(button);
  return li;
}

function openSearchHit(hit) {
  // Where the file was found is the useful part: the recents list and the
  // search results both land here, so the two paths are counted apart.
  if (state.query) {
    countSearch();
    trackEvent('open-from-search');
  } else {
    trackEvent('open-from-recent');
  }
  void openFile({ name: hit.name, path: hit.path, type: 'file' });
}

async function ensureIndex() {
  if (!state.index) state.index = await provider.index();
  return state.index;
}

function renderList() {
  const list = $('#file-list');
  const recentsBlock = $('#recents-block');
  const recents = $('#recents');
  const empty = $('#list-empty');
  const searchEmpty = $('#search-empty');

  list.replaceChildren();
  recents.replaceChildren();

  if (state.query) {
    const hits = searchFiles(state.index || [], state.query);
    const fragment = document.createDocumentFragment();
    for (const hit of hits) {
      fragment.appendChild(
        makeEntry({ name: hit.name, type: 'file' }, { sub: folderOf(hit.path), onOpen: () => openSearchHit(hit) }),
      );
    }
    list.appendChild(fragment);
    recentsBlock.hidden = true;
    empty.hidden = true;
    searchEmpty.hidden = hits.length > 0;
    setStatus('ready', `${hits.length} match${hits.length === 1 ? '' : 'es'}`);
    return;
  }

  searchEmpty.hidden = true;

  const atRoot = !state.dir;
  const recent = atRoot ? recentFiles(state.index || [], state.recentMax) : [];
  if (recent.length) {
    const fragment = document.createDocumentFragment();
    for (const file of recent) {
      fragment.appendChild(
        makeEntry({ name: file.name, type: 'file' }, { sub: folderOf(file.path), onOpen: () => openSearchHit(file) }),
      );
    }
    recents.appendChild(fragment);
  }
  recentsBlock.hidden = recent.length === 0;

  const fragment = document.createDocumentFragment();
  for (const entry of state.entries) {
    fragment.appendChild(
      makeEntry(entry, {
        onOpen: () => {
          if (entry.type === 'folder') void loadList(entry.path, { push: true });
          else void openFile(entry);
        },
      }),
    );
  }
  list.appendChild(fragment);

  applyRecentsOpen();
  empty.hidden = state.entries.length > 0 || recent.length > 0;
  $('#empty-msg').textContent = state.dir
    ? 'This folder is empty.'
    : 'No Markdown files or folders yet.';

  const folders = state.entries.filter((entry) => entry.type === 'folder').length;
  const files = state.entries.length - folders;
  const parts = [];
  if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
  if (files) parts.push(`${files} file${files === 1 ? '' : 's'}`);
  setStatus('ready', `${parts.join(' · ') || 'empty'}${MOCK ? ' · demo' : ''}`);
}

async function loadList(dir = state.dir, { push = false } = {}) {
  const id = ++navId;
  dir = normaliseDir(dir);
  recordView({ screen: 'list', dir }, { push });
  state.dir = dir;
  state.query = '';
  state.countedQuery = '';
  $('#search').value = '';
  setTitle('Taisce');
  setScreen('list', { back: Boolean(state.dir) });
  setStatus('loading');
  showBusy(state.dir ? 'Opening the folder…' : 'Fetching your files…');
  renderCrumbs();
  $('#file-list').replaceChildren();
  $('#recents-block').hidden = true;
  $('#list-empty').hidden = true;
  $('#search-empty').hidden = true;

  try {
    // The recents list and the search index only exist at the root; when they
    // are needed the two requests overlap rather than queue.
    const listing = provider.list(state.dir);
    const indexed = state.dir ? null : ensureIndex();
    const entries = await listing;
    await indexed;

    // A back press can arrive while a folder is loading. The newest navigation
    // owns the screen; a listing that finishes late must not draw over it.
    if (id !== navId) return;
    state.entries = entries;

    // Typing during a load is easy on a phone. Do not lose it: the query wins,
    // and the index is fetched if this folder did not already need one.
    const typed = $('#search').value.trim();
    if (typed) {
      state.query = typed;
      await ensureIndex();
      if (id !== navId) return;
    }

    renderList();
  } catch (error) {
    if (id !== navId) return;
    if (error instanceof AuthError) return showAuth();
    if (/path\/not_found/.test(error.message || '')) {
      toast('That folder no longer exists');
      if (state.dir) return loadList(parentDir(state.dir));
    }
    setStatus('error', error.message || 'could not list files');
  } finally {
    if (id === navId) hideBusy();
  }
}

async function openFile(file, { push = true } = {}) {
  const id = ++navId;
  await engine.flush();
  if (id !== navId) return;
  engine.close();

  const dir = parentDir(file.path);
  recordView({ screen: 'file', path: file.path, name: file.name, dir }, { push });
  state.file = file;
  state.dir = dir;
  state.query = '';
  $('#search').value = '';
  setScreen('file');
  setTitle(file.name);
  setStatus('loading');

  // Clear the note that was open before the screen changes: the editor still
  // holds it, and a previous note appearing under the new note's name is a lie
  // for as long as the read takes.
  editor.setText('');
  setShareButtonStale(false);
  showBusy(`Opening ${file.name}…`);

  try {
    const { text, rev } = await provider.read(file.path);
    if (id !== navId) return;
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    editor.setText(clean);
    engine.open({ path: file.path, text: clean, rev });
    updateShareButton(clean);
    trackEvent('file-open');
    setStatus('loaded');
    // Housekeeping after the note is on screen, never part of the open: the
    // backup is the file as read (BOM and line endings included), not the
    // editor's normalised copy.
    void backupNote(file.path, text);
  } catch (error) {
    if (id !== navId) return;
    if (error instanceof AuthError) return showAuth();
    trackEvent('error-open');
    setStatus('error', error.message || 'could not open the file');
  } finally {
    if (id === navId) hideBusy();
  }
}

async function refresh() {
  if (state.file && !$('#screen-file').hidden) {
    const id = ++navId;
    await engine.flush();
    if (id !== navId) return;
    setStatus('loading');
    try {
      const { text, rev } = await provider.read(state.file.path);
      if (id !== navId) return;
      const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      if (clean !== editor.text()) {
        editor.setText(clean);
        toast('Reloaded from Dropbox');
      }
      engine.open({ path: state.file.path, text: clean, rev });
      updateShareButton(clean);
      setStatus('loaded');
    } catch (error) {
      if (id !== navId) return;
      setStatus('error', error.message || 'reload failed');
    }
    return;
  }
  await loadList();
}

async function goBack() {
  // With the screens in history, the header arrow asks for the same traversal
  // as the system back button; `popstate` restores the screen. The code below
  // is the fallback for a screen with no entry under it.
  if (depthOf(history.state) > 0) {
    history.back();
    return;
  }
  if (!$('#screen-file').hidden) {
    await engine.flush();
    engine.close();
    state.file = null;
    await loadList(state.dir);
    return;
  }
  if (state.dir) await loadList(parentDir(state.dir));
}

async function restoreView(view) {
  if (view.screen === 'auth') {
    showAuth();
    return;
  }
  if (view.screen === 'file' && !view.deleted) {
    await openFile({ name: view.name, path: view.path, type: 'file' }, { push: false });
    return;
  }

  // Coming back from a note still has to save and close it before the listing
  // takes over the editor. A deleted note's Forward entry lands here too.
  if (state.file) {
    await engine.flush();
    engine.close();
    state.file = null;
  }
  await loadList(view.dir, { push: false });
}

function showNewFile() {
  $('#new-name').value = '';
  $('#new-error').hidden = true;
  $('#new-file').querySelector('input[name="kind"][value="file"]').checked = true;
  $('#new-where').textContent = state.dir ? `in ${state.dir}` : 'in the top level';
  $('#new-file').showModal();
  setTimeout(() => $('#new-name').focus(), 60);
}

async function submitNewFile(event) {
  event.preventDefault();
  const input = $('#new-name');
  const error = $('#new-error');
  error.hidden = true;

  const kind = $('#new-form').querySelector('input[name="kind"]:checked')?.value || 'file';
  const name = input.value.trim();

  if (!name) {
    error.textContent = 'Give it a name.';
    error.hidden = false;
    return;
  }
  if (/[/\\]/.test(name)) {
    error.textContent = 'Names cannot contain / or \\ — open a folder to nest inside it.';
    error.hidden = false;
    return;
  }
  // A leading underscore means "keep this out of the list", so the app cannot be
  // the thing that makes one: it would create something it then refuses to show.
  if (isHiddenName(name)) {
    error.textContent = 'Names cannot start with _ — those are hidden from the list.';
    error.hidden = false;
    return;
  }

  $('#new-create').disabled = true;
  try {
    if (kind === 'folder') {
      trackEvent('folder-new');
      await provider.createFolder(joinPath(state.dir, name));
      state.index = null;
      $('#new-file').close();
      toast(`Created the folder “${name}”`);
      await loadList(state.dir);
      return;
    }

    const path = joinPath(state.dir, /\.md$/i.test(name) ? name : `${name}.md`);
    trackEvent('file-new');
    await provider.create(path, '');
    state.index = null;
    $('#new-file').close();
    await loadList(state.dir);
    const created = state.entries.find((entry) => entry.path === path.toLowerCase()) || {
      name: name.replace(/\.md$/i, ''),
      path,
      type: 'file',
    };
    await openFile(created);
  } catch (caught) {
    if (caught.message === 'conflict') {
      error.textContent = 'That name is already taken.';
    } else if (/path\/not_found/.test(caught.message || '')) {
      error.textContent = 'That folder no longer exists.';
    } else {
      error.textContent = caught.message;
    }
    error.hidden = false;
  } finally {
    $('#new-create').disabled = false;
  }
}

function showRename() {
  const file = state.file;
  if (!file || deleting) return;
  $('#rename-title').textContent = `Rename “${file.name}”`;
  $('#rename-where').textContent = state.dir ? `In ${state.dir}` : 'In the top level';
  $('#rename-name').value = file.name;
  $('#rename-error').hidden = true;
  $('#rename-status').hidden = true;
  $('#rename-save').disabled = false;
  $('#rename-file').showModal();
  setTimeout(() => {
    const input = $('#rename-name');
    input.focus();
    input.select();
  }, 60);
}

// Dropbox keeps a shared link attached to the file, so renaming neither breaks
// nor revokes it. Ask Dropbox as well as this browser's records, because a
// share made on another device is not in localStorage here.
async function noteIsShared(file) {
  if (
    state.sharedPdfs[file.path] ||
    sharedLinks.has(file.path) ||
    sharedLinks.has(pdfPathFor(file.path))
  ) {
    return true;
  }
  if (typeof provider.hasSharedLink !== 'function') return false;
  const answers = await Promise.allSettled([
    provider.hasSharedLink(file.path),
    provider.hasSharedLink(pdfPathFor(file.path)),
  ]);
  return answers.some((answer) => answer.status === 'fulfilled' && answer.value);
}

// The PDF is named after the note, so it follows a rename. A PDF the reader
// exported under that name is not ours and is left where it is, as with delete.
async function moveSharePdf(notePath, nextPath) {
  const from = pdfPathFor(notePath);
  const to = pdfPathFor(nextPath);
  try {
    const existing = await provider.metadata(from);
    if (existing.type !== 'file') return 'none';
    const blob = await provider.readBlob(from);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isTaiscePdf(bytes)) return 'none';
    await provider.rename(from, to);
    return 'moved';
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return /not[_-]?found/i.test(error.message || '') ? 'none' : 'failed';
  }
}

// The published record and the session's cached links are keyed by path. A
// record only follows the PDF when the PDF actually moved; otherwise the new
// name has no published copy and must not look as though it does.
function moveShareState(oldPath, nextPath, pdfMoved) {
  const oldPdf = pdfPathFor(oldPath);
  const nextPdf = pdfPathFor(nextPath);
  const noteLink = sharedLinks.get(oldPath);
  const pdfLink = sharedLinks.get(oldPdf);
  sharedLinks.delete(oldPath);
  sharedLinks.delete(oldPdf);
  if (noteLink) sharedLinks.set(nextPath, noteLink);
  if (pdfMoved && pdfLink) sharedLinks.set(nextPdf, pdfLink);

  const stored = { ...storedShareRecords(), ...state.sharedPdfs };
  const record = stored[oldPath];
  if (!record) return;
  let next = forgetPdfShare(stored, oldPath);
  if (pdfMoved) next = recordPdfShare(next, nextPath, record.hash, record.at);
  state.sharedPdfs = next;
  saveShareRecords({ replace: true });
}

async function submitRename(event) {
  event.preventDefault();
  const file = state.file;
  if (!file || deleting) return;

  // A rename is several awaits long. Back closes the sheet first and only then
  // moves the screen, so check both: the sheet must still be open to *start*
  // the move, and the screen must still own the editor to paint its result.
  const id = navId;
  const stillOpen = () => id === navId && $('#rename-file').open;

  const input = $('#rename-name');
  const error = $('#rename-error');
  const status = $('#rename-status');
  const button = $('#rename-save');
  error.hidden = true;
  status.hidden = true;

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const name = input.value.trim();
  if (!name) return fail('Give it a name.');
  if (/[/\\]/.test(name)) {
    return fail('Names cannot contain / or \\ — a rename keeps the note in this folder.');
  }
  // The same rule as a new file: the app must not make a name it then hides.
  if (isHiddenName(name)) {
    return fail('Names cannot start with _ — those are hidden from the list.');
  }

  const nextPath = renamedPath(file.path, name);
  const displayName = name.replace(/\.md$/i, '');
  if (nextPath.toLowerCase() === file.path.toLowerCase()) {
    return fail('That is already its name.');
  }

  button.disabled = true;
  try {
    status.textContent = 'Checking the share…';
    status.hidden = false;
    if (await noteIsShared(file)) {
      if (!stillOpen()) return;
      const ok = await ask({
        title: `Rename “${file.name}”?`,
        body:
          `This note, or the PDF copy beside it, has a shared link. Renaming ` +
          `does not revoke that link: it will keep working and open the file ` +
          `under its new name, so anyone who has it can still read it. Revoke ` +
          `the link in Dropbox to stop sharing. A PDF copy Taisce made moves ` +
          `with the note.`,
        ok: 'Rename',
      });
      if (!ok) return;
    }

    status.textContent = 'Renaming…';
    status.hidden = false;
    // The name is a property of the file in Dropbox; pending text has to land
    // before it moves, or a failed save would be stranded on the old path.
    await engine.flush();
    if (!stillOpen()) return;
    if (engine.isDirty()) {
      return fail('Could not save the latest changes, so it was not renamed.');
    }
    if (engine.path() !== file.path) {
      return fail('This note is no longer open, so it was not renamed.');
    }

    // A share that is still uploading must finish before its PDF is moved, or
    // it could recreate the old path after the note has taken the new one.
    // Bumping the run stops it writing a record for the old name.
    shareRun += 1;
    await sharePending;
    if (!stillOpen()) return;

    let moved;
    try {
      moved = await provider.rename(file.path, nextPath);
    } catch (caught) {
      if (caught instanceof AuthError) {
        $('#rename-file').close();
        showAuth();
        return;
      }
      if (caught instanceof ConflictError) return fail('That name is already taken.');
      if (/not[_-]?found/i.test(caught.message || '')) {
        return fail('That note no longer exists.');
      }
      return fail(caught.message || 'could not rename the file');
    }

    // The move is done; a Back press from here cannot undo it, but it may have
    // taken the editor somewhere else. Only repaint when this screen still owns
    // it — otherwise reopening the engine would put a note back on a list.
    // Use the path Dropbox reports: it is `path_lower`, which is the form every
    // listing and every share record is keyed by, not the case just typed.
    const oldPath = file.path;
    const finalPath = moved.path || nextPath;
    const here = id === navId;
    const text = here ? engine.text() : '';
    if (here) {
      engine.close();
      engine.open({ path: finalPath, text, rev: moved.rev });
      state.file = { name: displayName, path: finalPath, type: 'file' };
      recordView(
        { screen: 'file', path: finalPath, name: displayName, dir: state.dir },
        { push: false },
      );
      setTitle(displayName);
    }
    state.index = null; // recents and search are keyed by path

    let pdf = 'none';
    try {
      pdf = await moveSharePdf(oldPath, finalPath);
    } catch (caught) {
      if (caught instanceof AuthError) {
        $('#rename-file').close();
        showAuth();
        return;
      }
      pdf = 'failed';
    }
    moveShareState(oldPath, finalPath, pdf === 'moved');
    if (here) updateShareButton(text);
    trackEvent('file-rename');
    $('#rename-file').close();
    toast(
      pdf === 'failed'
        ? `Renamed to “${displayName}” — its PDF copy could not be moved; share it again`
        : `Renamed to “${displayName}”`,
    );
    // Back to the listing while the move was out: its rows still carry the old
    // name. A different note may have been opened instead, which is its own.
    if (!here && !$('#screen-list').hidden) await loadList(state.dir, { push: false });
  } finally {
    button.disabled = false;
    status.hidden = true;
    status.textContent = '';
  }
}

// Created once per file per session: Dropbox keeps a link per file, so asking
// again would only cost a round trip.
const sharedLinks = new Map();

// The link never appears in the sheet — it is copied or handed to the share
// sheet — so it lives here between the request finishing and the buttons being
// pressed.
let shareUrl = '';

// Only the newest share may touch the sheet: closing it and starting another
// before the first finishes must not let the old one write its link over the
// new one. `sharePending` lets a delete wait for a share it has cancelled.
let shareRun = 0;
let sharePending = Promise.resolve();
let deleting = false;

// The sheet's status line doubles as the progress sign: null hides it, a label
// shows the spinner beside the label. "Please wait" is never the only message,
// because it says nothing about what is being waited for.
function setShareBusy(label) {
  const busy = $('#share-busy');
  $('#share-busy-label').textContent = label || '';
  busy.hidden = !label;
}

// rAF alone runs before the paint it was scheduled for; the second frame is
// what guarantees the spinner was actually drawn before the synchronous PDF
// layout takes the main thread. A hidden document pauses rAF altogether, so a
// timer settles the wait rather than leaving the share stuck until it is shown.
function nextPaint() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 120);
  });
}

// The clipboard API needs permission; a hidden textarea and execCommand are the
// fallback, so a refused clipboard does not leave a link the reader cannot get.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older path.
  }
  const area = document.createElement('textarea');
  area.className = 'copy-fallback';
  area.value = text;
  area.setAttribute('readonly', '');
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function resetShare() {
  setShareBusy(null);
  shareUrl = '';
  $('#share-title').textContent = 'Share';
  $('#share-note').textContent = '';
  $('#share-copy').disabled = true;
  $('#share-copy').hidden = true;
  $('#share-copy').textContent = 'Copy link';
  $('#share-send').hidden = true;
  $('#share-reconnect').hidden = true;
}

function openShare() {
  const file = state.file;
  if (!file || deleting) return Promise.resolve();
  const run = ++shareRun;
  const task = shareNote(file, run);
  sharePending = task.catch(() => {});
  return task;
}

async function shareNote(file, run) {
  const format = state.shareFormat;
  const republishing =
    format === 'pdf' && pdfNeedsPublish(state.sharedPdfs, file.path, editor.text());
  // A PDF recorded on this device, or any link already fetched this session,
  // means the same link will come back — so the sheet says so rather than
  // implying a brand-new share.
  const resharing =
    format === 'pdf'
      ? Boolean(state.sharedPdfs[file.path]) || sharedLinks.has(pdfPathFor(file.path))
      : sharedLinks.has(file.path);

  resetShare();
  $('#share-where').textContent = file.name || 'This file';
  if (resharing) {
    $('#share-title').textContent = 'Re-share';
    $('#share-note').textContent = republishing
      ? 'This note has changed since the PDF was last shared. Sharing again ' +
        'replaces the PDF behind the same link.'
      : format === 'pdf'
        ? 'This note has already been shared. Sharing again replaces the PDF ' +
          'behind the same link.'
        : 'This file has already been shared. Sharing again keeps the same link.';
  }
  setShareBusy(
    format === 'markdown'
      ? 'Asking Dropbox for the link…'
      : republishing
        ? 'Republishing the PDF…'
        : resharing
          ? 'Refreshing the PDF…'
          : 'Saving the note…',
  );
  const dialog = $('#share-sheet');
  if (!dialog.open) dialog.showModal();

  try {
    // The shared copy is made from the note as Dropbox holds it, so anything
    // typed but not yet uploaded has to go first — otherwise the recipient
    // reads a note that is already out of date.
    await engine.flush();
    if (run !== shareRun) return;

    // A failed open leaves the note's name on screen but no text in the engine.
    // Sharing then would publish an empty PDF over a good one.
    if (engine.path() !== file.path) {
      setShareBusy(null);
      $('#share-note').textContent =
        'This note could not be opened, so there is nothing to share.';
      return;
    }

    let sharePath = file.path;
    const text = engine.text();

    if (format === 'pdf') {
      // Share a PDF rather than the Markdown source: Dropbox previews a PDF in
      // the browser, while a shared .md opens as raw text. The PDF sits beside
      // the note and is overwritten each time, so Dropbox keeps the same shared
      // link pointing at it.
      setShareBusy(
        republishing
          ? 'Republishing the PDF…'
          : resharing
            ? 'Refreshing the PDF…'
            : 'Making the PDF…',
      );
      await nextPaint();
      if (run !== shareRun) return;
      sharePath = pdfPathFor(file.path);
      const bytes = markdownToPdf(text, { title: file.name || 'Untitled' });
      setShareBusy('Uploading the PDF…');
      await nextPaint();
      if (run !== shareRun) return;
      await provider.writePdf(sharePath, bytes);
    }

    setShareBusy('Asking Dropbox for the link…');
    const known = sharedLinks.get(sharePath);
    const url = known || viewableLink(await provider.shareLink(sharePath));
    if (run !== shareRun) return;
    sharedLinks.set(sharePath, url);

    if (format === 'pdf') {
      // Only now is the PDF actually behind a link. Record the text that was
      // published, so the Share button can say when it has fallen behind.
      state.sharedPdfs = recordPdfShare(state.sharedPdfs, file.path, shareFingerprint(text));
      saveShareRecords();
      // The reader may have moved to another note while the upload ran; that
      // note's button is the one on screen now, so recompute from its text.
      if (state.file?.path === file.path) updateShareButton();
    }

    setShareBusy(null);
    shareUrl = url;
    $('#share-note').textContent =
      format === 'markdown'
        ? resharing
          ? 'Shared again. The link is unchanged, and the note behind it is ' +
            'always current.'
          : 'Anyone with this link can read this file until you stop sharing it in Dropbox.'
        : republishing
          ? 'Re-shared. The updated PDF is behind the same link, so anyone who ' +
            'already has it sees the new version.'
          : resharing
            ? 'Re-shared. The PDF behind the same link has been refreshed.'
            : 'Anyone with this link can read a PDF copy of this note. Sharing again ' +
              'updates the PDF behind the same link.';
    $('#share-copy').disabled = false;
    $('#share-copy').hidden = false;
    $('#share-send').hidden = !canShare();
  } catch (error) {
    if (run !== shareRun) return;
    setShareBusy(null);
    if (error instanceof AuthError) {
      dialog.close();
      return showAuth();
    }
    if (error instanceof ScopeError) {
      trackEvent('share-scope');
      // The grant predates the sharing permission: authorising again is the fix.
      $('#share-note').textContent =
        'This device was connected before Taisce could share files. Reconnect to allow it.';
      $('#share-reconnect').hidden = false;
      return;
    }
    trackEvent('error-share');
    $('#share-note').textContent = error.message || 'could not create a link';
  }
}

// Deleting is the one action in the app that loses something, so it is
// explicit, it names the file, it says where the file goes, and the accept
// button is the destructive one rather than the primary one.
async function deleteFile() {
  const file = state.file;
  if (!file) return;

  // The pictures this note links to go with it. The count is worth naming in the
  // question — "and its 3 pictures" is information, "its files" is not.
  const pictures = attachedImages(file.path, editor.text());
  const extra =
    pictures.length === 0
      ? 'Pictures in the assets folder beside it are left alone.'
      : `The ${pictures.length} picture${pictures.length === 1 ? '' : 's'} it links to go with it.`;

  const ok = await ask({
    title: `Delete “${file.name}”?`,
    body:
      `It moves to the Dropbox trash, where you can restore it at dropbox.com ` +
      `until the trash expires. ${extra} Any PDF copy Taisce made for sharing ` +
      `goes too. Taisce cannot undo this.`,
    ok: 'Delete',
    danger: true,
  });
  if (!ok) return;

  deleting = true;
  try {
    // Upload anything pending first, so a refused delete leaves the note saved
    // and a queued save cannot land on a path that no longer exists.
    await engine.flush();
    engine.close();

    // A share already running must finish before its PDF is deleted, or its
    // upload can land afterwards and leave the orphan this cleanup exists to
    // prevent. Bumping the run stops it touching the sheet or writing records.
    shareRun += 1;
    await sharePending;

    setStatus('deleting');

    try {
      await provider.remove(file.path);
    } catch (error) {
      if (error instanceof AuthError) return showAuth();
      trackEvent('error-delete');
      toast(error.message || 'could not delete the file');
      await openFile(file, { push: false }); // the note is still there: put it back on screen
      return;
    }

    trackEvent('file-delete');
    const failedPictures = await deletePictures(pictures);
    const pdfRemoved = await deleteSharePdf(file.path);

    sharedLinks.delete(file.path);
    sharedLinks.delete(pdfPathFor(file.path));
    state.sharedPdfs = forgetPdfShare(
      { ...storedShareRecords(), ...state.sharedPdfs },
      file.path,
    );
    saveShareRecords({ replace: true });
    setShareButtonStale(false);
    state.index = null; // the recent list and search both lose a row
    const dir = state.dir;
    state.file = null;
    editor.setText('');
    if (depthOf(history.state) > 0) {
      // The listing is the entry underneath the note. Popping to it is what the
      // reader expects, and it does not leave a duplicate step behind. Mark the
      // note's entry first so a Forward cannot reopen a file that is gone.
      history.replaceState({ ...history.state, deleted: true }, '');
      history.back();
    } else {
      await loadList(dir);
    }
    const leftovers = [];
    if (failedPictures) {
      leftovers.push(`${failedPictures} picture${failedPictures === 1 ? '' : 's'}`);
    }
    if (!pdfRemoved) leftovers.push('the shared PDF');
    toast(
      leftovers.length
        ? `Deleted “${file.name}” — ${leftovers.join(' and ')} could not be deleted`
        : `Deleted “${file.name}”`,
    );
  } finally {
    deleting = false;
  }
}

// The PDF exists only for sharing the note; without the note it is an orphan
// with a public link pointing into it. No PDF at that path is the ordinary
// case, not a failure — a note that was never shared has none. Look before
// deleting, as the backup writer does: `files/delete_v2` on a folder takes
// everything inside it, and a folder named `note.pdf` is not our PDF. Read the
// Producer entry too, so a PDF the reader exported under that name is left
// alone.
async function deleteSharePdf(notePath) {
  const pdfPath = pdfPathFor(notePath);
  try {
    const existing = await provider.metadata(pdfPath);
    if (existing.type !== 'file') return true;
    const blob = await provider.readBlob(pdfPath);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isTaiscePdf(bytes)) return true;
    await provider.remove(pdfPath);
    return true;
  } catch (error) {
    return /not[_-]?found/i.test(error.message || '');
  }
}

// The note is already gone, so a picture that will not delete is reported rather
// than retried: an orphaned picture is the lesser fault, and the toast says so.
async function deletePictures(paths) {
  let failed = 0;
  for (const path of paths) {
    try {
      await provider.remove(path);
      const url = imageUrls.get(path);
      if (url) URL.revokeObjectURL(url);
      imageUrls.delete(path);
    } catch {
      failed += 1;
    }
  }
  if (failed) trackEvent('error-delete');
  return failed;
}

async function disconnect() {
  const ok = await ask({ title: `${provider.disconnectLabel}?`, body: provider.disconnectBody, ok: provider.disconnectLabel });
  if (!ok) return;
  if ($('#settings').open) $('#settings').close();

  await engine.flush();
  engine.close();
  try {
    await provider.disconnect();
  } catch {
    // Local sign-out is what matters.
  }
  state.entries = [];
  state.file = null;
  state.dir = '';
  sharedLinks.clear();
  state.sharedPdfs = {};
  saveShareRecords({ replace: true });
  for (const url of imageUrls.values()) if (url) URL.revokeObjectURL(url);
  imageUrls.clear();

  if (MOCK) {
    // Re-seed the demo rather than offering a real sign-in.
    location.replace(`${location.pathname}?mock=1`);
    return;
  }
  showAuth();
}

function showHelp() {
  const dialog = $('#help');
  dialog.showModal();
  // The first focusable thing in here is a link at the bottom, and focusing it
  // scrolls the sheet past the name and the version it is meant to open with.
  dialog.focus();
  dialog.scrollTop = 0;
}

let searchTimer = 0;

async function runSearch(value) {
  const id = navId;
  state.query = String(value || '').trim();
  if (!state.query) {
    renderList();
    return;
  }
  setStatus('loading');
  try {
    await ensureIndex();
    // The reader can back out of the folder while the index is loading; the
    // search must not paint over the screen that replaced it.
    if (id !== navId) return;
    renderList();
  } catch (error) {
    if (id !== navId) return;
    if (error instanceof AuthError) return showAuth();
    trackEvent('error-search');
    setStatus('error', error.message || 'search failed');
  }
}

// One search is one query the reader finished, not one pause in typing: the
// debounced filter runs on every keystroke and counting that would measure the
// pause, not the search. A committed query is counted once, however it was
// finished — Enter, or opening one of the hits.
function countSearch() {
  if (!state.query || state.countedQuery === state.query) return;
  state.countedQuery = state.query;
  trackEvent('search');
  if (!$('#search-empty').hidden) trackEvent('search-empty');
}

function openSettings() {
  $('#recent-count').value = String(state.recentMax);
  $('#undo-limit').value = String(state.undoMax);
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.checked = input.value === state.theme;
  }
  for (const input of document.querySelectorAll('input[name="share-format"]')) {
    input.checked = input.value === state.shareFormat;
  }
  $('#settings').showModal();
  setTimeout(() => $('#recent-count').focus(), 60);
}

function saveSettings(event) {
  event.preventDefault();
  state.recentMax = recentCount($('#recent-count').value);
  state.undoMax = undoLimit($('#undo-limit').value);
  const nextTheme = themeChoice(document.querySelector('input[name="theme"]:checked')?.value);
  if (nextTheme !== state.theme) trackEvent(`theme-${nextTheme}`);
  state.theme = nextTheme;
  const nextFormat = shareFormatChoice(
    document.querySelector('input[name="share-format"]:checked')?.value,
  );
  if (nextFormat !== state.shareFormat) trackEvent(`share-format-${nextFormat}`);
  state.shareFormat = nextFormat;
  localStorage.setItem(RECENT_KEY, String(state.recentMax));
  localStorage.setItem(UNDO_KEY, String(state.undoMax));
  localStorage.setItem(THEME_KEY, state.theme);
  localStorage.setItem(SHARE_FORMAT_KEY, state.shareFormat);
  editor.setUndoLimit(state.undoMax);
  applyTheme();
  updateShareButton();
  trackEvent('settings-save');
  $('#settings').close();
  if (!$('#screen-list').hidden) renderList();
}

async function boot() {
  // The demo is how anyone tries the app without an account, and it is thrown
  // away by the same people who write the code: keep it out of the numbers.
  configure({ demo: MOCK });
  if (!MOCK) {
    trackView('/');
    const slug = releaseSlug();
    if (slug) trackView(`/${slug}`);
  }

  $('#redirect-uri').textContent = redirectUri();
  $('#disconnect').textContent = provider.disconnectLabel;
  $('#account-title').textContent = MOCK ? 'Demo data' : 'Dropbox';
  $('#account-note').textContent = provider.disconnectBody;

  // Presentation only. A cached shell from an older build can be missing an
  // element a newer app.js expects, and losing the version is not worth
  // stopping boot for.
  const version = document.querySelector('meta[name="app-version"]')?.content;
  if (version) {
    for (const id of ['help-version', 'settings-version']) {
      const el = document.getElementById(id);
      if (el) el.textContent = version;
    }
  }

  $('#connect').addEventListener('click', () => {
    trackEvent('connect-start');
    void startSignIn(APP_CONFIG.appKey);
  });
  $('#recents-toggle').addEventListener('click', () => {
    state.recentsOpen = !state.recentsOpen;
    localStorage.setItem(RECENTS_OPEN_KEY, state.recentsOpen ? '1' : '0');
    applyRecentsOpen();
    trackEvent('recent-toggle');
  });
  $('#new').addEventListener('click', () => {
    trackEvent('new-open');
    showNewFile();
  });
  $('#new-cancel').addEventListener('click', () => $('#new-file').close());
  $('#new-form').addEventListener('submit', (event) => {
    void submitNewFile(event);
  });
  $('#empty-new').addEventListener('click', showNewFile);
  $('#back').addEventListener('click', () => {
    void goBack();
  });
  $('#refresh').addEventListener('click', () => {
    void refresh();
  });
  $('#disconnect').addEventListener('click', () => {
    void disconnect();
  });
  $('#share').addEventListener('click', () => {
    trackEvent('share-open');
    void openShare();
  });
  $('#delete').addEventListener('click', () => {
    void deleteFile();
  });
  $('#rename').addEventListener('click', showRename);
  $('#rename-cancel').addEventListener('click', () => $('#rename-file').close());
  $('#rename-form').addEventListener('submit', (event) => {
    void submitRename(event);
  });
  $('#viewer-x').addEventListener('click', () => $('#viewer').close());
  $('#share-close').addEventListener('click', () => $('#share-sheet').close());
  $('#share-copy').addEventListener('click', async () => {
    if (!shareUrl) return;
    if (await copyText(shareUrl)) {
      trackEvent('share-copy');
      $('#share-copy').textContent = 'Copied';
      setTimeout(() => {
        $('#share-copy').textContent = 'Copy link';
      }, 1600);
    } else {
      // The link is deliberately not on screen, so the share sheet is the only
      // other way out of a blocked clipboard.
      $('#share-note').textContent = canShare()
        ? 'Could not copy the link. Use Share… to send it instead.'
        : 'Could not copy the link. This browser blocked clipboard access.';
    }
  });
  $('#share-send').addEventListener('click', async () => {
    if (!shareUrl) return;
    const url = shareUrl;
    try {
      await navigator.share(sharePayload($('#share-where').textContent, url));
      trackEvent('share-send');
    } catch {
      // Dismissed, or the platform refused it; the link is still on screen.
    }
  });
  $('#share-reconnect').addEventListener('click', () => {
    $('#share-sheet').close();
    void startSignIn(APP_CONFIG.appKey);
  });
  $('#help-button').addEventListener('click', () => {
    trackEvent('help-open');
    showHelp();
  });
  $('#help-close').addEventListener('click', () => $('#help').close());
  $('#help-x').addEventListener('click', () => $('#help').close());
  $('#undo').addEventListener('click', () => editor.undo());
  $('#redo').addEventListener('click', () => editor.redo());
  $('#settings-button').addEventListener('click', () => {
    trackEvent('settings-open');
    openSettings();
  });
  // Closing without submitting is the whole point of the corner control: the
  // fields are re-read from state every time the sheet opens, so nothing typed
  // survives a close.
  $('#settings-close').addEventListener('click', () => $('#settings').close());
  $('#settings-x').addEventListener('click', () => $('#settings').close());
  $('#settings-form').addEventListener('submit', saveSettings);

  $('#search').addEventListener('input', (event) => {
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void runSearch(value);
    }, 150);
  });

  $('#search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.target.value = '';
      state.countedQuery = '';
      void runSearch('');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSearch(event.target.value).then(countSearch);
    }
  });

  // Back closes an open sheet before it changes the screen. The traversal has
  // already popped the entry belonging to the screen underneath, so that entry
  // is pushed back; otherwise closing a sheet with Back would also navigate the
  // app. The stack matters because a confirmation can open on top of Settings
  // or the image viewer.
  const dialogStack = [];
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('toggle', (event) => {
      const index = dialogStack.indexOf(dialog);
      if (event.newState === 'open' && index === -1) dialogStack.push(dialog);
      else if (event.newState === 'closed' && index !== -1) dialogStack.splice(index, 1);
    });
  }

  window.addEventListener('popstate', (event) => {
    const dialog = dialogStack[dialogStack.length - 1];
    if (dialog) {
      dialog.close();
      const depth = depthOf(event.state) + 1;
      history.pushState({ [VIEW]: true, ...currentView, depth }, '');
      return;
    }

    const view = event.state;
    if (!view || !view[VIEW]) return; // the traversal has left the app
    void restoreView(view);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void engine.flush();
  });
  window.addEventListener('pagehide', () => {
    void engine.flush();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Installing the app is the one thing a reader does that outlives the visit.
  window.addEventListener('appinstalled', () => trackEvent('installed'));

  if (MOCK) {
    document.body.dataset.mock = '1';
    await loadList('');
    return;
  }

  if (!APP_CONFIG.appKey) {
    $('#connect').hidden = true;
    $('#setup-note').hidden = false;
    showAuth();
    return;
  }

  try {
    const signedIn = (await completeSignIn(APP_CONFIG.appKey)) || isSignedIn();
    if (signedIn) await loadList('');
    else showAuth();
  } catch (error) {
    toast(error.message || 'Sign-in failed');
    showAuth();
  }
}

void boot();
