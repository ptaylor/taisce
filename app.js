import { APP_CONFIG } from './js/config.js';
import { DropboxProvider } from './js/dropbox.js';
import { createMockProvider } from './js/mock.js';
import { completeSignIn, isSignedIn, redirectUri, startSignIn } from './js/auth.js';
import { createSaveEngine } from './js/save.js';
import { createEditor } from './js/editor.js';
import { AuthError } from './js/errors.js';
import { $, ask, setScreen, setStatus, setTitle, toast } from './js/ui.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const provider = MOCK ? createMockProvider() : new DropboxProvider(APP_CONFIG.appKey);
const state = { files: [], file: null };

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

function renderList() {
  const list = $('#file-list');
  const empty = $('#list-empty');
  list.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const file of state.files) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file';
    button.textContent = file.name;
    button.addEventListener('click', () => {
      void openFile(file);
    });
    item.appendChild(button);
    fragment.appendChild(item);
  }
  list.appendChild(fragment);

  empty.hidden = state.files.length > 0;
  setStatus('ready', `${state.files.length} file${state.files.length === 1 ? '' : 's'}${MOCK ? ' · demo' : ''}`);
}

async function loadList() {
  setTitle('Taisce');
  setScreen('list');
  setStatus('loading');
  $('#file-list').replaceChildren();
  $('#list-empty').hidden = true;

  try {
    state.files = await provider.list();
    renderList();
  } catch (error) {
    if (error instanceof AuthError) return showAuth();
    setStatus('error', error.message || 'could not list files');
  }
}

async function openFile(file) {
  await engine.flush();
  engine.close();

  state.file = file;
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
  await engine.flush();
  engine.close();
  state.file = null;
  await loadList();
}

function showNewFile() {
  $('#new-name').value = '';
  $('#new-error').hidden = true;
  $('#new-file').showModal();
  setTimeout(() => $('#new-name').focus(), 60);
}

async function submitNewFile(event) {
  event.preventDefault();
  const input = $('#new-name');
  const error = $('#new-error');
  error.hidden = true;

  let name = input.value.trim();
  if (!name) {
    error.textContent = 'Give the file a name.';
    error.hidden = false;
    return;
  }
  if (/[/\\]/.test(name)) {
    error.textContent = 'Names cannot contain / or \\';
    error.hidden = false;
    return;
  }
  if (!/\.md$/i.test(name)) name += '.md';

  const path = `/${name}`;
  $('#new-create').disabled = true;
  try {
    await provider.create(path, '');
    $('#new-file').close();
    await loadList();
    const created = state.files.find((file) => file.path === path.toLowerCase()) || {
      name: name.replace(/\.md$/i, ''),
      path,
    };
    await openFile(created);
  } catch (caught) {
    error.textContent = caught.message === 'conflict' ? 'A file with that name already exists.' : caught.message;
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
  state.files = [];
  state.file = null;

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
    await loadList();
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
    if (signedIn) await loadList();
    else showAuth();
  } catch (error) {
    toast(error.message || 'Sign-in failed');
    showAuth();
  }
}

void boot();
