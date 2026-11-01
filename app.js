import { APP_CONFIG } from './js/config.js';
import { DropboxProvider } from './js/dropbox.js';
import { createMockProvider } from './js/mock.js';
import { completeSignIn, isSignedIn, redirectUri, startSignIn } from './js/auth.js';
import { createSaveEngine } from './js/save.js';
import { createEditor } from './js/editor.js';
import { AuthError, ConflictError } from './js/errors.js';
import { breadcrumbs, joinPath, normaliseDir, parentDir } from './js/paths.js';
import { folderOf, recentCount, recentFiles, searchFiles } from './js/recents.js';
import { undoLimit } from './js/history.js';
import { assetDirFor, imageFileName, markdownImage, resolveImagePath } from './js/images.js';
import { $, ask, setScreen, setStatus, setTitle, toast } from './js/ui.js';

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
});

const engine = createSaveEngine({
  provider,
  onStatus: (kind, detail) => {
    // A save changes the modified time, so the recent list is stale.
    if (kind === 'saved') state.index = null;
    setStatus(kind, detail);
  },
  onRemote: (text, info) => {
    editor.setText(text);
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
    return null;
  }
}

// Upload first, link second: a link to an image that failed to upload is worse
// than no link at all.
async function uploadPastedImage(file) {
  if (!state.file) throw new Error('open a note before pasting an image');

  const dir = assetDirFor(state.file.path);
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
  $('#search').value = '';
  setTitle('Taisce');
  setScreen('list', { back: Boolean(state.dir) });
  setStatus('loading');
  renderCrumbs();
  $('#file-list').replaceChildren();
  $('#recents-block').hidden = true;
  $('#list-empty').hidden = true;
  $('#search-empty').hidden = true;

  try {
    const [entries] = await Promise.all([provider.list(state.dir), state.dir ? null : ensureIndex()]);
    state.entries = entries;

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

  try {
    const { text, rev } = await provider.read(file.path);
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    editor.setText(clean);
    engine.open({ path: file.path, text: clean, rev });
    setStatus('loaded');
  } catch (error) {
    if (error instanceof AuthError) return showAuth();
    setStatus('error', error.message || 'could not open the file');
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

  $('#new-create').disabled = true;
  try {
    if (kind === 'folder') {
      await provider.createFolder(joinPath(state.dir, name));
      state.index = null;
      $('#new-file').close();
      toast(`Created the folder “${name}”`);
      await loadList(state.dir);
      return;
    }

    const path = joinPath(state.dir, /\.md$/i.test(name) ? name : `${name}.md`);
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
  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
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
    setStatus('error', error.message || 'search failed');
  }
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
  $('#settings').close();
  if (!$('#screen-list').hidden) renderList();
}

async function boot() {
  $('#redirect-uri').textContent = redirectUri();
  $('#disconnect').textContent = provider.disconnectLabel;
  $('#account-title').textContent = MOCK ? 'Demo data' : 'Dropbox';
  $('#account-note').textContent = provider.disconnectBody;

  const version = document.querySelector('meta[name="app-version"]')?.content;
  if (version) $('#help-version').textContent = version;

  $('#connect').addEventListener('click', () => {
    void startSignIn(APP_CONFIG.appKey);
  });
  $('#recents-toggle').addEventListener('click', () => {
    state.recentsOpen = !state.recentsOpen;
    applyRecentsOpen();
  });
  $('#new').addEventListener('click', showNewFile);
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
  $('#help-button').addEventListener('click', showHelp);
  $('#help-close').addEventListener('click', () => $('#help').close());
  $('#undo').addEventListener('click', () => editor.undo());
  $('#redo').addEventListener('click', () => editor.redo());
  $('#settings-button').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => $('#settings').close());
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
      void runSearch('');
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
