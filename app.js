import { APP_CONFIG } from './js/config.js';
import { DropboxProvider } from './js/dropbox.js';
import { createMockProvider } from './js/mock.js';
import { completeSignIn, isSignedIn, redirectUri, startSignIn } from './js/auth.js';
import { createSaveEngine } from './js/save.js';
import { createEditor } from './js/editor.js';
import { AuthError } from './js/errors.js';
import { breadcrumbs, joinPath, normaliseDir, parentDir } from './js/paths.js';
import { $, ask, setScreen, setStatus, setTitle, toast } from './js/ui.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const provider = MOCK ? createMockProvider() : new DropboxProvider(APP_CONFIG.appKey);
const state = { dir: '', entries: [], file: null };

const editor = createEditor({
  container: $('#blocks'),
  onChange: (text) => engine.setText(text),
  onStatus: setStatus,
});

const engine = createSaveEngine({
  provider,
  onStatus: setStatus,
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

function showAuth() {
  setTitle('Taisce');
  setStatus('ready');
  setScreen('auth');
}

function renderCrumbs() {
  const nav = $('#crumbs');
  nav.replaceChildren();

  const trail = breadcrumbs(state.dir);
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

function renderList() {
  const list = $('#file-list');
  const empty = $('#list-empty');
  list.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const entry of state.entries) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `entry ${entry.type}`;

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = entry.type === 'folder' ? '\u203a' : '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.name;
    button.append(glyph, label);

    button.addEventListener('click', () => {
      if (entry.type === 'folder') void loadList(entry.path);
      else void openFile(entry);
    });

    item.appendChild(button);
    fragment.appendChild(item);
  }
  list.appendChild(fragment);

  empty.hidden = state.entries.length > 0;
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
  setTitle('Taisce');
  setScreen('list', { back: Boolean(state.dir) });
  setStatus('loading');
  renderCrumbs();
  $('#file-list').replaceChildren();
  $('#list-empty').hidden = true;

  try {
    state.entries = await provider.list(state.dir);
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
      $('#new-file').close();
      toast(`Created the folder “${name}”`);
      await loadList(state.dir);
      return;
    }

    const path = joinPath(state.dir, /\.md$/i.test(name) ? name : `${name}.md`);
    await provider.create(path, '');
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

  if (MOCK) {
    // Re-seed the demo rather than offering a real sign-in.
    location.replace(`${location.pathname}?mock=1`);
    return;
  }
  showAuth();
}

function showHelp() {
  $('#help').showModal();
}

async function boot() {
  $('#redirect-uri').textContent = redirectUri();
  $('#disconnect').textContent = provider.disconnectLabel;

  $('#connect').addEventListener('click', () => {
    void startSignIn(APP_CONFIG.appKey);
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
