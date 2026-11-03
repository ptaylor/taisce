import { APP_CONFIG } from './js/config.js';
import { DropboxProvider } from './js/dropbox.js';
import { createMockProvider } from './js/mock.js';
import { completeSignIn, isSignedIn, redirectUri, startSignIn } from './js/auth.js';
import { createSaveEngine } from './js/save.js';
import { createEditor } from './js/editor.js';
import { AuthError, ConflictError, ScopeError } from './js/errors.js';
import { breadcrumbs, isHiddenName, joinPath, normaliseDir, parentDir } from './js/paths.js';
import { folderOf, recentCount, recentFiles, searchFiles } from './js/recents.js';
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
import { canShare, sharePayload, viewableLink } from './js/share.js';
import { configure, releaseSlug, trackEvent, trackView } from './js/analytics.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const provider = MOCK ? createMockProvider() : new DropboxProvider(APP_CONFIG.appKey);
const RECENT_KEY = 'taisce.recentCount';
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
  recentsOpen: true,
  undoMax: undoLimit(localStorage.getItem(UNDO_KEY)),
};

function updateHistoryButtons({ canUndo, canRedo }) {
  $('#undo').disabled = !canUndo;
  $('#redo').disabled = !canRedo;
}

const editor = createEditor({
  container: $('#blocks'),
  onChange: (text) => engine.setText(text),
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
        void loadList(crumb.path);
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
          if (entry.type === 'folder') void loadList(entry.path);
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

async function loadList(dir = state.dir) {
  state.dir = normaliseDir(dir);
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
    state.entries = await listing;
    await indexed;

    // Typing during a load is easy on a phone. Do not lose it: the query wins,
    // and the index is fetched if this folder did not already need one.
    const typed = $('#search').value.trim();
    if (typed) {
      state.query = typed;
      await ensureIndex();
    }

    renderList();
  } catch (error) {
    if (error instanceof AuthError) return showAuth();
    if (/path\/not_found/.test(error.message || '')) {
      toast('That folder no longer exists');
      if (state.dir) return loadList(parentDir(state.dir));
    }
    setStatus('error', error.message || 'could not list files');
  } finally {
    hideBusy();
  }
}

async function openFile(file) {
  await engine.flush();
  engine.close();

  state.file = file;
  state.dir = parentDir(file.path);
  state.query = '';
  $('#search').value = '';
  setScreen('file');
  setTitle(file.name);
  setStatus('loading');

  // Clear the note that was open before the screen changes: the editor still
  // holds it, and a previous note appearing under the new note's name is a lie
  // for as long as the read takes.
  editor.setText('');
  showBusy(`Opening ${file.name}…`);

  try {
    const { text, rev } = await provider.read(file.path);
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    editor.setText(clean);
    engine.open({ path: file.path, text: clean, rev });
    trackEvent('file-open');
    setStatus('loaded');
  } catch (error) {
    if (error instanceof AuthError) return showAuth();
    trackEvent('error-open');
    setStatus('error', error.message || 'could not open the file');
  } finally {
    hideBusy();
  }
}

async function refresh() {
  if (state.file && !$('#screen-file').hidden) {
    await engine.flush();
    setStatus('loading');
    try {
      const { text, rev } = await provider.read(state.file.path);
      const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      if (clean !== editor.text()) {
        editor.setText(clean);
        toast('Reloaded from Dropbox');
      }
      engine.open({ path: state.file.path, text: clean, rev });
      setStatus('loaded');
    } catch (error) {
      setStatus('error', error.message || 'reload failed');
    }
    return;
  }
  await loadList();
}

async function goBack() {
  if (!$('#screen-file').hidden) {
    await engine.flush();
    engine.close();
    state.file = null;
    await loadList(state.dir);
    return;
  }
  if (state.dir) await loadList(parentDir(state.dir));
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

// Created once per file per session: Dropbox keeps a link per file, so asking
// again would only cost a round trip.
const sharedLinks = new Map();

function resetShare() {
  $('#share-url').value = '';
  $('#share-note').textContent = '';
  $('#share-copy').disabled = true;
  $('#share-copy').textContent = 'Copy link';
  $('#share-send').hidden = true;
  $('#share-reconnect').hidden = true;
}

async function openShare() {
  const file = state.file;
  if (!file) return;

  resetShare();
  $('#share-where').textContent = file.name || 'This file';
  $('#share-note').textContent = 'Asking Dropbox for the link…';
  const dialog = $('#share-sheet');
  if (!dialog.open) dialog.showModal();

  try {
    // The link points at the file as Dropbox holds it, so anything typed but
    // not yet uploaded has to go first — otherwise the recipient reads a note
    // that is already out of date.
    await engine.flush();
    const known = sharedLinks.get(file.path);
    const url = known || viewableLink(await provider.shareLink(file.path));
    sharedLinks.set(file.path, url);

    $('#share-url').value = url;
    $('#share-note').textContent =
      'Anyone with this link can read this file until you stop sharing it in Dropbox.';
    $('#share-copy').disabled = false;
    $('#share-send').hidden = !canShare();
  } catch (error) {
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
      `until the trash expires. ${extra} Taisce cannot undo this.`,
    ok: 'Delete',
    danger: true,
  });
  if (!ok) return;

  // Upload anything pending first, so a refused delete leaves the note saved
  // and a queued save cannot land on a path that no longer exists.
  await engine.flush();
  engine.close();
  setStatus('deleting');

  try {
    await provider.remove(file.path);
  } catch (error) {
    if (error instanceof AuthError) return showAuth();
    trackEvent('error-delete');
    toast(error.message || 'could not delete the file');
    await openFile(file); // the note is still there: put it back on screen
    return;
  }

  trackEvent('file-delete');
  const failedPictures = await deletePictures(pictures);

  sharedLinks.delete(file.path);
  state.index = null; // the recent list and search both lose a row
  const dir = state.dir;
  state.file = null;
  editor.setText('');
  await loadList(dir);
  toast(
    failedPictures
      ? `Deleted “${file.name}” — ${failedPictures} picture${failedPictures === 1 ? '' : 's'} could not be`
      : `Deleted “${file.name}”`,
  );
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
  state.query = String(value || '').trim();
  if (!state.query) {
    renderList();
    return;
  }
  setStatus('loading');
  try {
    await ensureIndex();
    renderList();
  } catch (error) {
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
  $('#settings').showModal();
  setTimeout(() => $('#recent-count').focus(), 60);
}

function saveSettings(event) {
  event.preventDefault();
  state.recentMax = recentCount($('#recent-count').value);
  state.undoMax = undoLimit($('#undo-limit').value);
  localStorage.setItem(RECENT_KEY, String(state.recentMax));
  localStorage.setItem(UNDO_KEY, String(state.undoMax));
  editor.setUndoLimit(state.undoMax);
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
  $('#viewer-x').addEventListener('click', () => $('#viewer').close());
  $('#share-close').addEventListener('click', () => $('#share-sheet').close());
  $('#share-copy').addEventListener('click', async () => {
    const url = $('#share-url').value;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      trackEvent('share-copy');
      $('#share-copy').textContent = 'Copied';
      setTimeout(() => {
        $('#share-copy').textContent = 'Copy link';
      }, 1600);
    } catch {
      // No clipboard permission: the link is on screen to select by hand.
      $('#share-url').select();
      $('#share-note').textContent = 'Select the link above and copy it.';
    }
  });
  $('#share-send').addEventListener('click', async () => {
    const url = $('#share-url').value;
    if (!url) return;
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
